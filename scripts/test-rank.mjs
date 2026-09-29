#!/usr/bin/env node
// Deterministic matching (server/match/rank.js) against docs/RANKING-SPEC.md,
// plus suitability estimates and requirement validation. No AI, no network.
//   node scripts/test-rank.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { rank } from "../server/match/rank.js";
import { suitability } from "../public/app/js/core/car-tags.js";
import { effectiveFields } from "../public/app/js/core/car-fields.js";
import { buildMatchLog } from "../server/match/log.js";
import * as F from "../public/app/js/core/car-fields.js";
const rankSrc = await readFile(new URL("../server/match/rank.js", import.meta.url), "utf8");
import { validateRequirements, understoodChips, removeChip, isEmpty, statedAmounts, budgetUnitQuestion, droppedBudgetQuestion } from "../public/app/js/core/requirements.js";

const { cars } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const req = (r) => validateRequirements(r).requirements;
const ids = (out) => out.results.map((r) => r.title);

// A synthetic car that scores perfectly on everything soft.
const perfect = (over) => ({
  id: "p", brandName: "Test", model: "Perfect", year: 2026, price: 1500000, availability: "in-stock",
  fuelTypes: ["petrol"], transmissionNorm: "automatic", fuelEconomyKmpl: 30, powerHp: 300, groundClearanceMm: 190,
  bootLitres: 500, bodyType: "compact_suv", seats: 7, airbags: 8, ncapStars: 5, features: ["sunroof"], ...over,
});

console.log("Hard constraints can never be overridden (spec §2)");
check("₹15 lakh car on a ₹12 lakh budget is NOT a result, however well it scores", () => {
  const out = rank(req({ budgetMaxInr: 1200000, usage: ["city", "highway", "family"], priorities: ["fuel_economy", "safety", "performance"] }), [perfect({ price: 1500000 })]);
  assert.deepEqual(out.results, []);
});
check("manual car is NOT a result when automatic is required", () => {
  const out = rank(req({ transmission: { value: "automatic", strength: "required" }, usage: ["city"] }), [perfect({ transmissionNorm: "manual" })]);
  assert.deepEqual(out.results, []);
});
check("manual car IS a result when automatic is only preferred (it scores lower)", () => {
  const out = rank(req({ transmission: { value: "automatic", strength: "preferred" } }), [perfect({ id: "a" }), perfect({ id: "m", transmissionNorm: "manual" })]);
  assert.deepEqual(out.results.map((r) => r.carId), ["a", "m"]);
  assert.ok(out.results[0].score > out.results[1].score);
});
check("unknown data FAILS a hard constraint: conflicting transmission (Wrangler) is excluded", () => {
  const out = rank(req({ transmission: { value: "manual", strength: "required" } }), cars);
  assert.ok(!ids(out).includes("Jeep Wrangler Rubicon"));
});
check("unknown fuel (Range Rover) fails a required fuel", () => {
  const out = rank(req({ fuel: { value: "petrol", strength: "required" } }), cars);
  assert.ok(!ids(out).includes("Land Rover Range Rover Vogue"));
});
check("unrecorded body type fails a required body type (none are recorded yet)", () => {
  const out = rank(req({ bodyTypes: { values: ["suv"], strength: "required" } }), cars);
  assert.deepEqual(out.results, []);
});
check("body type is never inferred from the model name, description, features or other fields", () => {
  const hinted = { id: "h", brandName: "Toyota", model: "Fortuner SUV", variant: "Sedan", description: "A 7-seat SUV, great hatchback feel",
    features: ["SUV styling"], specifications: { "Body type": "SUV", Body: "SUV" }, price: 1000000, availability: "in-stock", bodyType: null };
  assert.equal(effectiveFields(hinted).bodyType, null);
  assert.deepEqual(rank(req({ bodyTypes: { values: ["suv"], strength: "required" } }), [hinted]).results, []);
  assert.deepEqual(rank(req({ bodyTypes: { values: ["suv"], strength: "required" } }), [hinted]).nearMisses[0].failed, ["Body type not recorded — SUV was required"]);
});
check("all 18 live cars: body type is unknown, so a required body type matches none of them", () => {
  assert.ok(cars.every((c) => effectiveFields(c).bodyType === null));
  for (const b of ["suv", "sedan", "hatchback", "coupe", "muv"])
    assert.deepEqual(rank(req({ bodyTypes: { values: [b], strength: "required" } }), cars).results, [], b);
});
check("a body type the admin entered is used; a preferred body type never excludes", () => {
  const venue = { ...cars.find((c) => c.model === "Venue"), bodyType: "compact_suv" };
  assert.deepEqual(rank(req({ bodyTypes: { values: ["compact_suv"], strength: "required" } }), [venue]).results.map((r) => r.title), ["Hyundai Venue"]);
  assert.equal(rank(req({ bodyTypes: { values: ["sedan"], strength: "preferred" } }), cars).results.length, 3);
});
check("seats and must-have features are hard constraints", () => {
  assert.deepEqual(rank(req({ seatsMin: 8 }), [perfect()]).results, []);
  assert.deepEqual(rank(req({ mustHaveFeatures: ["heads-up display"] }), [perfect()]).results, []);
  assert.equal(rank(req({ mustHaveFeatures: ["Sunroof"] }), [perfect()]).results.length, 1);
});
check("a sold car is never a result or a near miss", () => {
  const out = rank(req({}), [perfect({ availability: "sold" })]);
  assert.deepEqual([out.results, out.nearMisses], [[], []]);
});
check("every result passed every applied constraint, on every live car, for many requirement sets", () => {
  const sets = [
    { budgetMaxInr: 1200000 }, { budgetMaxInr: 5000000, transmission: { value: "automatic", strength: "required" } },
    { fuel: { value: "diesel", strength: "required" } }, { seatsMin: 7 }, { budgetMinInr: 5000000, budgetMaxInr: 10000000 },
  ];
  for (const s of sets) {
    const r = req(s);
    for (const res of rank(r, cars).results) {
      const car = cars.find((c) => c.id === res.carId);
      if (r.budgetMaxInr) assert.ok(car.price <= r.budgetMaxInr, res.title);
      if (r.budgetMinInr) assert.ok(car.price >= r.budgetMinInr, res.title);
    }
  }
});

