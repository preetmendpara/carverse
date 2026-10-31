#!/usr/bin/env node
// AI Car Finder: every search applies its own requirements (relevance), budget
// ranking by closeness to the ceiling, and the browser shows only the latest
// search. Uses the real pipeline (validation -> hard filters -> rank) with the
// catalogue snapshot; Gemini's part is given as fixed extracted requirements.
//   node scripts/test-finder-relevance.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { matchResponse, queryFacts } from "../server/match/pipeline.js";
import { latestOnly } from "../public/app/js/core/latest.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const { cars: fixture } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
// Body types as entered by the admin on 2026-09-29 (the snapshot predates them).
const BODY = { Fortuner: "suv", i20: "hatchback", "Wrangler Rubicon": "suv", "Innova Hycross": "muv", "RS7 Sportback": "sedan", Seltos: "compact_suv", SQ8: "suv", X1: "compact_suv",
  Mustang: "coupe", "M4 Competition": "coupe", City: "sedan", XC90: "suv", "Range Rover Vogue": "suv", "F-150 Raptor": "pickup", "Defender 110": "suv", Venue: "compact_suv", S90: "sedan", Elevate: "compact_suv" };
const cars = fixture.map((c) => ({ ...c, status: "published", bodyType: BODY[c.model] ?? null }));
const byId = Object.fromEntries(cars.map((c) => [c.id, c]));
const search = (query, raw = {}) => matchResponse({ raw, query, cars }).body;
const ids = (b) => b.matchedIds;
const brands = (b) => [...new Set(ids(b).map((id) => byId[id].brandName))];

console.log("A. Query relevance");
check("BMW and Honda searches return only their own brand, and differ", () => {
  const bmw = search("BMW cars under 2 crore", { budgetMaxInr: 20000000 });
  const honda = search("Honda cars under 2 crore", { budgetMaxInr: 20000000 });
  assert.deepEqual(brands(bmw), ["BMW"]);
  assert.deepEqual(brands(honda), ["Honda"]);
  assert.ok(ids(bmw).every((id) => !ids(honda).includes(id)));
});
check("a brand named in the words is a hard requirement with its own chip", () => {
  const b = search("Toyota under 1 crore", { budgetMaxInr: 10000000 });
  assert.deepEqual(b.requirements.brands, ["Toyota"]);
  assert.ok(b.understood.some((c) => c.id === "brands:Toyota" && c.text === "Brand: Toyota"));
});
check("diesel and petrol searches respect fuel", () => {
  const d = search("diesel cars", { fuel: { value: "diesel", strength: "required" } });
  const p = search("petrol cars", { fuel: { value: "petrol", strength: "required" } });
  assert.ok(ids(d).length && ids(p).length);
  for (const id of ids(d)) assert.match(String(byId[id].fuelType), /diesel/i, byId[id].model);
  for (const id of ids(p)) assert.match(String(byId[id].fuelType), /petrol/i, byId[id].model);
  assert.ok(ids(d).every((id) => !ids(p).includes(id)));
});
check("automatic SUVs exclude manual and non-SUV cars", () => {
  const b = search("automatic SUVs", { transmission: { value: "automatic", strength: "required" }, bodyTypes: { values: ["suv", "compact_suv"], strength: "required" } });
  assert.ok(ids(b).length > 0);
  for (const id of ids(b)) {
    assert.ok(["suv", "compact_suv"].includes(byId[id].bodyType), byId[id].model);
    assert.match(String(byId[id].transmission), /automatic/i, byId[id].model);
  }
});
check("brand + budget respects both", () => {
  const b = search("Toyota under 20 lakh", { budgetMaxInr: 2000000 });
  for (const id of ids(b)) {
    assert.equal(byId[id].brandName, "Toyota");
    assert.ok(byId[id].price <= 2000000);
  }
  const all = search("Toyota under 1 crore", { budgetMaxInr: 10000000 });
  assert.ok(ids(all).length > 0);
  assert.deepEqual(brands(all), ["Toyota"]);
});
check("no match: no generic catalogue cars, only near misses with exact reasons", () => {
  const b = search("BMW under 5 lakh", { budgetMaxInr: 500000 });
  assert.deepEqual(b.results, []);
  assert.deepEqual(b.matchedIds, []);
  for (const n of b.nearMisses) assert.ok(n.failed[0].length > 0);
});
check("repeating a search is deterministic", () => {
  const raw = { budgetMaxInr: 10000000, transmission: { value: "automatic", strength: "required" } };
  assert.deepEqual(search("automatic cars under 1 crore", raw), search("automatic cars under 1 crore", raw));
});
check("different searches do not reuse each other's result IDs", () => {
  const a = search("Audi cars", {});
  const v = search("Volvo cars", {});
  assert.deepEqual(brands(a), ["Audi"]);
  assert.deepEqual(brands(v), ["Volvo"]);
  assert.ok(ids(a).every((id) => !ids(v).includes(id)));
});
check("the word 'city' in a request is not read as Honda City", () => {
  assert.equal(queryFacts({}, "automatic for city driving", cars).brands, undefined);
});

