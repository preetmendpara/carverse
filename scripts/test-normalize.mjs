#!/usr/bin/env node
// Phase 0.6: one interpretation of car data for display, filters, search and
// (later) /api/match. Uses a read-only snapshot of the live cars.
//   node scripts/test-normalize.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as F from "../public/app/js/core/car-fields.js";

const fixture = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
const cars = fixture.cars;
const byModel = (m) => cars.find((c) => c.model === m);

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const eff = F.effectiveFields;

console.log("Fuel");
check("normalised petrol", () => assert.deepEqual(eff({ fuelTypes: ["petrol"] }), { ...eff({ fuelTypes: ["petrol"] }), fuelTypes: ["petrol"], fuelStatus: "ok" }));
check("normalised diesel", () => {
  const e = eff({ fuelTypes: ["diesel"], fuelType: "Petrol" });
  assert.deepEqual([e.fuelTypes, e.fuelStatus], [["diesel"], "ok"]);
});
check("unambiguous legacy petrol", () => {
  const e = eff({ fuelType: "Petrol" });
  assert.deepEqual([e.fuelTypes, e.fuelStatus], [["petrol"], "ok"]);
});
check("unambiguous legacy diesel (specification agrees)", () => {
  const e = eff({ fuelType: "Diesel", specifications: { Fuel: "Diesel" } });
  assert.deepEqual([e.fuelTypes, e.fuelStatus], [["diesel"], "ok"]);
});
check("Range Rover 'petrol and diesel' -> conflict, no fuel", () => {
  const e = eff(byModel("Range Rover Vogue"));
  assert.deepEqual([e.fuelTypes, e.fuelStatus], [null, "conflict"]);
});
check("legacy vs specification contradiction (Wrangler) -> conflict", () => {
  const e = eff(byModel("Wrangler Rubicon"));
  assert.deepEqual([e.fuelTypes, e.fuelStatus], [null, "conflict"]);
});
check("contradiction under another spec key name ('Fuel type') is caught too", () => {
  assert.equal(eff({ fuelType: "Petrol", specifications: { "Fuel type": "Diesel" } }).fuelStatus, "conflict");
});
check("nothing recorded -> missing", () => assert.equal(eff({}).fuelStatus, "missing"));
check("unrecognised legacy value -> conflict, not guessed", () => assert.equal(eff({ fuelType: "LPG" }).fuelStatus, "conflict"));
check("structured value with several fuels or an unknown fuel -> conflict", () => {
  assert.equal(eff({ fuelTypes: ["petrol", "diesel"] }).fuelStatus, "conflict");
  assert.equal(eff({ fuelTypes: ["lpg"] }).fuelStatus, "conflict");
});

console.log("Transmission");
check("normalised automatic", () => {
  const e = eff({ transmissionNorm: "automatic", transmission: "Manual" });
  assert.deepEqual([e.transmissionNorm, e.transmissionStatus], ["automatic", "ok"]);
});
check("normalised manual", () => {
  const e = eff({ transmissionNorm: "manual" });
  assert.deepEqual([e.transmissionNorm, e.transmissionStatus], ["manual", "ok"]);
});
check("legacy automatic fallback", () => {
  const e = eff({ transmission: "Automatic" });
  assert.deepEqual([e.transmissionNorm, e.transmissionStatus], ["automatic", "ok"]);
});
check("legacy manual fallback", () => {
  const e = eff({ transmission: "Manual", specifications: { Transmission: "Manual" } });
  assert.deepEqual([e.transmissionNorm, e.transmissionStatus], ["manual", "ok"]);
});
check("Wrangler contradiction -> conflict, no transmission", () => {
  const e = eff(byModel("Wrangler Rubicon"));
  assert.deepEqual([e.transmissionNorm, e.transmissionStatus], [null, "conflict"]);
});
check("contradiction under 'Gearbox' is caught too", () => {
  assert.equal(eff({ transmission: "Manual", specifications: { Gearbox: "Automatic" } }).transmissionStatus, "conflict");
});

