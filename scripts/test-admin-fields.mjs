#!/usr/bin/env node
// Admin data safety: saving the car form must never silently null or replace
// a stored normalised value.
//   node scripts/test-admin-fields.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NORMALIZED_FIELDS, STORED, fieldView, parseControl, buildNormalizedWrite, reconcileReview, buildBasicWrite } from "../public/app/js/core/admin-fields.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const field = (k) => NORMALIZED_FIELDS.find(([key]) => key === k);

// What the form does: render every field, optionally let the admin change some
// controls, then build the save.
function openAndSave(car, edits = {}) {
  const controls = {};
  for (const f of NORMALIZED_FIELDS) {
    const v = fieldView(f, car);
    controls[f[0]] = { initial: v.value, current: f[0] in edits ? edits[f[0]] : v.value };
  }
  return buildNormalizedWrite(car, controls);
}
// setDoc(ref, data, { merge: true }): keys present in data replace, others stay.
const merge = (stored, data) => ({ ...stored, ...data });

const weird = {
  id: "w",
  fuelTypes: ["lpg"],
  transmissionNorm: "cvt",
  odometerKm: "not-a-number",
  bodyType: "spaceship",
  colour: 42,
  powerHp: 150,
  provenance: { powerHp: "migrated:horsepower" },
};

console.log("Rendering stored values the options cannot show");
check('fuelTypes ["lpg"] -> "Stored value: lpg" option, selected, with a warning', () => {
  const v = fieldView(field("fuelTypes"), weird);
  assert.equal(v.value, STORED);
  assert.ok(v.options.some((o) => o.value === STORED && o.label === "Stored value: lpg"));
  assert.match(v.warning, /not one of the standard options.*kept/);
});
check('transmissionNorm "cvt" -> "Stored value: cvt", with a warning', () => {
  const v = fieldView(field("transmissionNorm"), weird);
  assert.equal(v.value, STORED);
  assert.ok(v.options.some((o) => o.label === "Stored value: cvt"));
  assert.ok(v.warning);
});
check('odometerKm "not-a-number" -> shown as text, not blanked, with a warning', () => {
  const v = fieldView(field("odometerKm"), weird);
  assert.equal(v.inputType, "text");
  assert.equal(v.value, "not-a-number");
  assert.match(v.warning, /not a number.*kept/);
});
check('multi-fuel ["petrol","diesel"] -> "Stored value: petrol, diesel", not reduced to one', () => {
  const v = fieldView(field("fuelTypes"), { fuelTypes: ["petrol", "diesel"] });
  assert.equal(v.value, STORED);
  assert.ok(v.options.some((o) => o.label === "Stored value: petrol, diesel"));
});
check("unknown bodyType and non-text colour are shown and flagged", () => {
  assert.equal(fieldView(field("bodyType"), weird).value, STORED);
  const c = fieldView(field("colour"), weird);
  assert.equal(c.value, "42");
  assert.ok(c.warning);
});
check("normal values render normally, with no warning", () => {
  const car = { fuelTypes: ["diesel"], transmissionNorm: "manual", odometerKm: 45210, bodyType: "suv", colour: "White" };
  assert.deepEqual(
    ["fuelTypes", "transmissionNorm", "odometerKm", "bodyType", "colour"].map((k) => [fieldView(field(k), car).value, fieldView(field(k), car).warning]),
    [["diesel", null], ["manual", null], ["45210", null], ["suv", null], ["White", null]]
  );
  assert.equal(fieldView(field("odometerKm"), car).inputType, "number");
});
check("absent and null values render as empty, with no warning", () => {
  for (const f of NORMALIZED_FIELDS) {
    assert.equal(fieldView(f, {}).value, "", f[0]);
    assert.equal(fieldView(f, { [f[0]]: null }).value, "", f[0]);
    assert.equal(fieldView(f, {}).warning, null, f[0]);
  }
});