console.log("B. Budget");
const car = (id, lakh, over = {}) => ({ id, brandName: "Test", model: id, price: lakh * 100000, availability: "in-stock", status: "published", ...over });
const four = [car("D", 11), car("C", 55), car("A", 78), car("B", 72)];
const run = (query, raw, list = four) => matchResponse({ raw, query, cars: list }).body;
check("80 lakh budget: 78L, 72L, 55L first; 11L last", () => {
  const b = run("a car under 80 lakh", { budgetMaxInr: 8000000 });
  assert.deepEqual(b.results.map((r) => r.carId), ["A", "B", "C"]);
  assert.deepEqual(b.matchedIds, ["A", "B", "C", "D"]);
});
check("budget fit is price / budget, not the same for every car", () => {
  const b = run("a car under 80 lakh", { budgetMaxInr: 8000000 });
  const fit = b.results.map((r) => r.breakdown.find((x) => x.criterion === "Budget fit").score);
  assert.deepEqual(fit, [0.975, 0.9, 0.688]);
});
check("over-budget cars are never matches", () => {
  const b = run("a car under 60 lakh", { budgetMaxInr: 6000000 });
  assert.deepEqual(b.matchedIds, ["C", "D"]);
  assert.ok(!b.results.some((r) => r.price > 6000000));
});
check("cheapest / most affordable / lowest price rank cheapest first", () => {
  for (const q of ["cheapest car under 80 lakh", "most affordable car under 80 lakh", "lowest price car under 80 lakh"]) {
    const b = run(q, { budgetMaxInr: 8000000 });
    assert.deepEqual(b.results.map((r) => r.carId), ["D", "C", "B"], q);
  }
  assert.deepEqual(run("cheapest available cars", {}).results.map((r) => r.carId), ["D", "C", "B"]);
});
check("multi-constraint: fuel is a hard filter, then closest to budget", () => {
  const list = [car("P1", 70, { fuelType: "Petrol" }), car("D1", 40, { fuelType: "Diesel" }), car("D2", 75, { fuelType: "Diesel" }), car("D3", 90, { fuelType: "Diesel" })];
  const b = run("diesel under 80 lakh", { budgetMaxInr: 8000000, fuel: { value: "diesel", strength: "required" } }, list);
  assert.deepEqual(b.matchedIds, ["D2", "D1"]);
});
check("stated needs outrank budget closeness", () => {
  const list = [car("lowkmpl", 79, { fuelEconomyKmpl: 8 }), car("highkmpl", 40, { fuelEconomyKmpl: 20 })];
  const b = run("under 80 lakh with good mileage", { budgetMaxInr: 8000000, priorities: ["fuel_economy"] }, list);
  assert.equal(b.results[0].carId, "highkmpl");
});
check("a car without a price is never a budget match", () => {
  const b = run("a car under 80 lakh", { budgetMaxInr: 8000000 }, [...four, car("X", 0)]);
  assert.ok(!b.matchedIds.includes("X"));
});
check("explanation shows price, budget, amount left and % used", () => {
  const b = run("a car under 80 lakh", { budgetMaxInr: 8000000 });
  assert.ok(b.results[0].explanation.includes("₹78 lakh of your ₹80 lakh budget — ₹2 lakh left (98% used)"), b.results[0].explanation.join(" | "));
});

console.log("C. Frontend / API");
check("an older response can never overwrite a newer search", () => {
  const r = latestOnly();
  const first = r.next();
  const second = r.next();
  assert.equal(r.isLatest(first), false);
  assert.equal(r.isLatest(second), true);
});
const finder = await readFile(new URL("../public/app/js/features/car-finder.js", import.meta.url), "utf8");
const page = await readFile(new URL("../public/app/js/pages/cars.js", import.meta.url), "utf8");
check("each search takes a ticket; late responses are dropped before anything renders", () => {
  assert.ok(/const ticket = requests\.next\(\);/.test(finder));
  const i = finder.indexOf("an older search answered late");
  const j = finder.indexOf("render(data);");
  assert.ok(i > 0 && i < j);
});
check("old results are marked stale while a new search loads", () => {
  assert.ok(/onLoading\(true\)/.test(finder));
  assert.ok(/onLoading: \(on\) => el\.grid\.classList\.toggle\("is-stale", on\)/.test(page));
});
check("the grid shows exactly the current search's matches (none on no-match or error)", () => {
  assert.ok(finder.includes("onNames(new Set(data.matchedIds || data.results.map((r) => r.carId)));"));
  assert.ok(finder.includes("onNames(new Set())"));
  assert.ok(!finder.includes("names.ids.has"), "no client-side merge of name results into AI results");
});
check("name-only searches still filter in code and cancel any AI search in flight", () => {
  const block = finder.slice(finder.indexOf("if (!query || n.nameOnly)"), finder.indexOf("run({ query });"));
  assert.ok(block.includes("requests.next();") && block.includes("onNames(n.ids)"));
});

console.log(`\n${passed} checks passed.`);