console.log("Other effective fields");
check("placeholder odometers never become odometerKm", () => {
  for (const c of cars) assert.equal(eff(c).odometerKm, null, c.model);
});
check("legacy 'km' mileage never becomes fuel economy (F-150)", () => assert.equal(eff(byModel("F-150 Raptor")).fuelEconomyKmpl, null));
check("legacy kmpl mileage is used when there is no structured value", () => assert.equal(eff({ mileage: "16 kmpl" }).fuelEconomyKmpl, 16));
check("bodyType, safety, colour, owners are never invented", () => {
  for (const c of cars) {
    const e = eff(c);
    for (const k of ["bodyType", "airbags", "ncapStars", "colour", "owners"]) assert.equal(e[k], null, `${c.model}.${k}`);
  }
  assert.equal(eff({ bodyType: "spaceship" }).bodyType, null);
});
check("the effective record is plain JSON (serialisable for /api/match)", () => {
  for (const c of cars) assert.deepEqual(JSON.parse(JSON.stringify(eff(c))), eff(c));
});
check("normalising does not change the original fields", () => {
  const copy = JSON.parse(JSON.stringify(cars));
  copy.forEach(eff);
  assert.deepEqual(copy, cars);
});

console.log("Filter consistency (every live car)");
check("fuel: filter matches exactly the fuel the car page displays", () => {
  for (const c of cars) {
    const shown = F.fuelText(c); // e.g. "Petrol", or null
    for (const [k, l] of F.FUELS) assert.equal(F.matchesFuel(c, k), shown === l, `${c.model} / ${k}`);
  }
});
check("transmission: filter matches exactly what the car page displays", () => {
  for (const c of cars) {
    const shown = F.transmissionText(c);
    for (const [k, l] of F.TRANSMISSIONS) assert.equal(F.matchesTransmission(c, k), shown === l, `${c.model} / ${k}`);
  }
});
check("a conflicting car appears under All but under no specific fuel or transmission", () => {
  for (const m of ["Wrangler Rubicon", "Range Rover Vogue"]) {
    const c = byModel(m);
    assert.ok(F.matchesFuel(c, "") && F.matchesTransmission(c, ""));
    assert.ok(F.FUELS.every(([k]) => !F.matchesFuel(c, k)), m);
  }
  assert.ok(F.TRANSMISSIONS.every(([k]) => !F.matchesTransmission(byModel("Wrangler Rubicon"), k)));
});
check("catalogue-attached record and freshly computed record agree", () => {
  for (const c of cars) {
    const attached = { ...c, effective: eff(c) };
    assert.equal(F.fuelText(attached), F.fuelText(c));
    assert.equal(F.matchesTransmission(attached, "automatic"), F.matchesTransmission(c, "automatic"));
  }
});
check("filter counts on the live data", () => {
  const count = (fn, v) => cars.filter((c) => fn(c, v)).length;
  // Wrangler (conflict) is no longer counted under Manual or Petrol, and
  // Range Rover (conflict) no longer creates a "petrol and diesel" option.
  assert.deepEqual(
    { petrol: count(F.matchesFuel, "petrol"), diesel: count(F.matchesFuel, "diesel"), automatic: count(F.matchesTransmission, "automatic"), manual: count(F.matchesTransmission, "manual") },
    { petrol: 14, diesel: 2, automatic: 12, manual: 5 }
  );
});

console.log("Search");
check("search uses effective values: a conflicting car does not match 'manual' or 'petrol'", () => {
  const w = F.searchText(byModel("Wrangler Rubicon"));
  assert.ok(!w.includes("manual") && !w.includes("petrol"));
  assert.ok(w.includes("jeep") && w.includes("wrangler"));
});
check("search still finds brand, model, year and engine as before", () => {
  const v = F.searchText(byModel("Venue"));
  for (const s of ["hyundai", "venue", "2026", "petrol", "automatic"]) assert.ok(v.includes(s), s);
});
check("search finds 'suv' only once a body type is recorded, never invented", () => {
  assert.ok(!F.searchText(byModel("Venue")).includes("suv"));
  assert.ok(F.searchText({ ...byModel("Venue"), bodyType: "compact_suv" }).includes("suv"));
});

console.log("Shared with the future Worker");
const src = await readFile(new URL("../public/app/js/core/car-fields.js", import.meta.url), "utf8");
check("car-fields.js imports nothing, touches no DOM or browser API", () => {
  assert.ok(!/^\s*import\s/m.test(src), "has an import");
  assert.ok(!/\b(document|window|localStorage|sessionStorage|fetch)\b/.test(src), "uses a browser API");
});

console.log(`\n${passed} checks passed.`);
