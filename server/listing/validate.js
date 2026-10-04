// Deterministic checks on Gemini's photo reading. Pure: no AI, no network.
// Whatever Gemini says, these rules decide what reaches the admin's review:
//   - not_visible (or no value) always means value null, confidence 0
//   - a value with no valid photo reference, or confidence below
//     OBSERVED_MIN, is at most "uncertain"
//   - bodyType must be a known enum value; odometerKm only when "observed"
//     and within a plausible range
// Nothing here is ever applied to a car automatically.
import { BODY_VALUES } from "../../public/app/js/core/requirements.js";
import { STATUSES, SEVERITIES } from "./extract.js";

export const OBSERVED_MIN = 0.7;
export const LISTING_FIELDS = ["make", "model", "variant", "bodyType", "colour", "odometerKm"];
export const ODOMETER_MAX = 1_000_000;

const clamp01 = (n) => (Number.isFinite(Number(n)) ? Math.round(Math.min(1, Math.max(0, Number(n))) * 100) / 100 : 0);
const text = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const photoRefs = (list, n) => [...new Set((Array.isArray(list) ? list : []).map(Number).filter((i) => Number.isInteger(i) && i >= 1 && i <= n))].sort((a, b) => a - b);

function cleanField(key, f, n, warnings) {
  const none = { value: null, status: "not_visible", confidence: 0, evidence: "", photos: [] };
  if (!f || typeof f !== "object") return none;
  let value = f.value;
  if (key === "odometerKm") {
    value = Number.isInteger(value) && value >= 0 && value <= ODOMETER_MAX ? value : null;
  } else if (key === "bodyType") {
    value = BODY_VALUES.includes(value) ? value : null;
  } else {
    value = text(value, 60) || null;
  }
  let status = STATUSES.includes(f.status) ? f.status : "uncertain";
  const photos = photoRefs(f.photos, n);
  const evidence = text(f.evidence, 200);
  if (status === "not_visible" || value === null) return none;

  let confidence = clamp01(f.confidence);
  if (status === "observed" && (confidence < OBSERVED_MIN || !photos.length || !evidence)) status = "uncertain";
  // A kilometre reading is a fact a buyer relies on: only a legible odometer counts.
  if (key === "odometerKm" && status !== "observed") {
    warnings.push("An odometer reading was suggested but is not clearly legible, so it was left out.");
    return none;
  }
  if (status === "uncertain") confidence = Math.min(confidence, OBSERVED_MIN - 0.01);
  return { value, status, confidence, evidence, photos };
}

/** raw: Gemini's answer; n: number of photos sent. Returns the reviewed-ready result. */
export function validateListing(raw, n) {
  const r = raw && typeof raw === "object" ? raw : {};
  const warnings = [];
  const fields = Object.fromEntries(LISTING_FIELDS.map((k) => [k, cleanField(k, r[k], n, warnings)]));

  const damage = (Array.isArray(r.damage) ? r.damage : [])
    .map((d) => ({
      area: text(d?.area, 60),
      description: text(d?.description, 200),
      severity: SEVERITIES.includes(d?.severity) ? d.severity : "unclear",
      confidence: clamp01(d?.confidence),
      photos: photoRefs(d?.photos, n),
    }))
    .filter((d) => d.description && d.photos.length)
    .slice(0, 20);

  const seen = new Set();
  const features = (Array.isArray(r.features) ? r.features : [])
    .map((f) => {
      const photos = photoRefs(f?.photos, n);
      const confidence = clamp01(f?.confidence);
      const observed = f?.status === "observed" && confidence >= OBSERVED_MIN && photos.length > 0;
      return { name: text(f?.name, 60), status: observed ? "observed" : "uncertain", confidence: observed ? confidence : Math.min(confidence, OBSERVED_MIN - 0.01), photos };
    })
    .filter((f) => f.name && f.photos.length && !seen.has(f.name.toLowerCase()) && seen.add(f.name.toLowerCase()))
    .slice(0, 25);

  if (r.sameCarInAllPhotos === false) warnings.push("Some photos may show a different car. Check every photo before using these values.");
  for (const note of (Array.isArray(r.imageNotes) ? r.imageNotes : []).slice(0, 10)) if (text(note, 160)) warnings.push(text(note, 160));

  return {
    fields,
    damage,
    features,
    // A draft for the admin to edit. It is never saved unless the admin chooses to.
    description: text(r.description, 1200),
    warnings,
    photoCount: n,
  };
}
