// Minimal Firestore REST access for the Worker. Reads use the public `cars`
// rule (no credentials). The one write, a match log, is made with the BUYER's
// own ID token, so Firestore rules apply to it exactly as if the browser wrote it.
import { redact } from "./http.js";

const base = (env) => `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const decode = (v) => {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields || {}).map(([k, x]) => [k, decode(x)]));
  return null;
};
const encode = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
};

// Per-isolate cache: the catalogue is small and changes rarely.
let carsCache = { at: 0, cars: null };
const CARS_TTL_MS = 60_000;

/** Published cars, as plain objects with their Firestore id. */
export async function listPublishedCars(env) {
  if (carsCache.cars && Date.now() - carsCache.at < CARS_TTL_MS) return carsCache.cars;
  const out = [];
  let pageToken = "";
  do {
    const res = await fetch(`${base(env)}/cars?pageSize=300&key=${env.FIREBASE_API_KEY}${pageToken ? `&pageToken=${pageToken}` : ""}`);
    if (!res.ok) throw new Error(`Reading cars failed (${res.status}).`);
    const body = await res.json();
    for (const d of body.documents || [])
      out.push({ id: d.name.split("/").pop(), ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, decode(v)])) });
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  const cars = out.filter((c) => c.status === "published");
  carsCache = { at: Date.now(), cars };
  return cars;
}

/** Best effort: a failed log never fails the buyer's request. */
export async function writeMatchLog(env, idToken, log) {
  try {
    const res = await fetch(`${base(env)}/matchLogs`, {
      method: "POST",
      headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: Object.fromEntries(Object.entries(log).map(([k, v]) => [k, encode(v)])) }),
    });
    if (!res.ok) console.error("matchLog write failed", res.status, redact(await res.text()));
    return res.ok;
  } catch (err) {
    console.error("matchLog write failed", redact(err.message));
    return false;
  }
}
