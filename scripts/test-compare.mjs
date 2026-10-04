#!/usr/bin/env node
// AI Personalized Compare: context.js (pure facts, key differences, answer
// validation), the /api/compare-ai handler with fake Gemini, catalogue and
// auth, and the Compare page wiring. No real network; no key needed.
//   node scripts/test-compare.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildCompareContext, validateComparison, NOT_PROVIDED, DISCLAIMER, VERDICTS } from "../server/compare/context.js";
import { handleCompareAi, COMPARE_SCHEMA, COMPARE_PROMPT, QUESTION_MAX, OFF_TOPIC } from "../server/compare/api.js";
import { GeminiError } from "../server/lib/gemini.js";
import { effectiveFields } from "../public/app/js/core/car-fields.js";

globalThis.fetch = () => {
  throw new Error("real network used in a test");
};
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const { cars: fixture } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
const catalogue = fixture.map((c) => ({ ...c, status: "published" }));
const byModel = (m) => catalogue.find((c) => c.model === m);
const venue = { ...byModel("Venue"), bodyType: "compact_suv" };
const city = { ...byModel("City"), bodyType: "sedan" };
const wrangler = byModel("Wrangler Rubicon"); // fuel and transmission conflict in the listing
const innova = byModel("Innova Hycross");
const synthetic = (over) => ({ id: "s", brandName: "X", model: "Y", year: 2022, price: 1_000_000, features: [], specifications: {}, ...over });

console.log("buildCompareContext");
await check("facts come from effectiveFields, each with a car-scoped id, in selection order", () => {
  const ctx = buildCompareContext([venue, city]);
  assert.deepEqual(ctx.cars.map((c) => [c.ref, c.carId]), [["A", venue.id], ["B", city.id]]);
  const e = effectiveFields(venue);
  const fact = (k) => ctx.cars[0].facts.find((f) => f.key === k);
  assert.equal(fact("price").id, "A.price");
  assert.equal(fact("price").value, Number(venue.price));
  assert.equal(fact("bodyType").text, "Compact SUV");
  assert.equal(fact("seats")?.value ?? null, e.seats);
  assert.ok(ctx.cars[1].facts.every((f) => f.id.startsWith("B.")));
});
await check("a fact absent from the listing is listed as missing, never filled in", () => {
  const ctx = buildCompareContext([synthetic({ id: "a" }), synthetic({ id: "b", price: 900000 })]);
  const missing = ctx.cars[0].missing;
  for (const m of ["Body type", "Fuel economy", "Kilometres driven", "Seats", "Airbags", "NCAP rating", "Listed features"]) assert.ok(missing.includes(m), m);
  assert.ok(!ctx.cars[0].facts.some((f) => f.key === "odometerKm"));
});
await check("listing conflicts are reported as missing, not resolved", () => {
  const ctx = buildCompareContext([wrangler, venue]);
  assert.ok(ctx.cars[0].missing.includes("Fuel (the listing contradicts itself)"));
  assert.ok(ctx.cars[0].missing.includes("Transmission (the listing contradicts itself)"));
  assert.ok(!ctx.cars[0].facts.some((f) => f.key === "fuel" || f.key === "transmission"));
});
await check("key differences are computed in code with a single leader, or none on a tie", () => {
  const a = synthetic({ id: "a", price: 800000, seats: 5, bootLitres: 400 });
  const b = synthetic({ id: "b", price: 1200000, seats: 7, bootLitres: 400 });
  const ctx = buildCompareContext([a, b]);
  const diff = (fact) => ctx.keyDifferences.find((k) => k.fact === fact);
  assert.equal(diff("Price").leader.ref, "A");
  assert.equal(diff("Seats").leader.ref, "B");
  assert.equal(diff("Boot space"), undefined, "identical values are not a difference");
  const c = synthetic({ id: "c", price: 800000 });
  assert.equal(buildCompareContext([a, b, c]).keyDifferences.find((k) => k.fact === "Price").leader, null, "a tie has no leader");
});
await check("a difference with a car missing that fact says so", () => {
  const ctx = buildCompareContext([synthetic({ id: "a", seats: 5 }), synthetic({ id: "b", seats: 7 }), synthetic({ id: "c" })]);
  assert.ok(/Not provided in the listing for 1 car/.test(ctx.keyDifferences.find((k) => k.fact === "Seats").note));
});
await check("at most 4 cars are used", () => {
  assert.equal(buildCompareContext([venue, city, innova, wrangler, synthetic({ id: "e" })]).cars.length, 4);
});