console.log("Scoring, order and output (spec §4, §5, §8)");
check("the worked example: automatic under ₹12 lakh, city driving -> Hyundai Venue only", () => {
  const out = rank(req({ budgetMaxInr: 1200000, transmission: { value: "automatic", strength: "required" }, usage: ["city", "highway"], priorities: ["reliability", "comfort"] }), cars);
  assert.deepEqual(ids(out), ["Hyundai Venue"]);
  assert.equal(out.meta.candidatesAfter, 1);
});
check("at most 3 results, never padded with failures", () => {
  assert.ok(rank(req({}), cars).results.length === 3);
  assert.equal(rank(req({ budgetMaxInr: 700000 }), cars).results.length, 1);
});
check("no applicable criteria -> every passing car scores 100", () => {
  for (const r of rank(req({}), cars).results) assert.equal(r.score, 100);
});
check("ties break on price ascending, then year, then id", () => {
  const out = rank(req({}), [perfect({ id: "b", price: 900000 }), perfect({ id: "a", price: 900000 }), perfect({ id: "c", price: 800000 })]);
  assert.deepEqual(out.results.map((r) => r.carId), ["c", "a", "b"]);
});
check("budget fit: every in-budget car scores 1, however much of the budget it uses", () => {
  const out = rank(req({ budgetMaxInr: 1200000 }), [perfect({ id: "near", price: 1100000 }), perfect({ id: "cheap", price: 300000 })]);
  const s = Object.fromEntries(out.results.map((r) => [r.carId, r.breakdown[0].score]));
  assert.deepEqual(s, { near: 1, cheap: 1 });
  assert.deepEqual(out.results.map((r) => r.carId), ["cheap", "near"], "equal scores -> cheaper first");
});
check("REGRESSION: 'under 1 crore, good mileage' ranks by mileage, not by budget used", () => {
  const out = rank(req({ budgetMaxInr: 10000000, transmission: { value: "automatic", strength: "preferred" }, priorities: ["fuel_economy"] }), cars);
  const kmpl = (t) => cars.find((c) => `${c.brandName} ${c.model}` === t).fuelEconomyKmpl;
  assert.equal(out.results[0].title, "Hyundai Venue", "17.9 kmpl, automatic");
  for (let i = 1; i < out.results.length; i++) assert.ok(kmpl(out.results[i - 1].title) >= kmpl(out.results[i].title), "ordered by kmpl");
  assert.ok(!out.results.some((r) => r.title === "Volvo XC90"), "11 kmpl must not beat better-mileage cars");
});
check("a cheaper car is never ranked lower BECAUSE it is cheaper", () => {
  const a = perfect({ id: "cheap", price: 2000000, fuelEconomyKmpl: 20 });
  const b = perfect({ id: "dear", price: 8000000, fuelEconomyKmpl: 20 });
  const out = rank(req({ budgetMaxInr: 10000000, priorities: ["fuel_economy"] }), [a, b]);
  assert.equal(out.results[0].score, out.results[1].score);
  assert.equal(out.results[0].carId, "cheap");
});
check("low price: a lone candidate scores 1, not 0 (amended §4)", () => {
  const out = rank(req({ priorities: ["low_price"] }), [perfect()]);
  assert.equal(out.results[0].breakdown[0].score, 1);
});
check("reliability is never scored", () => {
  const out = rank(req({ priorities: ["reliability"] }), [perfect()]);
  assert.deepEqual(out.results[0].breakdown, []);
});
check("missing data lowers a score instead of being assumed good (× confidence)", () => {
  const known = perfect({ id: "k" });
  const unknown = perfect({ id: "u", bootLitres: null, seats: null });
  const out = rank(req({ usage: ["family"] }), [known, unknown]);
  assert.deepEqual(out.results.map((r) => r.carId), ["k", "u"]);
});
check("ranking is deterministic: same input, same output", () => {
  const r = req({ budgetMaxInr: 10000000, usage: ["city"], priorities: ["fuel_economy"] });
  assert.deepEqual(rank(r, cars), rank(r, cars));
});
check("scores are whole numbers between 0 and 100", () => {
  for (const r of rank(req({ budgetMaxInr: 30000000, usage: ["city", "highway", "rough_roads", "family"], priorities: ["fuel_economy", "safety", "comfort", "performance", "low_price"] }), cars).results)
    assert.ok(Number.isInteger(r.score) && r.score >= 0 && r.score <= 100, r.title);
});
check("results are plain JSON (sent to the browser as-is)", () => {
  const out = rank(req({ budgetMaxInr: 1200000, usage: ["city"] }), cars);
  assert.deepEqual(JSON.parse(JSON.stringify(out)), out);
});

