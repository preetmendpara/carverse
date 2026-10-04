// Display rules for car fields: the normalised fields added by the Phase 0
// migration first, the old free-text fields only where falling back is safe.
// Pure functions, no DOM, so scripts/test-car-fields.mjs can test them.
//
// Every getter returns a display string, or null when there is nothing honest
// to show. Callers decide what null looks like ("Not provided", or no chip).

export const NOT_PROVIDED = "Not provided";
export const NOT_CONFIRMED = "Not confirmed";

export const BODY_TYPES = [
  ["hatchback", "Hatchback"],
  ["sedan", "Sedan"],
  ["compact_suv", "Compact SUV"],
  ["suv", "SUV"],
  ["muv", "MUV"],
  ["coupe", "Coupe"],
  ["pickup", "Pickup"],
  ["convertible", "Convertible"],
];
export const FUELS = [
  ["petrol", "Petrol"],
  ["diesel", "Diesel"],
  ["cng", "CNG"],
  ["hybrid", "Hybrid"],
  ["electric", "Electric"],
];
export const TRANSMISSIONS = [
  ["automatic", "Automatic"],
  ["manual", "Manual"],
];

const label = (list, v) => (list.find(([k]) => k === v) || [null, null])[1];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const present = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const fmt = (n) => Number(n).toLocaleString("en-IN");

/* Parsers for the old free-text fields. Same rules as the migration. */
const FUEL_WORDS = { petrol: "petrol", gasoline: "petrol", diesel: "diesel", cng: "cng", hybrid: "hybrid", electric: "electric", ev: "electric" };
export const parseFuels = (v) =>
  [...new Set(String(v ?? "").toLowerCase().split(/\s*(?:,|\/|&|\band\b|\bor\b)\s*/).map((w) => FUEL_WORDS[w.trim()]).filter(Boolean))];
export const parseTransmission = (v) => {
  const s = String(v ?? "").toLowerCase();
  if (/auto|amt|cvt|dct|dsg|at\b/.test(s)) return "automatic";
  if (/manual|mt\b/.test(s)) return "manual";
  return null;
};
/** "17.9 kmpl" is fuel economy. "26,400 km" is a distance and never is. */
export const isKmpl = (v) => /\b(kmpl|km\/l|km per l)/i.test(String(v ?? ""));

