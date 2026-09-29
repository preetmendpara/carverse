// Suitability ESTIMATES from listed specifications (docs/RANKING-SPEC.md §3).
// Pure and dependency-light so the browser and the /api/match Worker share it.
//
// These are not facts about a car. Each estimate checks a fixed set of
// conditions against the effective record; a condition whose field is missing
// is "unknown" and counts neither for nor against. Every result carries the
// evidence it used, so the UI can always show why.
import { effective } from "./car-fields.js";

const BODY = {
  hatchback: "Hatchback",
  sedan: "Sedan",
  compact_suv: "Compact SUV",
  suv: "SUV",
  muv: "MUV",
  coupe: "Coupe",
  pickup: "Pickup",
  convertible: "Convertible",
};

// A condition: returns { known, met, evidence } for one effective record.
const cond = (known, met, evidence) => ({ known, met: known && met, evidence });

const automatic = (e) => cond(e.transmissionStatus === "ok", e.transmissionNorm === "automatic", `${e.transmissionNorm === "automatic" ? "Automatic" : "Manual"} transmission`);
const bodyIn = (e, types) => cond(e.bodyType !== null, types.includes(e.bodyType), `${BODY[e.bodyType] || "Unknown"} body type`);
const kmplAtLeast = (e, n) => cond(e.fuelEconomyKmpl !== null, e.fuelEconomyKmpl >= n, `Listed fuel economy of ${e.fuelEconomyKmpl} kmpl`);
const powerAtLeast = (e, n) => cond(e.powerHp !== null, e.powerHp >= n, `Listed power of ${e.powerHp} hp`);
const clearanceAtLeast = (e, n) => cond(e.groundClearanceMm !== null, e.groundClearanceMm >= n, `Listed ground clearance of ${e.groundClearanceMm} mm`);
const seatsAtLeast = (e, n) => cond(e.seats !== null, e.seats >= n, `${e.seats} seats`);
const bootOrSeven = (e) => {
  if (e.seats !== null && e.seats >= 7) return cond(true, true, `${e.seats} seats`);
  if (e.bootLitres !== null) return cond(true, e.bootLitres >= 350, `Listed boot of ${e.bootLitres} litres`);
  return cond(false, false, "Boot capacity");
};

// Each rule: [name, label, [[condition, description-when-unknown], ...]]
const RULES = [
  ["city_suitability", "City suitability", (e) => [
    [automatic(e), "transmission"],
    [bodyIn(e, ["hatchback", "compact_suv", "sedan"]), "body type"],
    [kmplAtLeast(e, 15), "fuel economy"],
  ]],
  ["highway_suitability", "Highway suitability", (e) => [
    [bodyIn(e, ["sedan", "compact_suv", "suv", "muv"]), "body type"],
    [powerAtLeast(e, 100), "power"],
    [kmplAtLeast(e, 12), "fuel economy"],
  ]],
  ["family_practicality", "Family practicality", (e) => [
    [seatsAtLeast(e, 5), "seats"],
    [bootOrSeven(e), "boot capacity"],
  ]],
  ["rough_road_suitability", "Rough-road suitability", (e) => [
    [clearanceAtLeast(e, 200), "ground clearance"],
    [bodyIn(e, ["suv", "compact_suv", "muv", "pickup"]), "body type"],
  ]],
];

export const SUITABILITY_NOTE = "Estimate based on the listed specifications.";

/** Pure. { [name]: { label, level, score, confidence, evidence[], against[], notListed[] } } */
export function suitability(car) {
  const e = effective(car);
  const out = {};
  for (const [name, label, conditions] of RULES) {
    const list = conditions(e);
    const known = list.filter(([c]) => c.known);
    const met = known.filter(([c]) => c.met);
    const score = known.length ? met.length / known.length : 0;
    const confidence = known.length / list.length;
    const level = confidence < 0.5 ? "Not enough data" : score >= 0.67 ? "High" : score >= 0.34 ? "Medium" : "Low";
    out[name] = {
      label,
      level,
      score: Math.round(score * 1000) / 1000,
      confidence: Math.round(confidence * 1000) / 1000,
      evidence: met.map(([c]) => c.evidence),
      against: known.filter(([c]) => !c.met).map(([c]) => c.evidence),
      notListed: list.filter(([c]) => !c.known).map(([, what]) => what),
    };
  }
  return out;
}
