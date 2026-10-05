#!/usr/bin/env node
// The Cars page's single search input: which queries are brand/model name
// searches (filtered in code, no AI) and which go to the AI Finder.
// Uses the post-migration catalogue snapshot. No network.
//   node scripts/test-name-search.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { nameSearch } from "../public/app/js/core/name-search.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const { cars } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
const models = (r) => (r.ids ? [...r.ids].map((id) => cars.find((c) => c.id === id).model).sort() : null);
const name = (q, expected) => {
  const r = nameSearch(cars, q);
  assert.equal(r.nameOnly, true, `"${q}" should be a name search`);
  assert.deepEqual(models(r), [...expected].sort(), q);
};
const toAi = (q, brandModels = null) => {
  const r = nameSearch(cars, q);
  assert.equal(r.nameOnly, false, `"${q}" should go to the AI Finder`);
  assert.deepEqual(models(r), brandModels && [...brandModels].sort(), q);
};

console.log("Partial and case-insensitive names");
check('"Range Rover" -> Range Rover Vogue', () => name("Range Rover", ["Range Rover Vogue"]));
check('"Defender" -> Defender 110', () => name("Defender", ["Defender 110"]));
check('"Fortuner" -> Toyota Fortuner', () => name("Fortuner", ["Fortuner"]));
check('"M4" -> BMW M4 Competition', () => name("M4", ["M4 Competition"]));
check('"X1" -> BMW X1', () => name("X1", ["X1"]));
check('"Innova" -> Toyota Innova Hycross', () => name("Innova", ["Innova Hycross"]));
check("case and filler words do not matter", () => {
  name("find RANGE rover", ["Range Rover Vogue"]);
  name("Show me the bmw x1 please", ["X1"]);
  name("Find Toyota Fortuner", ["Fortuner"]);
});
check("brand alone gives every car of that brand", () => {
  name("Find BMW", ["X1", "M4 Competition"]);
  name("toyota", ["Fortuner", "Innova Hycross"]);
  name("Land Rover", ["Range Rover Vogue", "Defender 110"]);
});
check("a word prefix of a name works (3+ letters)", () => name("innov", ["Innova Hycross"]));
check('"any model" / "show all cars" -> every car, no filter', () => {
  for (const q of ["Find any model", "show all cars", "cars", ""]) {
    const r = nameSearch(cars, q);
    assert.equal(r.nameOnly, true, q);
    assert.equal(r.ids, null, q);
  }
});

console.log("Ordinary words are not car names");
check('"city driving" goes to AI and is not Honda City', () => toAi("city driving"));
check('"automatic for city driving" goes to AI', () => toAi("automatic for city driving"));
check('"good family car" goes to AI', () => toAi("good family car"));
check('"automatic SUV under ₹15 lakh" goes to AI', () => toAi("Find any automatic SUV under ₹15 lakh"));
check('"cars under ₹12 lakh" goes to AI', () => toAi("Find cars under ₹12 lakh"));
check("name words no single car has together go to AI (a brand among them still narrows)", () => toAi("bmw fortuner", ["X1", "M4 Competition"]));
check('"Find City" alone is a name search for Honda City', () => name("Find City", ["City"]));

console.log("Brand inside an AI request");
check('"BMW under 50 lakh" goes to AI, limited to BMW', () => toAi("BMW under 50 lakh", ["X1", "M4 Competition"]));
check("a lone model word in a request never narrows it", () => toAi("Defender style ground clearance under 1 crore"));

console.log(`\n${passed} checks passed.`);