const numberIn = (v) => {
  const m = String(v ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const numberOrNull = (v) => (isNum(v) ? v : null);

// Specification-map keys that restate fuel or transmission. A value under any
// of them that disagrees with the car's own field is a conflict.
const FUEL_SPEC_KEYS = ["fuel", "fuel type"];
const TRANSMISSION_SPEC_KEYS = ["transmission", "gearbox"];
const specValues = (car, keys) =>
  Object.entries(car?.specifications || {})
    .filter(([k, v]) => keys.includes(String(k).trim().toLowerCase()) && present(v))
    .map(([, v]) => v);

/* ------------------------ the effective car record --------------------- */
// ONE interpretation of a car's data, used by every consumer: cards, details,
// compare, filters, search, and the future /api/match Worker (which imports
// this same file). It is plain JSON (no functions, no Dates) so it can be
// sent between browser and server unchanged.
//
//   status: "ok"        a single, consistent value
//           "conflict"  the car's own fields disagree, or list several values
//           "missing"   nothing recorded
//
// A value is never invented. Unverified reference data (carModels) is never used.

function effectiveFuel(car) {
  const valid = FUELS.map(([k]) => k);
  if (Array.isArray(car?.fuelTypes) && car.fuelTypes.length) {
    // An admin-entered structured value wins, but it still has to be a single known fuel.
    const list = [...new Set(car.fuelTypes)];
    return list.length === 1 && valid.includes(list[0]) ? { fuelTypes: list, fuelStatus: "ok" } : { fuelTypes: null, fuelStatus: "conflict" };
  }
  const own = parseFuels(car?.fuelType);
  if (own.length > 1) return { fuelTypes: null, fuelStatus: "conflict" }; // "petrol and diesel"
  if (own.length === 0) return { fuelTypes: null, fuelStatus: present(car?.fuelType) ? "conflict" : "missing" };
  const disagree = specValues(car, FUEL_SPEC_KEYS).some((v) => parseFuels(v).join() !== own.join());
  return disagree ? { fuelTypes: null, fuelStatus: "conflict" } : { fuelTypes: own, fuelStatus: "ok" };
}

function effectiveTransmission(car) {
  const valid = TRANSMISSIONS.map(([k]) => k);
  if (present(car?.transmissionNorm))
    return valid.includes(car.transmissionNorm)
      ? { transmissionNorm: car.transmissionNorm, transmissionStatus: "ok" }
      : { transmissionNorm: null, transmissionStatus: "conflict" };
  const own = parseTransmission(car?.transmission);
  if (!own) return { transmissionNorm: null, transmissionStatus: present(car?.transmission) ? "conflict" : "missing" };
  const disagree = specValues(car, TRANSMISSION_SPEC_KEYS).some((v) => parseTransmission(v) !== own);
  return disagree ? { transmissionNorm: null, transmissionStatus: "conflict" } : { transmissionNorm: own, transmissionStatus: "ok" };
}

/** Pure. The effective, serialisable interpretation of one car. */
export function effectiveFields(car) {
  return {
    ...effectiveFuel(car),
    ...effectiveTransmission(car),
    // Legacy `mileage` counts only when it states kmpl; "26,400 km" never does.
    fuelEconomyKmpl: numberOrNull(car?.fuelEconomyKmpl) ?? (isKmpl(car?.mileage) ? numberIn(car.mileage) : null),
    // Never from legacy fields: those readings were shared placeholders.
    odometerKm: numberOrNull(car?.odometerKm),
    powerHp: numberOrNull(car?.powerHp),
    groundClearanceMm: numberOrNull(car?.groundClearanceMm),
    bootLitres: numberOrNull(car?.bootLitres),
    // The car's own seat count. Seat conflicts are listed in dataReview, not guessed here.
    seats: numberOrNull(car?.seats),
    // No fallback at all for these: never recorded before, or safety data.
    bodyType: BODY_TYPES.some(([k]) => k === car?.bodyType) ? car.bodyType : null,
    airbags: numberOrNull(car?.airbags),
    ncapStars: numberOrNull(car?.ncapStars),
    colour: present(car?.colour) ? String(car.colour).trim() : null,
    owners: numberOrNull(car?.owners),
  };
}

/** The car's effective record: the one catalog.js attached, or computed now. */
export const effective = (car) => car?.effective || effectiveFields(car);

/* ------------------------------ fuel economy --------------------------- */
export function fuelEconomyText(car) {
  if (isNum(car?.fuelEconomyKmpl)) return `${car.fuelEconomyKmpl} kmpl`;
  if (isKmpl(car?.mileage)) return String(car.mileage).trim();
  return null;
}

/* --------------------------- kilometres driven ------------------------- */
// Only the normalised field. The old `mileage` and `specifications.Odometer`
// values were shared placeholders, so they are never shown as a reading.
export function kmDrivenText(car) {
  const km = effective(car).odometerKm;
  return km === null ? null : `${fmt(km)} km`;
}

/* ------------------------------- fuel type ----------------------------- */
export const fuelConflict = (car) => effective(car).fuelStatus === "conflict";
export function fuelText(car) {
  const e = effective(car);
  return e.fuelStatus === "ok" ? e.fuelTypes.map((f) => label(FUELS, f) || f).join(", ") : null;
}

/* ----------------------------- transmission ---------------------------- */
export const transmissionConflict = (car) => effective(car).transmissionStatus === "conflict";
export function transmissionText(car) {
  const e = effective(car);
  return e.transmissionStatus === "ok" ? label(TRANSMISSIONS, e.transmissionNorm) : null;
}

/* ------------------------- filters and search -------------------------- */
// Filters match only a consistent ("ok") value, so a conflicting or missing
// car appears under "All" but never under a specific fuel or transmission.
// These are the same rules /api/match applies as hard constraints.
export const matchesFuel = (car, fuel) => !fuel || (effective(car).fuelStatus === "ok" && effective(car).fuelTypes.includes(fuel));
export const matchesTransmission = (car, t) =>
  !t || (effective(car).transmissionStatus === "ok" && effective(car).transmissionNorm === t);

/** Text a free-text search looks through. Fuel, transmission and body type come
 *  from the effective record, so search agrees with filters and cards. */
export function searchText(car, availability = "") {
  const e = effective(car);
  return [
    car?.brandName,
    car?.brand,
    car?.model,
    car?.variant,
    e.fuelStatus === "ok" ? e.fuelTypes.map((f) => label(FUELS, f)).join(" ") : "",
    e.transmissionStatus === "ok" ? label(TRANSMISSIONS, e.transmissionNorm) : "",
    e.bodyType ? `${label(BODY_TYPES, e.bodyType)} ${e.bodyType === "compact_suv" ? "SUV" : ""}` : "",
    car?.year,
    car?.engine,
    availability,
    ...(car?.features || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/* ---------------------- measured values with units --------------------- */
// The old fields already carried their own units ("190 mm"), so they are shown
// as written when the normalised value is absent.
export const powerText = (car) => (isNum(car?.powerHp) ? `${car.powerHp} hp` : present(car?.horsepower) ? String(car.horsepower).trim() : null);
export const groundClearanceText = (car) =>
  isNum(car?.groundClearanceMm) ? `${car.groundClearanceMm} mm` : present(car?.groundClearance) ? String(car.groundClearance).trim() : null;
export const bootText = (car) => (isNum(car?.bootLitres) ? `${car.bootLitres} litres` : present(car?.bootSpace) ? String(car.bootSpace).trim() : null);

/* ------------------- fields with no old equivalent --------------------- */
// No fallback: bodyType was never recorded, and safety figures must come from
// a verified spec sheet, never a guess.
export const bodyTypeText = (car) => (car?.bodyType ? label(BODY_TYPES, car.bodyType) || car.bodyType : null);
export const colourText = (car) => (present(car?.colour) ? String(car.colour).trim() : null);
export const ownersText = (car) => (isNum(car?.owners) ? String(car.owners) : null);
export const airbagsText = (car) => (isNum(car?.airbags) ? String(car.airbags) : null);
export const ncapText = (car) => (isNum(car?.ncapStars) ? `${car.ncapStars}-star` : null);

/** Text for a row, with the reason when there is none. */
export const orNotProvided = (text, conflict = false) => text ?? (conflict ? NOT_CONFIRMED : NOT_PROVIDED);

/* ---------------------- specifications map extras ---------------------- */
// Keys in the free-form specifications map that the rows above now cover.
// Hiding them stops the placeholder odometers and the conflicting fuel,
// transmission and year values reaching the page.
const COVERED = new Set([
  "fuel", "fuel type", "transmission", "gearbox", "odometer", "kms driven", "km driven",
  "kilometres driven", "kilometers driven", "mileage", "fuel economy", "year", "ownership",
  "owners", "owner", "colour", "color", "airbags", "ncap", "ncap rating", "body type",
  "power", "horsepower", "boot", "boot space", "ground clearance",
]);
export function extraSpecs(car) {
  return Object.entries(car?.specifications || {}).filter(([k, v]) => present(v) && !COVERED.has(String(k).trim().toLowerCase()));
}

/* ------------------------------ provenance ----------------------------- */
// Where a value came from. Nothing is called "verified" just for existing.
export function provenanceText(car, field) {
  const p = String(car?.provenance?.[field] || "");
  if (p.startsWith("migrated")) return `Migrated from old "${p.split(":")[1] || "field"}"`;
  if (p === "admin") return "Entered by admin";
  // Read from photos by AI, then checked and saved by an admin (photo-to-listing).
  if (p === "ai-photo") return "From photos (AI), reviewed by admin";
  if (p.startsWith("reference") || p.startsWith("database")) return "Reference data";
  return "Unknown source";
}
