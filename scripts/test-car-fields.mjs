#!/usr/bin/env node
// Display and fallback rules for car fields (public/app/js/core/car-fields.js).
//   node scripts/test-car-fields.mjs
import assert from "node:assert/strict";
import * as F from "../public/app/js/core/car-fields.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

// The eight cases asked for in Phase 0.5.
check("1. normalised fuel economy wins over legacy mileage", () => {
  assert.equal(F.fuelEconomyText({ fuelEconomyKmpl: 17.9, mileage: "15 kmpl" }), "17.9 kmpl");
});
check("2. no normalised value + legacy kmpl -> falls back to legacy", () => {
  assert.equal(F.fuelEconomyText({ fuelEconomyKmpl: null, mileage: "16 kmpl" }), "16 kmpl");
  assert.equal(F.fuelEconomyText({ mileage: "16.35 km/l" }), "16.35 km/l");
});
check("3. no normalised value + legacy mileage is an odometer -> NOT fuel economy", () => {
  assert.equal(F.fuelEconomyText({ fuelEconomyKmpl: null, mileage: "26,400 km" }), null);
  assert.equal(F.fuelEconomyText({ mileage: "26400 kms" }), null);
  assert.equal(F.fuelEconomyText({ mileage: "12" }), null);
});
check("4. odometer missing -> Not provided (placeholders never shown)", () => {
  const car = { odometerKm: null, mileage: "26,400 km", specifications: { Odometer: "21,000 km" } };
  assert.equal(F.kmDrivenText(car), null);
  assert.equal(F.orNotProvided(F.kmDrivenText(car)), "Not provided");
  assert.equal(F.kmDrivenText({ odometerKm: 45210 }), "45,210 km");
});
check("5. normalised transmission wins", () => {
  assert.equal(F.transmissionText({ transmissionNorm: "automatic", transmission: "Manual" }), "Automatic");
});
check("6. normalised fuel type wins", () => {
  assert.equal(F.fuelText({ fuelTypes: ["diesel"], fuelType: "Petrol" }), "Diesel");
});
check("7. bodyType null -> no fake value", () => {
  assert.equal(F.bodyTypeText({ bodyType: null, model: "Venue" }), null);
  assert.equal(F.bodyTypeText({}), null);
  assert.equal(F.bodyTypeText({ bodyType: "compact_suv" }), "Compact SUV");
});
check("8. safety null -> no fake value", () => {
  assert.equal(F.airbagsText({ airbags: null }), null);
  assert.equal(F.ncapText({ ncapStars: null }), null);
  assert.equal(F.airbagsText({}), null);
  assert.equal(F.airbagsText({ airbags: 6 }), "6");
  assert.equal(F.ncapText({ ncapStars: 5 }), "5-star");
  assert.equal(F.ncapText({ ncapStars: 0 }), "0-star");
});

// Conflicts are shown as unconfirmed, never resolved by picking a side.
check("fuel conflict (Wrangler) -> no fuel shown, flagged as conflict", () => {
  const w = { fuelTypes: null, fuelType: "Petrol", specifications: { Fuel: "Diesel" } };
  assert.equal(F.fuelText(w), null);
  assert.equal(F.fuelConflict(w), true);
  assert.equal(F.orNotProvided(F.fuelText(w), F.fuelConflict(w)), "Not confirmed");
});
check("multi-fuel listing (Range Rover) -> not confirmed", () => {
  const r = { fuelTypes: null, fuelType: "petrol and diesel" };
  assert.equal(F.fuelText(r), null);
  assert.equal(F.fuelConflict(r), true);
});
check("transmission conflict (Wrangler) -> not confirmed", () => {
  const w = { transmissionNorm: null, transmission: "Manual", specifications: { Transmission: "Automatic" } };
  assert.equal(F.transmissionText(w), null);
  assert.equal(F.transmissionConflict(w), true);
});
check("an admin-entered normalised value clears the conflict", () => {
  const w = { fuelTypes: ["diesel"], fuelType: "Petrol", specifications: { Fuel: "Diesel" } };
  assert.equal(F.fuelConflict(w), false);
  assert.equal(F.fuelText(w), "Diesel");
});
check("legacy fuel and transmission still work when there is no conflict", () => {
  assert.equal(F.fuelText({ fuelType: "Petrol" }), "Petrol");
  assert.equal(F.transmissionText({ transmission: "Manual" }), "Manual");
  assert.equal(F.fuelText({ fuelType: "Petrol", specifications: { Fuel: "Petrol" } }), "Petrol");
});

check("measured values: normalised with unit, else legacy text as written", () => {
  assert.equal(F.powerText({ powerHp: 134, horsepower: "134 hp" }), "134 hp");
  assert.equal(F.powerText({ horsepower: "201 to 204" }), "201 to 204");
  assert.equal(F.groundClearanceText({ groundClearanceMm: 190 }), "190 mm");
  assert.equal(F.groundClearanceText({ groundClearance: "190 mm" }), "190 mm");
  assert.equal(F.bootText({ bootLitres: 476 }), "476 litres");
  assert.equal(F.bootText({}), null);
});

check("missing or odd values never throw", () => {
  for (const car of [undefined, null, {}, { specifications: null }, { fuelTypes: [] }, { mileage: 17.9 }]) {
    for (const fn of [F.fuelEconomyText, F.kmDrivenText, F.fuelText, F.transmissionText, F.powerText, F.groundClearanceText, F.bootText, F.bodyTypeText, F.colourText, F.ownersText, F.airbagsText, F.ncapText, F.extraSpecs])
      fn(car);
  }
});

check("specifications extras hide covered keys (placeholder odometer, fuel, year, ownership)", () => {
  const car = { specifications: { Odometer: "21,000 km", Fuel: "Petrol", Transmission: "Automatic", Year: "2022", Ownership: "First owner", Registration: "Available on request", Warranty: "2 years" } };
  assert.deepEqual(F.extraSpecs(car), [["Registration", "Available on request"], ["Warranty", "2 years"]]);
});

check("provenance never says verified", () => {
  assert.equal(F.provenanceText({ provenance: { fuelEconomyKmpl: "migrated:mileage" } }, "fuelEconomyKmpl"), 'Migrated from old "mileage"');
  assert.equal(F.provenanceText({ provenance: { colour: "admin" } }, "colour"), "Entered by admin");
  assert.equal(F.provenanceText({ provenance: { bodyType: "reference:carModels (unverified)" } }, "bodyType"), "Reference data");
  assert.equal(F.provenanceText({}, "owners"), "Unknown source");
  for (const p of ["migrated:x", "admin", "reference:y", "database:z", ""])
    assert.ok(!/verified/i.test(F.provenanceText({ provenance: { f: p } }, "f").replace("unverified", "")));
});

console.log(`\n${passed} checks passed.`);