console.log("validateComparison");
const ctx2 = buildCompareContext([venue, city]);
const good = (over = {}) => ({
  relevant: true,
  winner: "A",
  winnerReason: "Based on the listing, A is the better fit.",
  noWinnerReason: null,
  summary: "Based on the listing, A suits this better.",
  assessments: [
    { ref: "A", verdict: "best_fit", reasoning: "Higher seating position as a compact SUV.", evidence: ["A.bodyType", "A.price"] },
    { ref: "B", verdict: "good_fit", reasoning: "A sedan.", evidence: ["B.bodyType"] },
  ],
  evidence: ["A.bodyType", "B.bodyType"],
  ...over,
});
await check("a supported winner is kept and evidence is turned into listing facts", () => {
  const v = validateComparison(good(), ctx2);
  assert.deepEqual(v.winner, { ref: "A", carId: venue.id, car: ctx2.cars[0].title });
  assert.deepEqual(v.assessments[0].evidence.map((e) => e.label), ["Body type", "Price"]);
  assert.equal(v.evidence.length, 2);
});
await check("invented fact ids, and ids belonging to the other car, are dropped", () => {
  const v = validateComparison(good({ assessments: [{ ref: "A", verdict: "best_fit", reasoning: "r", evidence: ["A.reliability", "B.price", "A.price"] }, { ref: "B", verdict: "good_fit", reasoning: "r", evidence: ["B.bodyType"] }], evidence: ["Z.price"] }), ctx2);
  assert.deepEqual(v.assessments[0].evidence.map((e) => e.id), ["A.price"]);
  assert.deepEqual(v.evidence, []);
});
await check("a verdict with no supporting fact becomes insufficient_data", () => {
  const v = validateComparison(good({ assessments: [{ ref: "A", verdict: "best_fit", reasoning: "r", evidence: [] }, { ref: "B", verdict: "poor_fit", reasoning: "r", evidence: ["B.made_up"] }] }), ctx2);
  assert.deepEqual(v.assessments.map((a) => a.verdict), ["insufficient_data", "insufficient_data"]);
  assert.equal(v.winner, null, "no evidence, no winner");
});
await check("no forced winner: two best fits, a winner that is not best_fit, or an unknown ref give null", () => {
  const two = good({ assessments: [{ ref: "A", verdict: "best_fit", reasoning: "r", evidence: ["A.price"] }, { ref: "B", verdict: "best_fit", reasoning: "r", evidence: ["B.price"] }] });
  assert.equal(validateComparison(two, ctx2).winner, null);
  assert.equal(validateComparison(good({ winner: "B" }), ctx2).winner, null);
  assert.equal(validateComparison(good({ winner: "D" }), ctx2).winner, null);
  const none = validateComparison(good({ winner: null, noWinnerReason: "Close trade-off." }), ctx2);
  assert.equal(none.winner, null);
  assert.equal(none.winnerReason, "Close trade-off.");
});
await check("missing assessments, unknown verdicts and empty reasoning are safe", () => {
  const v = validateComparison({ assessments: [{ ref: "A", verdict: "perfect", reasoning: "", evidence: ["A.price"] }] }, ctx2);
  assert.equal(v.assessments[0].verdict, "insufficient_data");
  assert.equal(v.assessments[0].reasoning, NOT_PROVIDED);
  assert.equal(v.assessments[1].verdict, "insufficient_data");
  assert.ok(v.winnerReason.length > 0);
  for (const junk of [null, 1, "x", []]) validateComparison(junk, ctx2);
});
await check("each assessment carries the car's missing data", () => {
  const v = validateComparison(good(), ctx2);
  assert.deepEqual(v.assessments[1].missingData, ctx2.cars[1].missing);
});

console.log("Schema and prompt");
await check("schema has nullable winner, verdict enum and cited evidence", () => {
  assert.equal(COMPARE_SCHEMA.properties.winner.nullable, true);
  assert.deepEqual(COMPARE_SCHEMA.properties.assessments.items.properties.verdict.enum, VERDICTS);
  assert.ok(COMPARE_SCHEMA.required.includes("evidence"));
});
await check("prompt forbids outside knowledge and forced winners, and uses the exact missing-data wording", () => {
  for (const bit of ["Use ONLY the facts given", "Never use outside knowledge", NOT_PROVIDED, "Do not force a winner", "recommendation from the listing data"]) assert.ok(COMPARE_PROMPT.includes(bit), bit);
});