console.log("Near misses (spec §6)");
check("near misses: exactly one failure, budget misses within 20%, at most 3", () => {
  const out = rank(req({ budgetMaxInr: 1200000, transmission: { value: "automatic", strength: "required" } }), cars);
  assert.ok(out.nearMisses.length <= 3 && out.nearMisses.length > 0);
  for (const n of out.nearMisses) assert.equal(n.failed.length, 1);
  assert.ok(!out.nearMisses.some((n) => n.title.includes("Innova")), "Innova is 56% over budget");
});
check("a budget near miss says how far over, in plain words", () => {
  const out = rank(req({ budgetMaxInr: 1000000 }), [perfect({ price: 1100000 })]);
  assert.deepEqual(out.nearMisses[0].failed, ["₹11 lakh — ₹1 lakh above your ₹10 lakh budget"]);
});
check("a car failing two constraints is not a near miss", () => {
  const out = rank(req({ budgetMaxInr: 1000000, transmission: { value: "manual", strength: "required" } }), [perfect({ price: 1100000 })]);
  assert.deepEqual(out.nearMisses, []);
});

console.log("Explanations (spec §7)");
check("explanation lines come only from passed constraints and strong criteria", () => {
  const out = rank(req({ budgetMaxInr: 1200000, transmission: { value: "automatic", strength: "required" }, usage: ["city"] }), cars);
  const venue = out.results[0];
  assert.ok(venue.explanation.includes("Automatic transmission, as required"));
  assert.ok(venue.explanation.includes("₹8 lakh — within your ₹12 lakh budget"));
  assert.ok(venue.explanation.some((l) => l.startsWith("City use: High (estimate). Based on: Automatic transmission; Listed fuel economy of 17.9 kmpl")));
});
check("a weak criterion is never described as a strength", () => {
  const weak = perfect({ fuelEconomyKmpl: 5, transmissionNorm: "manual", bodyType: "pickup" });
  const out = rank(req({ usage: ["city"] }), [weak]);
  assert.ok(!out.results[0].explanation.some((l) => l.startsWith("City use")));
});
check("missing data is listed openly", () => {
  const out = rank(req({ budgetMaxInr: 1200000, transmission: { value: "automatic", strength: "required" } }), cars);
  assert.ok(out.results[0].missingData.includes("kilometres driven"));
  assert.ok(out.results[0].missingData.includes("body type"));
});

