#!/usr/bin/env node
// Specific models and variants named inside AI Car Finder requests are found by
// code and enforced server-side as hard requirements (H10 model, H11 variant).
//   node scripts/test-model-mentions.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { modelMentions } from "../public/app/js/core/name-search.js";
import { matchResponse, queryFacts } from "../server/match/pipeline.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const { cars: fixture } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
const cars = fixture.map((c) => ({ ...c, status: "published" }));
const byId = Object.fromEntries(cars.map((c) => [c.id, c]));
const name = (id) => `${byId[id].brandName} ${byId[id].model}`;
const search = (query, raw = {}) => matchResponse({ raw, query, cars }).body;
const models = (q) => modelMentions(cars, q).models;

console.log("Detection");
check("models named inside longer requests", () => {
  assert.deepEqual(models("Fortuner under 50 lakh"), ["Toyota Fortuner"]);
  assert.deepEqual(models("BMW X1 automatic"), ["BMW X1"]);
  assert.deepEqual(models("Honda City under 15 lakh"), ["Honda City"]);
  assert.deepEqual(models("Range Rover diesel"), ["Land Rover Range Rover Vogue"]);
  assert.deepEqual(models("M4 under 80 lakh"), ["BMW M4 Competition"]);
  assert.deepEqual(models("i20 automatic"), ["Hyundai i20"]);
});
check("variants are detected with their model", () => {
  assert.deepEqual(modelMentions(cars, "Fortuner 4x4 diesel"), { models: ["Toyota Fortuner"], variants: ["4X4"] });
});
check("ordinary words never become model names", () => {
  for (const q of ["automatic for city driving", "family SUV for highway driving", "good family car", "a car under 80 lakh", "Defender style ground clearance", "a good venue for weddings", "elevate my driving", "SUV with good range"])
    assert.deepEqual(models(q), [], q);
});
check("an ordinary-word model counts next to its brand", () => {
  assert.deepEqual(models("Honda City"), ["Honda City"]);
  assert.deepEqual(models("Land Rover Defender diesel"), ["Land Rover Defender 110"]);
});

console.log("Server-side enforcement");
check("Fortuner under 50 lakh -> Fortuner only", () => {
  const b = search("Fortuner under 50 lakh", { budgetMaxInr: 5000000 });
  assert.deepEqual(b.requirements.models, ["Toyota Fortuner"]);
  assert.deepEqual(b.matchedIds.map(name), ["Toyota Fortuner"]);
  assert.ok(b.understood.some((c) => c.id === "models:Toyota Fortuner"));
});
check("BMW X1 automatic -> X1 only, automatic required", () => {
  const b = search("BMW X1 automatic", { transmission: { value: "automatic", strength: "required" } });
  assert.deepEqual(b.matchedIds.map(name), ["BMW X1"]);
  assert.equal(b.requirements.transmission.strength, "required");
});
check("Honda City under 15 lakh -> City only (not Elevate)", () => {
  assert.deepEqual(search("Honda City under 15 lakh", { budgetMaxInr: 1500000 }).matchedIds.map(name), ["Honda City"]);
});
check("Range Rover diesel -> Range Rover only; its own fuel issue is the near miss", () => {
  const b = search("Range Rover diesel", { fuel: { value: "diesel", strength: "required" } });
  assert.ok(b.matchedIds.every((id) => byId[id].model.startsWith("Range Rover")));
  assert.ok(b.nearMisses.every((n) => n.title.includes("Range Rover")));
});
check("M4 under 80 lakh -> no unrelated cars; the M4 is the near miss with its real price", () => {
  const b = search("M4 under 80 lakh", { budgetMaxInr: 8000000 });
  assert.deepEqual(b.matchedIds, []);
  assert.deepEqual(b.results, []);
  assert.deepEqual(b.nearMisses.map((n) => n.title), ["BMW M4 Competition"]);
  assert.match(b.nearMisses[0].failed[0], /above your ₹80 lakh budget/);
});
check("a model CarVerse does not stock is an honest no-match, never other models", () => {
  const b = search("Swift under 8 lakh", { budgetMaxInr: 800000, carRef: "Maruti Swift" });
  assert.deepEqual(b.requirements.models, ["Maruti Swift"]);
  assert.deepEqual(b.matchedIds, []);
  assert.deepEqual(b.nearMisses, []);
});
check("generic or brand-only carRef never becomes a model requirement", () => {
  for (const ref of ["SUV", "family car", "cars", "BMW", "a sedan"]) assert.equal(queryFacts({ carRef: ref }, "something", cars).models, undefined, ref);
});
check("'city driving' still never matches Honda City", () => {
  const b = search("automatic for city driving", { transmission: { value: "automatic", strength: "required" }, usage: ["city"] });
  assert.equal(b.requirements.models.length, 0);
  assert.ok(b.matchedIds.length > 1);
});
check("other models are never near misses for a named model", () => {
  const b = search("Fortuner under 50 lakh", { budgetMaxInr: 5000000 });
  assert.ok(b.nearMisses.every((n) => n.title.includes("Fortuner")));
});
check("removing the model chip widens the search again", () => {
  const b = search("Fortuner under 50 lakh", { budgetMaxInr: 5000000 });
  const widened = matchResponse({ raw: { ...b.requirements, models: [], brands: [] }, query: null, cars }).body;
  assert.ok(widened.matchedIds.length > 1);
});

console.log(`\n${passed} checks passed.`);