console.log("POST /api/compare-ai");
const USER = { uid: "u1", idToken: "t" };
const req = (body, method = "POST") =>
  new Request("https://x/api/compare-ai", method === "POST" ? { method, headers: { "Content-Type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) } : { method });
const deps = (over = {}) => {
  const calls = [];
  return {
    calls,
    auth: async () => USER,
    listCars: async () => catalogue.map((c) => (c.id === venue.id ? venue : c.id === city.id ? city : c)),
    extract: async (env, opts) => {
      calls.push(opts);
      return { data: good(), modelVersion: "gemini-3.5-flash-lite" };
    },
    GeminiError,
    ...over,
  };
};
const ask = { carIds: [venue.id, city.id], question: "Which is better for my parents?" };

await check("signed out is 401 and Gemini is never called", async () => {
  const d = deps({ auth: async () => null });
  assert.equal((await handleCompareAi(req(ask), {}, d)).status, 401);
  assert.equal(d.calls.length, 0);
});
await check("GET is 405, malformed JSON is 400", async () => {
  assert.equal((await handleCompareAi(req(null, "GET"), {}, deps())).status, 405);
  assert.equal((await handleCompareAi(req("{bad"), {}, deps())).status, 400);
});
await check("fewer than 2 or more than 4 distinct cars is 400", async () => {
  for (const carIds of [[venue.id], [venue.id, venue.id], catalogue.slice(0, 5).map((c) => c.id), "x", [1, 2]]) {
    const d = deps();
    const res = await handleCompareAi(req({ ...ask, carIds }), {}, d);
    assert.equal(res.status, 400, JSON.stringify(carIds));
    assert.equal(d.calls.length, 0);
  }
});
await check("empty or too-long question is 400", async () => {
  assert.equal((await handleCompareAi(req({ ...ask, question: "   " }), {}, deps())).status, 400);
  assert.equal((await handleCompareAi(req({ ...ask, question: "x".repeat(QUESTION_MAX + 1) }), {}, deps())).status, 400);
});
await check("a car no longer listed is 404", async () => {
  assert.equal((await handleCompareAi(req({ ...ask, carIds: [venue.id, "gone"] }), {}, deps())).status, 404);
});
await check("only the selected cars reach Gemini, with catalogue facts (not the request's)", async () => {
  const d = deps();
  const res = await handleCompareAi(req({ ...ask, price: 1, cars: [{ model: "Fake" }] }), {}, d);
  assert.equal(res.status, 200);
  const prompt = d.calls[0].user;
  assert.ok(prompt.includes("Which is better for my parents?"));
  assert.ok(prompt.includes(`A.price: Price = ₹${Number(venue.price).toLocaleString("en-IN")}`));
  for (const other of catalogue.filter((c) => c.id !== venue.id && c.id !== city.id)) assert.ok(!prompt.includes(other.model), other.model);
  assert.ok(!prompt.includes("Fake"));
  assert.equal(d.calls[0].schema, COMPARE_SCHEMA);
});
await check("response has every required part", async () => {
  const body = await (await handleCompareAi(req(ask), {}, deps())).json();
  for (const k of ["question", "winner", "summary", "assessments", "evidence", "missingData", "keyDifferences", "disclaimer"]) assert.ok(k in body, k);
  assert.equal(body.question, ask.question);
  assert.equal(body.winner.carId, venue.id);
  assert.equal(body.disclaimer, DISCLAIMER);
  assert.equal(body.missingData.length, 2);
});
await check("an off-topic question is 422 with guidance", async () => {
  const d = deps({ extract: async () => ({ data: good({ relevant: false }), modelVersion: "m" }) });
  const res = await handleCompareAi(req({ ...ask, question: "write me a poem" }), {}, d);
  assert.equal(res.status, 422);
  assert.equal((await res.json()).message, OFF_TOPIC);
});
await check("Gemini failure is 503; catalogue failure is 503; no partial answer", async () => {
  const g = await handleCompareAi(req(ask), {}, deps({ extract: async () => { throw new GeminiError("The AI service is busy right now. Please try again in a moment."); } }));
  assert.equal(g.status, 503);
  assert.ok(!("assessments" in (await g.json())));
  assert.equal((await handleCompareAi(req(ask), {}, deps({ listCars: async () => { throw new Error("down"); } }))).status, 503);
});

console.log("Compare page and wiring");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [page, html, worker] = await Promise.all([read("../public/app/js/pages/compare.js"), read("../public/app/pages/compare.html"), read("../server/worker.js")]);
await check("the old full comparison table is gone; selection, remove and clear stay", () => {
  assert.ok(!/extraSpecs|orNotProvided|\["Engine", \(c\)/.test(page), "old table fields still present");
  for (const bit of ["listCompare", "removeCompare", "data-rm", '"clear"']) assert.ok(page.includes(bit), bit);
});
await check("page sends only ids and the question, signed in, to /api/compare-ai", () => {
  assert.ok(/fetch\("\/api\/compare-ai"/.test(page));
  assert.ok(/JSON\.stringify\(\{ carIds: cars\.map\(\(c\) => c\.id\), question \}\)/.test(page));
  assert.ok(/requireUser\("\.\.\/"\)/.test(page) && /Bearer \$\{await idToken\(\)\}/.test(page));
  assert.ok(!/generativelanguage|GEMINI_API_KEY/.test(page));
});
await check("page shows the placeholder, examples, facts behind each judgement and the recommendation label", () => {
  assert.ok(page.includes("Ask AI which car is better for your needs..."));
  for (const q of ["Which is better for my parents?", "Which is better for city driving?", "Which is better for highway use?", "Which gives better value?", "Which is more practical for a family?"]) assert.ok(page.includes(q), q);
  assert.ok(page.includes("Listing facts behind this"));
  assert.ok(page.includes("No clear winner from the listing data"));
  assert.ok(page.includes("not an objective fact"));
  assert.ok(/<h1[^>]*>AI Compare<\/h1>/.test(html));
});
await check("worker routes /api/compare-ai with the signed-in user deps", () => {
  assert.ok(/"\/api\/compare-ai"\) return handleCompareAi\(request, env, aiDeps\)/.test(worker));
});

console.log(`\n${passed} checks passed. (Fakes only; no real network.)`);