console.log("Saving");
check("saving with no normalised changes writes NO normalised field", () => {
  assert.deepEqual(openAndSave(weird).write, {});
});
check("saving an unrelated change keeps every unsupported value exactly (after merge)", () => {
  const { write } = openAndSave(weird); // e.g. the admin only edited the price
  const after = merge(weird, { price: 999, ...write });
  for (const k of ["fuelTypes", "transmissionNorm", "odometerKm", "bodyType", "colour", "powerHp"]) assert.deepEqual(after[k], weird[k], k);
});
check("multi-fuel list survives an unrelated save", () => {
  const car = { fuelTypes: ["petrol", "diesel"] };
  assert.deepEqual(merge(car, openAndSave(car).write).fuelTypes, ["petrol", "diesel"]);
});
check("explicitly choosing a standard option replaces the stored value, marked admin", () => {
  const { write, provenance } = openAndSave(weird, { fuelTypes: "diesel", transmissionNorm: "automatic" });
  assert.deepEqual(write, { fuelTypes: ["diesel"], transmissionNorm: "automatic" });
  assert.equal(provenance.fuelTypes, "admin");
  assert.equal(provenance.transmissionNorm, "admin");
});
check("explicitly clearing writes null, marked unknown", () => {
  const { write, provenance } = openAndSave(weird, { odometerKm: "" });
  assert.deepEqual(write, { odometerKm: null });
  assert.equal(provenance.odometerKm, "unknown");
});
check("correcting a malformed number with a real one saves the number", () => {
  assert.deepEqual(openAndSave(weird, { odometerKm: "12000" }).write, { odometerKm: 12000 });
});
check("an invalid change is refused and nothing is saved", () => {
  assert.throws(() => openAndSave(weird, { odometerKm: "twelve" }), /Kilometres driven: "twelve" is not a valid value/);
  assert.throws(() => openAndSave({}, { ncapStars: "7" }), /not a valid value/);
  assert.throws(() => openAndSave({}, { owners: "0" }), /not a valid value/);
  assert.throws(() => openAndSave({}, { fuelTypes: "lpg" }), /not an allowed option/);
});
check("unchanged fields keep their recorded provenance", () => {
  const { provenance } = openAndSave(weird, { colour: "Red" });
  assert.equal(provenance.powerHp, "migrated:horsepower");
  assert.equal(provenance.colour, "admin");
  assert.equal(provenance.fuelTypes, undefined);
});
check("a new car with nothing entered writes nothing (no invented values)", () => {
  assert.deepEqual(openAndSave(null).write, {});
});
check("a new car with values entered writes only those", () => {
  assert.deepEqual(openAndSave(null, { bodyType: "sedan", owners: "1" }).write, { bodyType: "sedan", owners: 1 });
});
const fixture = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
check("the 18 live cars: an unchanged save writes no normalised field", () => {
  for (const car of fixture.cars) assert.deepEqual(openAndSave(car).write, {}, car.model);
});
check("parseControl never accepts the stored-value marker as new input", () => {
  assert.throws(() => parseControl(field("fuelTypes"), STORED), /can only be kept/);
});

