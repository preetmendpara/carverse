// Admin form logic for the normalised car fields. Pure (no DOM, no Firebase),
// so scripts/test-admin-fields.mjs can test it.
//
// The rule that keeps stored data safe:
//   A field is written only when the admin changed its control. An untouched
//   field is left out of the save entirely, so Firestore keeps it exactly as it
//   is, even a value the form cannot represent (fuelTypes ["lpg"],
//   ["petrol", "diesel"], transmissionNorm "cvt", odometerKm "not-a-number").
import { BODY_TYPES, FUELS, TRANSMISSIONS } from "./car-fields.js";

//   [key, label, kind, options]   kind: "select" | "number" | "text"
export const NORMALIZED_FIELDS = [
  ["bodyType", "Body type", "select", BODY_TYPES],
  ["fuelTypes", "Fuel type", "select", FUELS],
  ["transmissionNorm", "Transmission", "select", TRANSMISSIONS],
  ["fuelEconomyKmpl", "Fuel economy (kmpl)", "number", { step: "any" }],
  ["odometerKm", "Kilometres driven", "number", { step: "1" }],
  ["powerHp", "Power (hp)", "number", { step: "1" }],
  ["groundClearanceMm", "Ground clearance (mm)", "number", { step: "1" }],
  ["bootLitres", "Boot capacity (litres)", "number", { step: "1" }],
  ["colour", "Colour", "text"],
  ["owners", "Number of owners", "number", { step: "1", min: "1" }],
  ["airbags", "Airbags (from a spec sheet only)", "number", { step: "1" }],
  ["ncapStars", "NCAP stars (from a spec sheet only)", "number", { step: "1", max: "5" }],
];

/** Select value meaning "keep the stored value the options cannot show". */
export const STORED = "__stored__";

const has = (car, key) => car != null && Object.prototype.hasOwnProperty.call(car, key);
const describe = (v) => (Array.isArray(v) ? v.map(String).join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v));

/**
 * How to render one field for a car. Returns
 *   { key, label, kind, inputType, value, options, warning, attrs }
 * `value` is the control's initial string; the form keeps it to detect changes.
 */
export function fieldView([key, label, kind, opts], car) {
  const stored = has(car, key) ? car[key] : null;

  if (kind === "select") {
    const allowed = opts.map(([v]) => v);
    // fuelTypes is a list; the form edits a single fuel.
    const single = key === "fuelTypes" ? (Array.isArray(stored) && stored.length === 1 ? stored[0] : undefined) : stored;
    const representable = stored === null || (typeof single === "string" && allowed.includes(single));
    const options = [{ value: "", label: "Not provided" }, ...opts.map(([v, l]) => ({ value: v, label: l }))];
    if (representable) return { key, label, kind, inputType: "select", value: stored === null ? "" : single, options, warning: null, attrs: {} };
    options.push({ value: STORED, label: `Stored value: ${describe(stored)}` });
    return {
      key, label, kind, inputType: "select", value: STORED, options, attrs: {},
      warning: `The stored value (${describe(stored)}) is not one of the standard options. It is kept as it is unless you choose another option.`,
    };
  }

  if (kind === "number") {
    const attrs = { step: opts.step, min: opts.min || "0", ...(opts.max ? { max: opts.max } : {}) };
    if (stored === null) return { key, label, kind, inputType: "number", value: "", options: null, warning: null, attrs };
    if (typeof stored === "number" && Number.isFinite(stored)) return { key, label, kind, inputType: "number", value: String(stored), options: null, warning: null, attrs };
    // A number input cannot hold "not-a-number"; show it as text instead of blanking it.
    return {
      key, label, kind, inputType: "text", value: describe(stored), options: null, attrs: {},
      warning: `The stored value (${describe(stored)}) is not a number. It is kept as it is unless you change this field.`,
    };
  }

  const text = stored === null ? "" : typeof stored === "string" ? stored : describe(stored);
  const warning = stored === null || typeof stored === "string" ? null : `The stored value (${describe(stored)}) is not text. It is kept as it is unless you change this field.`;
  return { key, label, kind, inputType: "text", value: text, options: null, warning, attrs: {} };
}

/** Parses one changed control into the value to store. Throws on invalid input. */
export function parseControl([key, label, kind, opts], raw) {
  const s = String(raw ?? "").trim();
  if (s === "") return null;
  if (kind === "select") {
    if (s === STORED) throw new Error(`${label}: the stored value can only be kept, not re-entered.`);
    if (!opts.some(([v]) => v === s)) throw new Error(`${label}: "${s}" is not an allowed option.`);
    return key === "fuelTypes" ? [s] : s;
  }
  if (kind === "number") {
    const n = Number(s);
    if (!Number.isFinite(n) || n < Number(opts.min || 0) || (opts.max && n > Number(opts.max)))
      throw new Error(`${label}: "${s}" is not a valid value.`);
    return n;
  }
  return s;
}

/**
 * What to save. `controls` maps each key to { initial, current } control strings.
 * Returns { write, provenance } where `write` holds ONLY the changed fields.
 * Throws if a changed field is invalid, so nothing is saved.
 */
export function buildNormalizedWrite(car, controls) {
  const write = {};
  const provenance = { ...(car?.provenance || {}) };
  for (const field of NORMALIZED_FIELDS) {
    const [key] = field;
    const c = controls[key];
    if (!c || c.current === c.initial) continue; // untouched: keep the stored value exactly
    const value = parseControl(field, c.current);
    write[key] = value;
    provenance[key] = value === null ? "unknown" : "admin";
  }
  return { write, provenance };
}

// Review notes that mean "this normalised field is empty", as the migration
// words them (scripts/migrate-phase0.mjs). Only fields that already get such a
// note are listed: [key, prefix that identifies the note, note to add back].
export const UNRESOLVED_NOTES = [
  ["bodyType", "Body type not recorded", "Body type not recorded"],
  ["fuelTypes", "Fuel type not recorded", "Fuel type not recorded"],
  ["transmissionNorm", "Transmission not recorded", "Transmission not recorded"],
  ["odometerKm", "Kilometres driven not provided", "Kilometres driven not provided"],
];

/**
 * dataReview after a save. Only fields in `write` (the changed ones) count:
 * a field set to a value drops its "not recorded" note; a field cleared to
 * null gets it back (once). Every other note is kept as it is.
 */
export function reconcileReview(review, write) {
  let out = [...(review || [])];
  for (const [key, prefix, note] of UNRESOLVED_NOTES) {
    if (!(key in write)) continue;
    const matches = (t) => String(t).startsWith(prefix);
    if (write[key] !== null) out = out.filter((t) => !matches(t));
    else if (!out.some(matches)) out.push(note);
  }
  return out;
}

/**
 * The same minimal-write rule for the rest of the car form. `initial` and
 * `current` are the form read the same way when it opened and at save. Returns
 * only the keys whose value changed, so an untouched field keeps its stored
 * representation exactly (missing stays missing, "" stays "", null stays null).
 * brandId and brandName travel together: picking a brand writes both.
 */
export function buildBasicWrite(initial, current) {
  const write = {};
  for (const key of Object.keys(current)) {
    if (JSON.stringify(current[key]) !== JSON.stringify(initial[key])) write[key] = current[key];
  }
  if ("brandId" in write) write.brandName = current.brandName;
  else delete write.brandName;
  return write;
}