console.log("Suitability estimates (spec §3)");
check("Venue city suitability: High, from the listed specs, body type not listed", () => {
  const t = suitability(cars.find((c) => c.model === "Venue")).city_suitability;
  assert.deepEqual([t.level, t.score, t.confidence], ["High", 1, 0.667]);
  assert.deepEqual(t.evidence, ["Automatic transmission", "Listed fuel economy of 17.9 kmpl"]);
  assert.deepEqual(t.notListed, ["body type"]);
});
check("a conflicting transmission is unknown, not counted for or against", () => {
  const t = suitability(cars.find((c) => c.model === "Wrangler Rubicon")).city_suitability;
  assert.ok(t.notListed.includes("transmission"));
  assert.ok(!t.evidence.some((e) => /transmission/i.test(e)) && !t.against.some((e) => /transmission/i.test(e)));
});
check("too little data -> 'Not enough data', never High", () => {
  const t = suitability({ id: "x" }).rough_road_suitability;
  assert.equal(t.level, "Not enough data");
});

console.log("Requirement validation (spec §1)");
check("budget in the wrong unit asks to clarify instead of ranking", () => {
  assert.ok(validateRequirements({ budgetMaxInr: 12 }).clarify);
  assert.equal(validateRequirements({ budgetMaxInr: 1200000 }).clarify, null);
});
check("min above max is swapped with a warning", () => {
  const v = validateRequirements({ budgetMinInr: 1200000, budgetMaxInr: 800000 });
  assert.deepEqual([v.requirements.budgetMinInr, v.requirements.budgetMaxInr], [800000, 1200000]);
  assert.ok(v.warnings.length);
});
check("unknown enum values are dropped with a warning, never passed on", () => {
  const v = validateRequirements({ transmission: { value: "cvt", strength: "required" }, usage: ["city", "moon"], bodyTypes: { values: ["tank"], strength: "required" } });
  assert.equal(v.requirements.transmission, null);
  assert.deepEqual(v.requirements.usage, ["city"]);
  assert.equal(v.requirements.bodyTypes, null);
  assert.match(v.warnings.join(" "), /cvt.*moon.*tank|Ignored/);
});
check("seat counts outside 1-9 ask to clarify", () => assert.ok(validateRequirements({ seatsMin: 40 }).clarify));
check("reliability kept for display but flagged as not scored", () => {
  const v = validateRequirements({ priorities: ["reliability"] });
  assert.deepEqual(v.requirements.priorities, ["reliability"]);
  assert.match(v.warnings.join(" "), /can't be assessed/);
});
check("chips describe the requirements and removing one removes only that requirement", () => {
  const r = req({ budgetMaxInr: 1200000, transmission: { value: "automatic", strength: "required" }, usage: ["city", "highway"] });
  assert.deepEqual(understoodChips(r).map((c) => c.text), ["Up to ₹12 lakh", "Automatic (required)", "City driving", "Highway driving"]);
  const r2 = removeChip(r, "usage:city");
  assert.deepEqual(r2.usage, ["highway"]);
  assert.equal(removeChip(r, "transmission").transmission, null);
  assert.equal(r.usage.length, 2, "original not mutated");
});
check("budget unit: your four examples convert exactly", () => {
  assert.deepEqual(statedAmounts("under ₹12 lakh"), [1200000]);
  assert.deepEqual(statedAmounts("under ₹12L"), [1200000]);
  assert.deepEqual(statedAmounts("under 12 lakh"), [1200000]);
  assert.deepEqual(statedAmounts("under ₹1 crore"), [10000000]);
});
check("budget unit: other stated forms convert exactly", () => {
  const cases = { "upto 12.5 lakhs": 1250000, "1.2 cr": 12000000, "15 lakh tak": 1500000, "within 12 lac": 1200000,
    "under ₹12,00,000": 1200000, "under 1200000": 1200000, "max 1,200,000": 1200000, "about 800k": 800000, "50 thousand": 50000 };
  for (const [q, v] of Object.entries(cases)) assert.deepEqual(statedAmounts(q), [v], q);
});
check("budget unit: a stated budget passes the check", () => {
  for (const [q, b] of [["under ₹12 lakh", 1200000], ["under ₹1 crore", 10000000], ["8 to 12 lakh", 1200000]])
    assert.equal(budgetUnitQuestion(q, { budgetMaxInr: b }), null, q);
});
check("budget unit: a bare number is ambiguous and asks the buyer", () => {
  for (const q of ["car under 12", "budget 15", "under ₹12", "around 20, automatic", "7 seater under 12"])
    assert.ok(budgetUnitQuestion(q, { budgetMaxInr: 1200000 }), q);
  assert.match(budgetUnitQuestion("car under 12", { budgetMaxInr: 1200000 }), /What does "12" mean\?.*12 lakh/);
});
check("budget unit: a unit elsewhere cannot vouch for a bare budget number", () => {
  assert.ok(budgetUnitQuestion("1.2L petrol engine under 12", { budgetMaxInr: 1200000 }));
  assert.ok(budgetUnitQuestion("12 lakh km driven is fine, budget 15", { budgetMaxInr: 1500000 }));
});
check("budget unit: both ends of a range must be stated", () => {
  assert.equal(budgetUnitQuestion("8 lakh to 12 lakh", { budgetMinInr: 800000, budgetMaxInr: 1200000 }), null);
  assert.equal(budgetUnitQuestion("8 to 12 lakh", { budgetMinInr: 800000, budgetMaxInr: 1200000 }), null, "shared unit");
  assert.equal(budgetUnitQuestion("8-12L", { budgetMinInr: 800000, budgetMaxInr: 1200000 }), null, "shared unit");
  assert.equal(budgetUnitQuestion("between 8 and 12 lakh", { budgetMinInr: 800000, budgetMaxInr: 1200000 }), null, "between X and Y");
  assert.equal(budgetUnitQuestion("petrol automatic between 8 and 12 lakh", { budgetMinInr: 800000, budgetMaxInr: 1200000 }), null);
  assert.deepEqual(statedAmounts("between 8 and 12 lakh").sort((a, b) => a - b), [800000, 1200000]);
  // "and" only joins a range when both sides are numbers: "7 seats and 12 lakh" is not "7 lakh".
  assert.ok(!statedAmounts("7 seater and 12 lakh budget").includes(700000));
  assert.equal(budgetUnitQuestion("50 lakh to 1 crore", { budgetMinInr: 5000000, budgetMaxInr: 10000000 }), null);
  assert.ok(budgetUnitQuestion("from 8 up to 12 lakh", { budgetMinInr: 800000, budgetMaxInr: 1200000 }), "bare 8");
});
check("budget unit: Gemini dropped a unitless budget -> the buyer is still asked", () => {
  const q = droppedBudgetQuestion("car under 12", { budgetMaxInr: null, budgetMinInr: null, unparsed: ["budget without a unit"] });
  assert.match(q, /What does "12" mean\?/);
  assert.equal(droppedBudgetQuestion("7 seater", { budgetMaxInr: null, unparsed: ["red colour"] }), null);
  assert.equal(droppedBudgetQuestion("under 12 lakh", { budgetMaxInr: 1200000, unparsed: ["budget"] }), null);
});
check("budget unit: no budget extracted -> no question, even with numbers present", () => {
  assert.equal(budgetUnitQuestion("7 seater automatic", { budgetMaxInr: null, budgetMinInr: null }), null);
});
const worker = await readFile(new URL("../server/worker.js", import.meta.url), "utf8");
const rules = await readFile(new URL("../server/rules/firestore.rules", import.meta.url), "utf8");
const block = rules.slice(rules.indexOf("match /matchLogs/{id}"), rules.indexOf("allow read, delete: if isAdmin();", rules.indexOf("match /matchLogs/{id}")));
const listIn = (fn) => [...block.match(new RegExp(`keys\\(\\)\\.${fn}\\(\\[([^\\]]+)\\]`))[1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
check("matchLogs rule: hasAll and hasOnly name the same eight fields", () => {
  assert.deepEqual(listIn("hasAll"), listIn("hasOnly"));
  assert.equal(listIn("hasAll").length, 8);
  assert.ok(listIn("hasAll").includes("clickedId"));
});
check("matchLogs: buildMatchLog produces exactly the rule's fields", () => {
  const log = buildMatchLog({ uid: "u1", query: "automatic under 12 lakh", requirements: req({ budgetMaxInr: 1200000 }), results: [{ carId: "a" }, { carId: "b" }, { carId: "c" }, { carId: "d" }], model: "gemini-3.5-flash-lite" });
  assert.deepEqual(Object.keys(log).sort(), listIn("hasAll"));
});
check("matchLogs: field types match the rule (string, map, list <= 3, timestamps)", () => {
  const log = buildMatchLog({ uid: "u1", query: "q", requirements: req({}), results: [{ carId: 1 }], model: undefined, now: new Date("2026-09-27T00:00:00Z") });
  assert.equal(typeof log.uid, "string");
  assert.equal(typeof log.query, "string");
  assert.equal(typeof log.model, "string", "model must always be a string");
  assert.equal(log.clickedId, null);
  for (const k of ["age", "gender", "family", "email", "name", "phone"]) assert.ok(!(k in log), `no ${k}`);
  assert.ok(log.requirements && typeof log.requirements === "object" && !Array.isArray(log.requirements));
  assert.ok(Array.isArray(log.resultIds) && log.resultIds.length <= 3 && log.resultIds.every((x) => typeof x === "string"));
  assert.ok(log.createdAt instanceof Date && log.expireAt instanceof Date);
  assert.equal(log.expireAt - log.createdAt, 90 * 24 * 3600_000);
  assert.ok(buildMatchLog({ uid: "u", query: "x".repeat(900), requirements: {}, results: [], model: "m" }).query.length <= 500);
});
check("matchLogs rule: every type check in the rule is present", () => {
  for (const c of ["uid == request.auth.uid", "query is string", "query.size() > 0", "query.size() <= 500", "requirements is map",
    "resultIds is list", "resultIds.size() <= 3", "clickedId == null", "model is string", "createdAt is timestamp", "expireAt is timestamp"])
    assert.ok(block.includes(c), c);
  assert.ok(rules.slice(rules.indexOf("match /matchLogs/{id}")).includes("allow update: if false;"));
});
const matchApi = await readFile(new URL("../server/match/api.js", import.meta.url), "utf8");
const chatApi = await readFile(new URL("../server/chat/api.js", import.meta.url), "utf8");
// Read up front so the check itself is synchronous (the check() helper does not await).
const fsLibSrc = await readFile(new URL("../server/lib/firestore.js", import.meta.url), "utf8");
const publicJs = [];
for (const f of (await readdir(new URL("../public/app/js/", import.meta.url), { recursive: true })).filter((x) => x.endsWith(".js")))
  publicJs.push([f, await readFile(new URL(`../public/app/js/${f}`, import.meta.url), "utf8")]);
check("REGRESSION: a created matchLog is immutable", () => {
  const at = rules.indexOf("match /matchLogs/{id}");
  const mlBlock = rules.slice(at, rules.indexOf("}", rules.indexOf("allow update: if false;", at)));
  // 1. Rule: update denied to everyone; no broader grant ('write' includes update).
  assert.ok(/allow update: if false;/.test(mlBlock));
  const allows = [...mlBlock.matchAll(/allow ([a-z, ]+):/g)].flatMap((m) => m[1].split(",").map((x) => x.trim())).sort();
  assert.deepEqual(allows, ["create", "delete", "read", "update"], "unexpected permission in the matchLogs block");
  assert.ok(!/allow write/.test(mlBlock));
  // 2. No second rule can grant access: exactly one rule names matchLogs, and the catch-all denies.
  assert.equal(rules.split("match /matchLogs").length - 1, 1, "more than one matchLogs rule");
  assert.ok(rules.includes("match /{document=**} { allow read, write: if false; }"), "catch-all is not deny-all");
  // 3. The Worker only ever creates a log (POST); it has no update or delete path at all.
  const writeFn = fsLibSrc.slice(fsLibSrc.indexOf("export async function writeMatchLog"));
  assert.ok(writeFn.includes('method: "POST"') && writeFn.includes("/matchLogs`"), "the log write is not a create");
  assert.ok(!/PATCH|updateMask|method: "DELETE"|currentDocument/.test(fsLibSrc), "an update/delete path exists in the Worker");
  // 4. The browser never touches matchLogs.
  for (const [f, src] of publicJs) assert.ok(!src.includes("matchLogs"), f);
  // 5. clickedId is reserved: null at creation, and the rule allows no other value.
  assert.equal(buildMatchLog({ uid: "u", query: "q", requirements: {}, results: [{ carId: "a" }], model: "m" }).clickedId, null);
  assert.ok(mlBlock.includes("request.resource.data.clickedId == null"));
});
check("logs are written only through buildMatchLog, from both handlers", () => {
  for (const src of [matchApi, chatApi]) {
    assert.ok(/deps\.writeLog\(env, user\.idToken, buildMatchLog\(/.test(src));
    assert.equal((src.match(/deps\.writeLog\(/g) || []).length, 1);
  }
  assert.ok(/writeLog: writeMatchLog/.test(worker));
});
/* ------------------ point 10: missing data ----------------------------- */
const blank = (over) => perfect({ id: "b", ...over });
check("missing transmission + automatic required -> hard FAIL", () => {
  const out = rank(req({ transmission: { value: "automatic", strength: "required" } }), [blank({ transmissionNorm: null, transmission: null })]);
  assert.deepEqual(out.results, []);
  assert.match(out.nearMisses[0].failed[0], /^Transmission not confirmed in the listing — automatic was required$/);
});
check("missing fuel + diesel required -> hard FAIL", () => {
  const out = rank(req({ fuel: { value: "diesel", strength: "required" } }), [blank({ fuelTypes: null, fuelType: null })]);
  assert.deepEqual(out.results, []);
  assert.match(out.nearMisses[0].failed[0], /^Fuel type not confirmed in the listing — Diesel was required$/);
});
check("missing seats + 7 seats required -> hard FAIL", () => {
  const out = rank(req({ seatsMin: 7 }), [blank({ seats: null })]);
  assert.deepEqual(out.results, []);
  assert.equal(out.nearMisses[0].failed[0], "Seats not recorded — at least 7 were required");
});
check("missing body type + SUV required -> hard FAIL", () => {
  const out = rank(req({ bodyTypes: { values: ["suv"], strength: "required" } }), [blank({ bodyType: null })]);
  assert.deepEqual(out.results, []);
});
check("missing odometer, fuel economy, power, boot: never invented, soft criteria get 0 confidence, listed as missing", () => {
  const car = blank({ odometerKm: null, fuelEconomyKmpl: null, powerHp: null, bootLitres: null, mileage: null });
  const out = rank(req({ priorities: ["fuel_economy", "performance"], usage: ["family"] }), [car, perfect({ id: "full", odometerKm: 1000 })]);
  const r = out.results.find((x) => x.carId === "b");
  for (const c of ["Fuel economy", "Performance"]) assert.equal(r.breakdown.find((b) => b.criterion === c).confidence, 0, c);
  for (const m of ["kilometres driven", "fuel economy", "power", "boot capacity"]) assert.ok(r.missingData.includes(m), m);
  assert.equal(out.results[0].carId, "full", "missing data never beats measured data");
});

/* --------------- point 9: explanations are templates only -------------- */
check("no explanation, reason or reply template makes unsupported claims", () => {
  const banned = /\b(best car|the best|safest|most reliable|perfect for|guarantee|low maintenance|top pick|we recommend)\b/i;
  const everything = [];
  for (const s of [{}, { budgetMaxInr: 1200000, usage: ["city", "highway", "family", "rough_roads"], priorities: ["fuel_economy", "safety", "comfort", "performance", "low_price", "reliability"] },
    { transmission: { value: "automatic", strength: "required" }, fuel: { value: "diesel", strength: "required" }, seatsMin: 7 }]) {
    const out = rank(req(s), cars);
    for (const r of out.results) everything.push(...r.explanation, ...r.breakdown.map((b) => b.evidence), ...r.missingData);
    for (const n of out.nearMisses) everything.push(...n.failed);
  }
  for (const line of everything) assert.ok(!banned.test(line), line);
  assert.ok(!banned.test(rankSrc), "rank.js contains a banned phrase");
});
check("suitability lines are labelled as estimates", () => {
  const out = rank(req({ usage: ["city"] }), [perfect()]);
  const line = out.results[0].explanation.find((l) => l.startsWith("City use"));
  assert.match(line, /\(estimate\)\. Based on: /);
});

/* ------------------------ point 15: determinism ------------------------ */
check("rank.js is pure: no randomness, clock, network, AI or I/O", () => {
  assert.ok(!/Math\.random|Date\.now|new Date|performance\.now|fetch\(|require\(|process\.|console\./.test(rankSrc));
  assert.ok(!/gemini|generateJson|generateText/i.test(rankSrc));
  const imports = [...rankSrc.matchAll(/^import .* from "([^"]+)";/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["../../public/app/js/core/car-fields.js", "../../public/app/js/core/car-tags.js"]);
});
check("rank() does not modify its inputs", () => {
  const r = req({ budgetMaxInr: 5000000, usage: ["city"] });
  const before = JSON.stringify([r, cars]);
  rank(r, cars);
  assert.equal(JSON.stringify([r, cars]), before);
});
check("shuffled input order gives the same ranking (no order-dependent ties)", () => {
  const r = req({ budgetMaxInr: 30000000, priorities: ["fuel_economy"] });
  const a = rank(r, cars).results.map((x) => x.carId);
  const b = rank(r, [...cars].reverse()).results.map((x) => x.carId);
  assert.deepEqual(a, b);
});

/* ------------- point 16: filters == matcher interpretation ------------- */
check("Wrangler (fuel + transmission conflict): excluded by every required fuel and transmission", () => {
  for (const s of [{ fuel: { value: "petrol", strength: "required" } }, { fuel: { value: "diesel", strength: "required" } },
    { transmission: { value: "manual", strength: "required" } }, { transmission: { value: "automatic", strength: "required" } }])
    assert.ok(!rank(req(s), cars).results.some((r) => r.title === "Jeep Wrangler Rubicon"), JSON.stringify(s));
});
check("Range Rover (fuel conflict): excluded by required petrol and diesel", () => {
  for (const f of ["petrol", "diesel"]) {
    const out = rank(req({ fuel: { value: f, strength: "required" }, budgetMaxInr: 30000000 }), cars);
    assert.ok(!out.results.some((r) => r.title.includes("Range Rover")), f);
  }
});
check("for every live car and every fuel/transmission, matcher agrees with the site filter", () => {
  for (const [kind, values, fn] of [["fuel", ["petrol", "diesel"], F.matchesFuel], ["transmission", ["automatic", "manual"], F.matchesTransmission]])
    for (const v of values) {
      // Each car on its own: does the matcher let it through this one constraint?
      const matcherIds = cars.filter((c) => rank(req({ [kind]: { value: v, strength: "required" } }), [c]).results.length === 1).map((c) => c.id).sort();
      const filterIds = cars.filter((c) => fn(c, v)).map((c) => c.id).sort();
      assert.deepEqual(matcherIds, filterIds, `${kind}=${v}`);
    }
});

/* --------------- inference: visible, never a hard constraint ----------- */
check("inferred transmission/fuel/body type are downgraded to preferred", () => {
  const v = validateRequirements({ transmission: { value: "automatic", strength: "required" }, fuel: { value: "petrol", strength: "required" }, inferred: ["transmission", "fuel"] }).requirements;
  assert.equal(v.transmission.strength, "preferred");
  assert.equal(v.fuel.strength, "preferred");
  assert.deepEqual(v.inferred.sort(), ["fuel", "transmission"]);
});
check("budgets, seats and must-haves can never be marked inferred", () => {
  const v = validateRequirements({ budgetMaxInr: 1200000, seatsMin: 7, inferred: ["budgetMaxInr", "seatsMin", "mustHaveFeatures:sunroof"] });
  assert.deepEqual(v.requirements.inferred, []);
  assert.equal(v.requirements.budgetMaxInr, 1200000);
});
check("inferred chips are flagged; stated ones are not; removing one clears its flag", () => {
  const r = req({ usage: ["city"], priorities: ["comfort"], inferred: ["priorities:comfort"] });
  const chips = understoodChips(r);
  assert.deepEqual(chips.map((c) => [c.id, c.inferred]), [["usage:city", false], ["priorities:comfort", true]]);
  const r2 = removeChip(r, "priorities:comfort");
  assert.deepEqual([r2.priorities, r2.inferred], [[], []]);
});
check("an inferred item that is not actually present is dropped from the inferred list", () => {
  assert.deepEqual(req({ usage: [], inferred: ["usage:city"] }).inferred, []);
});
check("number words count as a stated budget ('maximum twelve lakh')", () => {
  assert.deepEqual(statedAmounts("maximum twelve lakh"), [1200000]);
  assert.deepEqual(statedAmounts("under twenty-five lakh"), [2500000]);
  assert.equal(budgetUnitQuestion("maximum twelve lakh", { budgetMaxInr: 1200000 }), null);
  assert.ok(budgetUnitQuestion("under twelve", { budgetMaxInr: 1200000 }));
});

check("an empty requirement set is detected", () => {
  assert.ok(isEmpty(req({})));
  assert.ok(!isEmpty(req({ usage: ["city"] })));
});

console.log(`\n${passed} checks passed.`);