console.log("Wiring in admin.js");
const admin = await readFile(new URL("../public/app/js/pages/admin.js", import.meta.url), "utf8");
check("admin.js saves through buildNormalizedWrite and escapes rendered values", () => {
  assert.ok(/buildNormalizedWrite\(car, readNormalizedControls\(\)\)/.test(admin));
  assert.ok(!/readNormalized\(\)|normalizedValue\(/.test(admin), "old save path still present");
  const render = admin.slice(admin.indexOf("function normalizedInput"), admin.indexOf("const readNormalizedControls"));
  for (const bit of ["esc(o.label)", "esc(o.value)", "esc(v.value)", "esc(v.warning)", "esc(v.label)"]) assert.ok(render.includes(bit), bit);
});

check("admin list flags cars without a body type, using the same rule as the matcher", () => {
  const list = admin.slice(admin.indexOf("async function cars()"), admin.indexOf("const SIMPLE_FIELDS"));
  assert.ok(/effectiveFields\(c\)\.bodyType === null/.test(list), "list does not use effectiveFields");
  assert.ok(list.includes("No body type"));
  assert.ok(list.includes("have no body type"));
});
check("an empty body type renders empty with a hint, and a normal save never fills it in", () => {
  const car = { bodyType: null, model: "Venue", description: "compact SUV" };
  assert.equal(fieldView(field("bodyType"), car).value, "");
  assert.deepEqual(openAndSave(car).write, {});
});
const seed = await readFile(new URL("./seed-car-models.mjs", import.meta.url), "utf8");
const mig = await readFile(new URL("./migrate-phase0.mjs", import.meta.url), "utf8");
check("no script writes body types: seeding has no write step, the migration sets bodyType null", () => {
  assert.ok(!/fetch\(|method:/.test(seed));
  assert.ok(/derived\.bodyType = null;/.test(mig));
});

console.log("dataReview after a save");
// The Kia Seltos as stored before the admin set its body type (2026-09-29).
const seltos = {
  bodyType: null, odometerKm: null, fuelTypes: ["petrol"], transmissionNorm: "manual",
  dataReview: [
    "Kilometres driven not provided",
    'Body type not recorded (draft reference says "compact_suv", unverified)',
    "Missing: horsepower, torque, bootSpace",
  ],
};
check("setting bodyType removes its note and keeps every unrelated note, in order", () => {
  const { write } = openAndSave(seltos, { bodyType: "compact_suv" });
  assert.deepEqual(write, { bodyType: "compact_suv" });
  assert.deepEqual(reconcileReview(seltos.dataReview, write), ["Kilometres driven not provided", "Missing: horsepower, torque, bootSpace"]);
});
check("clearing bodyType restores its note, once", () => {
  const car = { ...seltos, bodyType: "compact_suv", dataReview: ["Missing: horsepower, torque, bootSpace"] };
  const { write } = openAndSave(car, { bodyType: "" });
  assert.deepEqual(write, { bodyType: null });
  const once = reconcileReview(car.dataReview, write);
  assert.deepEqual(once, ["Missing: horsepower, torque, bootSpace", "Body type not recorded"]);
  assert.deepEqual(reconcileReview(once, write), once);
});
check("untouched fields are not written and leave dataReview exactly as it was", () => {
  const { write } = openAndSave(seltos);
  assert.deepEqual(write, {});
  assert.deepEqual(reconcileReview(seltos.dataReview, write), seltos.dataReview);
});
check("setting odometerKm drops the placeholder note too; conflicts and other notes stay", () => {
  const review = [
    'Kilometres driven not provided. "21,000 km" is a placeholder shared with other cars; enter the real reading',
    'Fuel conflict: fuelType "Petrol" but specifications.Fuel "Diesel"',
    "Seats not recorded",
  ];
  const { write } = openAndSave({ odometerKm: null, dataReview: review }, { odometerKm: "42000" });
  assert.deepEqual(write, { odometerKm: 42000 });
  assert.deepEqual(reconcileReview(review, write), review.slice(1));
});
console.log("Basic listing fields: minimal write");
// The F-150 Raptor as stored before 2026-09-29: a legacy document with a slug
// brandId, an empty variant and no engine/horsepower/torque/seats/... fields.
const f150 = {
  brandId: "ford", brandName: "Ford", model: "F-150 Raptor", variant: "", year: 2022, price: 9000000,
  fuelType: "Petrol", transmission: "Automatic", mileage: "26,400 km",
  description: "2022 Ford F-150 Raptor", status: "published", availability: "in-stock", featured: false,
  specifications: { Fuel: "Petrol" }, features: [], bodyType: null, dataReview: [],
};
const brands = [{ id: "dqGpRKq4el0tK8cGZi1M", name: "Ford" }, { id: "b2", name: "Jeep" }];
const SIMPLE = ["model", "variant", "year", "price", "fuelType", "transmission", "engine", "mileage", "horsepower", "torque", "seats", "bootSpace", "groundClearance"];
const NUMERIC = new Set(["year", "price", "seats"]);
// What admin.js readBasic() returns: the form as rendered from `car` (a slug
// brandId selects the brand by name, like matchesBrand), with `edits` applied
// to the controls as raw strings.
function readForm(car, edits = {}) {
  const ctl = (k, shown) => (k in edits ? edits[k] : shown);
  const brandId = ctl("brandId", brands.find((b) => b.id === car.brandId || b.name === car.brandName)?.id || "");
  const basic = { brandId, brandName: brands.find((b) => b.id === brandId)?.name || "" };
  for (const k of SIMPLE) {
    const raw = String(ctl(k, car[k] ?? "")).trim();
    basic[k] = raw === "" ? null : NUMERIC.has(k) ? Number(raw) : raw;
  }
  basic.description = ctl("description", car.description || "").trim();
  basic.status = ctl("status", car.status === "published" ? "published" : "draft");
  basic.availability = ctl("availability", car.availability || "in-stock");
  basic.featured = ctl("featured", !!car.featured);
  basic.specifications = ctl("specifications", { ...(car.specifications || {}) });
  basic.features = ctl("features", [...(car.features || [])]);
  return basic;
}
check("admin.js edits write only changed basic fields, read the same way at open and at save", () => {
  assert.ok(/const initialBasic = readBasic\(\);/.test(admin));
  assert.ok(/car \? buildBasicWrite\(initialBasic, basic\)/.test(admin));
  const reader = admin.slice(admin.indexOf("const readBasic"), admin.indexOf("const initialBasic"));
  for (const k of ["SIMPLE_FIELDS", "description", "status", "availability", "featured", "specifications", "features", "brandName"]) assert.ok(reader.includes(k), k);
});
check("legacy car: saving only bodyType writes bodyType and nothing basic; missing, \"\" and slug stay", () => {
  const basic = buildBasicWrite(readForm(f150), readForm(f150));
  assert.deepEqual(basic, {});
  const { write } = openAndSave(f150, { bodyType: "pickup" });
  const saved = merge(f150, { ...basic, ...write });
  assert.equal(saved.brandId, "ford");
  assert.equal(saved.variant, "");
  for (const k of ["engine", "horsepower", "torque", "seats", "bootSpace", "groundClearance", "thumbnail"]) assert.ok(!(k in saved), `${k} was created`);
  assert.equal(saved.bodyType, "pickup");
});
check("no basic change on any car gives an empty basic write", () => {
  for (const car of [f150, { ...f150, brandId: "dqGpRKq4el0tK8cGZi1M", variant: "GT", seats: 5, engine: "5.0 V8" }])
    assert.deepEqual(buildBasicWrite(readForm(car), readForm(car)), {});
});
check("explicitly changing the brand writes brandId and brandName together", () => {
  assert.deepEqual(buildBasicWrite(readForm(f150), readForm(f150, { brandId: "b2" })), { brandId: "b2", brandName: "Jeep" });
});
check("explicitly filling an empty variant writes only the variant", () => {
  assert.deepEqual(buildBasicWrite(readForm(f150), readForm(f150, { variant: " SuperCrew " })), { variant: "SuperCrew" });
});
check("clearing a set field writes null; a changed spec map or feature list is written whole", () => {
  const car = { ...f150, engine: "3.5 V6" };
  assert.deepEqual(buildBasicWrite(readForm(car), readForm(car, { engine: "" })), { engine: null });
  assert.deepEqual(buildBasicWrite(readForm(car), readForm(car, { features: ["Tow hitch"] })), { features: ["Tow hitch"] });
});
check("admin.js edits skip untouched images, provenance and dataReview", () => {
  assert.ok(/JSON\.stringify\(value\) !== JSON\.stringify\(initialImages\[key\]\)/.test(admin));
  assert.ok(/if \(!car \|\| Object\.keys\(write\)\.length\) data\.provenance = provenance;/.test(admin));
  assert.ok(/!== JSON\.stringify\(car\.dataReview \|\| \[\]\)\) data\.dataReview = review;/.test(admin));
  assert.ok(!/data\.schemaVersion = 1;/.test(admin), "edits still force schemaVersion");
});

check("admin.js passes the save's write through reconcileReview", () => {
  assert.ok(/const review = reconcileReview\(/.test(admin));
});

console.log(`\n${passed} checks passed.`);
