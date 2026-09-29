#!/usr/bin/env node
// Phase 0 data migration: adds normalised, machine-readable fields to every
// car. (The carModels reference collection is seeded separately; see below.)
//
//   node scripts/migrate-phase0.mjs            backup + dry run (reads only)
//   node scripts/migrate-phase0.mjs --apply    backup + dry run + write cars + verify
//   node scripts/migrate-phase0.mjs --check-auth   sign in + admin check only
//   node scripts/migrate-phase0.mjs --verify-only --backup=backups/<file>.json
//                                              compare live cars with a pre-apply backup (read-only)
//
// This writes ONLY the existing `cars` documents. It never creates carModels:
// that reference data is unverified and seeded separately, later, by
// scripts/seed-car-models.mjs once every entry has been checked.
//
// Rules this script keeps, and scripts/test-migrate.mjs checks:
//   - It only ADDS the fields in NEW_FIELDS. A field that already exists on a
//     document is never written, so nothing existing is overwritten.
//   - It never deletes a document or a field.
//   - Odometer values are never migrated: the ones in the data are shared
//     placeholders, so odometerKm stays null until the seller enters one.
//   - Where a car's own fields contradict each other, the derived field stays
//     null and the contradiction goes into dataReview. Nothing is picked.
//   - --apply asks for the admin email and password at the prompt and sends
//     them only to Firebase's sign-in endpoint. They are never stored.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const NEW_FIELDS = [
  "fuelTypes",
  "transmissionNorm",
  "fuelEconomyKmpl",
  "odometerKm",
  "powerHp",
  "groundClearanceMm",
  "bootLitres",
  "bodyType",
  "airbags",
  "ncapStars",
  "colour",
  "owners",
  "provenance",
  "dataReview",
  "schemaVersion",
];

/* ------------------------------ parsing -------------------------------- */

const numberIn = (v) => {
  const m = String(v ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const isKmpl = (v) => /\b(kmpl|km\/l|km per l)/i.test(String(v ?? ""));
const isKm = (v) => /\bkms?\b/i.test(String(v ?? "")) && !isKmpl(v);

const FUEL_WORDS = { petrol: "petrol", gasoline: "petrol", diesel: "diesel", cng: "cng", hybrid: "hybrid", electric: "electric", ev: "electric" };
export function parseFuels(v) {
  if (!v) return [];
  return [...new Set(
    String(v)
      .toLowerCase()
      .split(/\s*(?:,|\/|&|\band\b|\bor\b)\s*/)
      .map((w) => FUEL_WORDS[w.trim()])
      .filter(Boolean)
  )];
}
export function parseTransmission(v) {
  const s = String(v ?? "").toLowerCase();
  if (/auto|amt|cvt|dct|dsg|at\b/.test(s)) return "automatic";
  if (/manual|mt\b/.test(s)) return "manual";
  return null;
}
export const parsePower = (v) => {
  const n = numberIn(v); // "201 to 204" -> 201, the lower bound
  return n == null ? null : Math.round(n);
};
export const parseMm = (v) => numberIn(v);
export const parseLitres = (v) => numberIn(v);

const modelKey = (brand, model) => `${String(brand || "").trim().toLowerCase()}|${String(model || "").trim().toLowerCase()}`;
export const carModelId = (brand, model) =>
  `${brand}-${model}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ------------------------------ planning ------------------------------- */

/** Odometer strings that appear on more than one car are seed placeholders. */
export function placeholderOdometers(cars) {
  const seen = new Map();
  for (const c of cars) {
    const vals = [c.specifications?.Odometer, isKm(c.mileage) ? c.mileage : null].filter(Boolean);
    for (const v of new Set(vals.map(numberIn))) seen.set(v, (seen.get(v) || 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([v]) => v));
}

/**
 * Pure: what the migration would add to one car. No I/O.
 * Returns { id, title, add, nulls, review, skipped }.
 */
export function planCar(car, models, placeholders) {
  const spec = car.specifications || {};
  const ref = models.get(modelKey(car.brandName, car.model)) || null;
  const review = [];
  const provenance = {};
  const derived = {};

  // Fuel: the car's own field, unless its specifications disagree.
  const fuels = parseFuels(car.fuelType);
  const specFuels = parseFuels(spec.Fuel);
  if (specFuels.length && fuels.length && specFuels.join() !== fuels.join()) {
    derived.fuelTypes = null;
    review.push(`Fuel conflict: fuelType "${car.fuelType}" but specifications.Fuel "${spec.Fuel}"`);
  } else if (fuels.length > 1) {
    derived.fuelTypes = null;
    review.push(`fuelType "${car.fuelType}" lists several fuels; one used car has one fuel type`);
  } else if (fuels.length === 1) {
    derived.fuelTypes = fuels;
    provenance.fuelTypes = "migrated:fuelType";
    if (ref && !ref.fuelOptions.includes(fuels[0]))
      review.push(`Fuel "${fuels[0]}" is not in the ${ref.model} draft reference line-up (${ref.fuelOptions.join(", ")}; unverified)`);
  } else {
    derived.fuelTypes = null;
    review.push("Fuel type not recorded");
  }

  // Transmission: same rule.
  const tr = parseTransmission(car.transmission);
  const specTr = parseTransmission(spec.Transmission);
  if (tr && specTr && tr !== specTr) {
    derived.transmissionNorm = null;
    review.push(`Transmission conflict: transmission "${car.transmission}" but specifications.Transmission "${spec.Transmission}"`);
  } else {
    derived.transmissionNorm = tr;
    if (tr) provenance.transmissionNorm = "migrated:transmission";
    else review.push("Transmission not recorded");
  }

  // mileage: fuel economy or kilometres driven, never both.
  if (isKmpl(car.mileage)) {
    derived.fuelEconomyKmpl = numberIn(car.mileage);
    provenance.fuelEconomyKmpl = "migrated:mileage";
  } else {
    derived.fuelEconomyKmpl = null;
    if (car.mileage) review.push(`mileage "${car.mileage}" is not a fuel economy figure, so fuel economy is not recorded`);
  }

  // Odometer: never migrated (decision 1).
  derived.odometerKm = null;
  const odo = [spec.Odometer, isKm(car.mileage) ? car.mileage : null].filter(Boolean);
  if (odo.length) {
    const shared = odo.some((v) => placeholders.has(numberIn(v)));
    review.push(
      `Kilometres driven not provided. "${odo[0]}" is ${shared ? "a placeholder shared with other cars" : "unverified"}; enter the real reading`
    );
  } else {
    review.push("Kilometres driven not provided");
  }

  derived.powerHp = parsePower(car.horsepower);
  if (derived.powerHp != null) provenance.powerHp = "migrated:horsepower";
  derived.groundClearanceMm = parseMm(car.groundClearance);
  if (derived.groundClearanceMm != null) provenance.groundClearanceMm = "migrated:groundClearance";
  derived.bootLitres = parseLitres(car.bootSpace);
  if (derived.bootLitres != null) provenance.bootLitres = "migrated:bootSpace";

  // Body type is not migrated: the only source is the draft reference file,
  // which is unverified. It is entered by hand or filled once verified.
  derived.bodyType = null;
  review.push(
    ref
      ? `Body type not recorded (draft reference says "${ref.bodyType}", unverified)`
      : `Body type not recorded (no reference entry for "${car.brandName} ${car.model}")`
  );

  // Seats: existing field is left alone; only checked against the reference.
  if (car.seats == null || car.seats === "") review.push("Seats not recorded");
  else if (ref && !ref.seatOptions.includes(Number(car.seats)))
    review.push(`Seats ${car.seats} is not a ${ref.model} configuration in the draft reference (${ref.seatOptions.join(" or ")}; unverified)`);

  // Year: existing field left alone; conflicts only reported.
  if (spec.Year && car.year && String(spec.Year) !== String(car.year))
    review.push(`Year conflict: year ${car.year} but specifications.Year ${spec.Year}`);

  // Unverifiable or not yet entered.
  derived.airbags = null;
  derived.ncapStars = null;
  derived.colour = null;
  derived.owners = null;

  const missing = [
    ["engine", car.engine],
    ["horsepower", car.horsepower],
    ["torque", car.torque],
    ["bootSpace", car.bootSpace],
    ["groundClearance", car.groundClearance],
  ].filter(([, v]) => v == null || v === "").map(([k]) => k);
  if (missing.length) review.push(`Missing: ${missing.join(", ")}`);

  derived.provenance = provenance;
  derived.dataReview = review;
  derived.schemaVersion = 1;

  // Only add what is not already on the document.
  const add = {};
  const skipped = [];
  for (const k of NEW_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(car, k)) skipped.push(k);
    else add[k] = derived[k];
  }
  const nulls = Object.entries(add).filter(([, v]) => v === null).map(([k]) => k);
  return { id: car.id, title: `${car.brandName} ${car.model}`.trim(), add, nulls, review, skipped };
}

export function planModels(json) {
  return json.models.map((m) => ({
    id: carModelId(m.brand, m.model),
    data: {
      brand: m.brand,
      model: m.model,
      bodyType: m.bodyType,
      seatOptions: m.seatOptions,
      fuelOptions: m.fuelOptions,
      airbags: null,
      ncapStars: null,
      verified: false,
      source: "Manufacturer India line-up, compiled for CarVerse; check against the current spec sheet and set verified",
    },
  }));
}

export const modelIndex = (json) =>
  new Map(json.models.map((m) => [modelKey(m.brand, m.model), m]));

/* ------------------------------ Firestore ------------------------------ */

async function firebaseConfig() {
  const src = await readFile(path.join(ROOT, "public/app/js/config/config.js"), "utf8");
  const pick = (k) => src.match(new RegExp(`${k}:\\s*"([^"]+)"`))?.[1];
  return { apiKey: pick("apiKey"), projectId: pick("projectId") };
}

const decode = (v) => {
  if (!v) return null;
  if ("nullValue" in v) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(decode);
  if ("mapValue" in v) return decodeFields(v.mapValue.fields || {});
  return null;
};
const decodeFields = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, decode(v)]));

const encode = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === "string") return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, encode(x)])) } };
};

async function listCollection(cfg, name, token) {
  const out = [];
  let pageToken = "";
  do {
    const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/${name}?pageSize=300&key=${cfg.apiKey}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const res = await fetch(url, token ? { headers: { Authorization: `Bearer ${token}` } } : {});
    if (!res.ok) throw new Error(`Reading ${name}: ${res.status} ${await res.text()}`);
    const body = await res.json();
    for (const d of body.documents || []) out.push({ id: d.name.split("/").pop(), ...decodeFields(d.fields || {}) });
    pageToken = body.nextPageToken || "";
  } while (pageToken);
  return out;
}

/** Writes only the listed fields; the document must already exist. */
async function patchFields(cfg, token, docPath, fields) {
  const mask = Object.keys(fields).map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&");
  const url = `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/${docPath}?${mask}&currentDocument.exists=true`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, encode(v)])) }),
  });
  if (!res.ok) throw new Error(`Writing ${docPath}: ${res.status} ${await res.text()}`);
}

// Control and zero-width characters. An email can never contain them, and in a
// password they almost always mean a paste went wrong: pressing Ctrl+V at a
// PowerShell prompt types \u0016 instead of pasting.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200d\u2060\ufeff]/g;
const describeInvisible = (s) =>
  [...new Set(s.match(INVISIBLE) || [])].map((c) => `U+${c.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`).join(", ");

const SIGN_IN_ERRORS = {
  INVALID_EMAIL: "Firebase says the email address is not valid. Check it is typed in full (name@domain), with no stray characters.",
  INVALID_LOGIN_CREDENTIALS: "Wrong email or password. Nothing was written.",
  EMAIL_NOT_FOUND: "No account uses that email. Nothing was written.",
  INVALID_PASSWORD: "Wrong password. Nothing was written.",
  USER_DISABLED: "This account is disabled in Firebase Authentication. Enable it in the Firebase console, or use another admin account.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Firebase has temporarily blocked sign-in after too many attempts. Wait a few minutes, or reset the password, then retry.",
  PASSWORD_LOGIN_DISABLED: "Email/password sign-in is switched off for this Firebase project.",
};

/**
 * Reads one line from a terminal without echoing it. Nothing typed is written
 * to `output`, logged or kept after it is returned. Works in Windows
 * PowerShell, cmd and Unix terminals (Node raw mode). A right-click paste
 * arrives as one chunk and is taken as typed; Ctrl+V arrives as U+0016 and is
 * flagged by signIn like any other invisible character.
 */
export function readHidden(input, output, prompt) {
  return new Promise((resolve, reject) => {
    let value = "";
    output.write(prompt);
    const done = (err) => {
      input.setRawMode(false);
      input.pause();
      input.removeListener("data", onData);
      output.write("\n");
      err ? reject(err) : resolve(value);
    };
    const onData = (chunk) => {
      for (const ch of String(chunk)) {
        if (ch === "\r" || ch === "\n") return done();
        if (ch === "\u0003") return done(new Error("Cancelled. Nothing was written."));
        if (ch === "\u0004" && !value) return done(new Error("Input ended before sign-in finished. Nothing was written."));
        if (ch === "\u007f" || ch === "\b") value = value.slice(0, -1);
        else value += ch;
      }
    };
    input.setRawMode(true);
    input.setEncoding("utf8");
    input.on("data", onData);
    input.resume();
  });
}

/** Reads credentials, signs in, returns { idToken, uid, email }. Never writes. */
export async function signIn(cfg, { input = process.stdin, output = process.stdout } = {}) {
  let rawEmail, password;
  if (input.isTTY) {
    // Interactive: the email is echoed as usual, the password is read in raw
    // mode so the terminal never shows it.
    const rl = createInterface({ input, output });
    rawEmail = await rl.question("Admin email: ");
    rl.close();
    password = await readHidden(input, output, "Admin password (hidden): ");
  } else {
    // Piped input is never echoed. Lines go through one iterator:
    // rl.question() drops lines that arrive before it is called.
    const rl = createInterface({ input, terminal: false });
    const lines = rl[Symbol.asyncIterator]();
    const ask = async (prompt) => {
      output.write(prompt);
      const { value, done } = await lines.next();
      if (done) throw new Error("Input ended before sign-in finished. Nothing was written.");
      return value;
    };
    rawEmail = await ask("Admin email: ");
    password = await ask("Admin password: ");
    rl.close();
  }

  // The email is cleaned: whitespace and invisible characters can never be
  // part of it. The password is sent exactly as typed.
  const hidden = describeInvisible(rawEmail);
  const email = rawEmail.replace(INVISIBLE, "").trim();
  if (hidden) console.log(`  Note: removed invisible character(s) ${hidden} from the email (a paste that went wrong?).`);
  if (!email) throw new Error("No email entered. Nothing was written.");

  const pwHidden = describeInvisible(password);
  if (pwHidden)
    console.log(
      `  Warning: the password contains invisible character(s) ${pwHidden}. It is sent unchanged, but if sign-in fails, ` +
        "type it instead of pasting (Ctrl+V does not paste at a PowerShell prompt; use right-click)."
    );

  let res, body;
  try {
    res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${cfg.apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    });
    body = await res.json();
  } catch (err) {
    throw new Error(`Could not reach Firebase sign-in (${err.message}). Nothing was written.`);
  }
  if (!res.ok) {
    // Firebase sends e.g. "TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account…"
    const code = String(body.error?.message || res.status).split(" ")[0];
    throw new Error(`Sign-in failed (${code}). ${SIGN_IN_ERRORS[code] || "Nothing was written."}`);
  }
  return { idToken: body.idToken, uid: body.localId, email: body.email };
}

/** Admin UIDs from the web config: the same list the site and rules trust. */
async function configAdminUids() {
  const src = await readFile(path.join(ROOT, "public/app/js/config/config.js"), "utf8");
  const list = src.match(/ADMIN_UIDS\s*=\s*\[([^\]]*)\]/)?.[1] || "";
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/**
 * Mirrors isAdmin() in firestore.rules: the UID is in ADMIN_UIDS, or an
 * admins/{uid} document exists. Returns { ok, via, uids }.
 */
export async function checkAdmin(cfg, user) {
  const uids = await configAdminUids();
  if (uids.includes(user.uid)) return { ok: true, via: "ADMIN_UIDS in public/app/js/config/config.js", uids };
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/(default)/documents/admins/${user.uid}?key=${cfg.apiKey}`,
    { headers: { Authorization: `Bearer ${user.idToken}` } }
  );
  if (res.ok) return { ok: true, via: `admins/${user.uid} document`, uids };
  return { ok: false, via: null, uids };
}

async function authenticateAdmin(cfg) {
  const user = await signIn(cfg);
  console.log(`  Signed in: ${user.email}  (uid ${user.uid})`);
  const admin = await checkAdmin(cfg, user);
  if (!admin.ok) {
    throw new Error(
      `This account is not an admin, so nothing was written.\n` +
        `  Signed-in uid:   ${user.uid}\n` +
        `  ADMIN_UIDS:      ${admin.uids.join(", ") || "(empty)"}  (public/app/js/config/config.js)\n` +
        `  admins/${user.uid}: not found\n` +
        `  Sign in with an admin account. If this should be an admin, add the uid to ADMIN_UIDS ` +
        `(config.js, wrangler.toml and firestore.rules) or create admins/${user.uid} in the Firebase console.`
    );
  }
  console.log(`  Admin: yes (via ${admin.via})`);
  return user;
}

/* -------------------------------- report ------------------------------- */

const show = (v) => (v === null ? "null" : Array.isArray(v) ? `[${v.join(", ")}]` : typeof v === "object" ? JSON.stringify(v) : String(v));

/**
 * Value equality for Firestore data. Object key order is ignored, because
 * Firestore's REST API returns a map's keys in no fixed order: two reads of an
 * unchanged document can list them differently. Array order matters, since
 * Firestore keeps it. Primitives compare with ===.
 */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
}

/** Fields that must still be null after migration unless they existed before. */
export const HELD_NULL = ["odometerKm", "bodyType", "airbags", "ncapStars", "colour", "owners"];

/**
 * Pure: compares the cars after --apply with the backup taken just before it.
 * Returns { problems: string[], cars: number }. An empty list means VERIFY OK.
 */
export function verifyAgainstBackup({ beforeCars, afterCars, modelsBefore, modelsAfter }) {
  const problems = [];
  const after = new Map(afterCars.map((c) => [c.id, c]));
  const before = new Map(beforeCars.map((c) => [c.id, c]));

  if (modelsAfter !== modelsBefore) problems.push(`carModels count changed: ${modelsBefore} -> ${modelsAfter}`);
  for (const id of after.keys()) if (!before.has(id)) problems.push(`UNEXPECTED car created: ${id}`);

  for (const [id, b] of before) {
    const now = after.get(id);
    if (!now) { problems.push(`MISSING after apply: ${id}`); continue; }
    for (const [k, v] of Object.entries(b)) if (!deepEqual(now[k], v)) problems.push(`CHANGED ${id}.${k}`);
    for (const k of Object.keys(now))
      if (!(k in b) && !NEW_FIELDS.includes(k)) problems.push(`UNEXPECTED field ${id}.${k}`);
    for (const k of NEW_FIELDS) if (!(k in now)) problems.push(`NOT ADDED ${id}.${k}`);
    for (const k of HELD_NULL) if (!(k in b) && k in now && now[k] !== null) problems.push(`NOT NULL ${id}.${k} = ${JSON.stringify(now[k])}`);
  }
  return { problems, cars: afterCars.length };
}

/** Fields the plan would write that already exist on the document. Must be 0. */
export const overwrites = (cars, plans) =>
  plans.flatMap((p) => {
    const car = cars.find((c) => c.id === p.id) || {};
    return Object.keys(p.add).filter((k) => Object.prototype.hasOwnProperty.call(car, k)).map((k) => `${p.id}.${k}`);
  });

function printReport(cars, plans) {
  const line = "─".repeat(72);
  for (const p of plans) {
    console.log(`\n${line}\n${p.title}  (${p.id})\n${line}`);
    console.log("  Will add:");
    for (const [k, v] of Object.entries(p.add)) {
      if (k === "dataReview" || k === "provenance") continue;
      console.log(`    ${k.padEnd(18)} ${show(v)}`);
    }
    console.log(`  provenance         ${show(p.add.provenance ?? "(already set)")}`);
    console.log(`  Stays null: ${p.nulls.filter((k) => k !== "dataReview").join(", ") || "none"}`);
    if (p.skipped.length) console.log(`  Already present, not touched: ${p.skipped.join(", ")}`);
    console.log("  dataReview:");
    for (const r of p.review) console.log(`    - ${r}`);
  }
  const conflicts = plans.flatMap((p) => p.review.filter((r) => /conflict|not a .* configuration|not in the .* reference|lists several fuels/i.test(r)).map((r) => `${p.title}: ${r}`));
  console.log(`\n${line}\nCONFLICTS (reported, not resolved): ${conflicts.length}`);
  conflicts.forEach((c) => console.log(`  - ${c}`));
  const affected = plans.filter((p) => Object.keys(p.add).length).length;
  console.log(`\n${line}\nSUMMARY`);
  console.log(`  cars read:                 ${plans.length}`);
  console.log(`  cars that would change:    ${affected}`);
  console.log(`  fields added per car:      ${NEW_FIELDS.length} (only if absent)`);
  console.log(`  existing fields changed:   ${overwrites(cars, plans).length}`);
  console.log(`  documents deleted:         0 (the script has no delete operation)`);
  console.log(`  odometers migrated:        ${plans.filter((p) => p.add.odometerKm != null).length}`);
  console.log(`  dataReview entries:        ${plans.reduce((n, p) => n + p.review.length, 0)}`);
  console.log(`  Existing car documents to update:  ${affected}`);
  console.log(`  New carModels documents to create: 0 (HELD, NOT APPROVED: the reference data is unverified)`);
  console.log(`  Total documents --apply will write: ${affected}`);
}

/* --------------------------------- main -------------------------------- */

async function main() {
  const apply = process.argv.includes("--apply");
  const cfg = await firebaseConfig();

  // --check-auth: sign in and confirm admin, then stop. No backup, no reads of
  // data, no writes.
  if (process.argv.includes("--check-auth")) {
    console.log("AUTH CHECK ONLY: nothing will be read or written.");
    await authenticateAdmin(cfg);
    console.log("\nAuth check passed. This account can run --apply.");
    return;
  }
  if (process.argv.includes("--verify-only")) return verifyOnly(cfg);
  const refJson = JSON.parse(await readFile(path.join(ROOT, "scripts/data/car-models.json"), "utf8"));
  const models = modelIndex(refJson);

  // 1. Backup: everything publicly readable, so no credentials are needed.
  const [cars, brands, settings, modelsBefore] = await Promise.all([
    listCollection(cfg, "cars"),
    listCollection(cfg, "brands"),
    listCollection(cfg, "settings"),
    listCollection(cfg, "carModels"),
  ]);
  await mkdir(path.join(ROOT, "backups"), { recursive: true });
  const file = path.join(ROOT, "backups", `firestore-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await writeFile(file, JSON.stringify({ takenAt: new Date().toISOString(), projectId: cfg.projectId, cars, brands, settings, carModels: modelsBefore }, null, 2));
  console.log(`Backup: ${path.relative(ROOT, file)}  (${cars.length} cars, ${brands.length} brands, ${settings.length} settings)`);
  console.log("Not backed up: customerInquiries, chatHistory, wishlist, compare (admin/owner-only; not touched by this migration)");

  // 2. Plan (dry run).
  const placeholders = placeholderOdometers(cars);
  const plans = cars.map((c) => planCar(c, models, placeholders));
  printReport(cars, plans);

  if (!apply) {
    console.log("\nDRY RUN: nothing was written. Review the output, then run with --apply.");
    return;
  }

  // 3. Apply.
  console.log("\nAPPLY: sign in as an admin. Credentials go only to Firebase sign-in.");
  const token = (await authenticateAdmin(cfg)).idToken;
  for (const p of plans) {
    if (!Object.keys(p.add).length) continue;
    await patchFields(cfg, token, `cars/${p.id}`, p.add);
    console.log(`  cars/${p.id}  +${Object.keys(p.add).length} fields`);
  }
  console.log("  carModels: skipped (held; see scripts/seed-car-models.mjs)");

  // 4. Verify against the backup.
  const [after, modelsAfter] = await Promise.all([listCollection(cfg, "cars"), listCollection(cfg, "carModels")]);
  reportVerify(
    verifyAgainstBackup({ beforeCars: cars, afterCars: after, modelsBefore: modelsBefore.length, modelsAfter: modelsAfter.length }),
    path.relative(ROOT, file)
  );
}

function reportVerify({ problems, cars }, backupName) {
  for (const p of problems) console.error(`  ${p}`);
  console.log(
    problems.length
      ? `\nVERIFY FAILED: ${problems.length} problem(s). Backup: ${backupName}`
      : `\nVERIFY OK: ${cars} cars, all pre-existing fields unchanged, all new fields present, held fields null, no carModels created.`
  );
  if (problems.length) process.exitCode = 1;
}

/** Read-only: compares live Firestore with a backup taken before --apply. */
async function verifyOnly(cfg) {
  const arg = process.argv.find((a) => a.startsWith("--backup="));
  if (!arg) throw new Error("--verify-only needs the pre-apply backup: --backup=backups/firestore-….json");
  const backupPath = path.resolve(ROOT, arg.slice("--backup=".length));
  const backup = JSON.parse(await readFile(backupPath, "utf8"));
  const [after, modelsAfter] = await Promise.all([listCollection(cfg, "cars"), listCollection(cfg, "carModels")]);
  // Backups taken before this flag existed did not record carModels; seeding is
  // held, so the expected count then is the count at backup time, which was 0.
  const modelsBefore = Array.isArray(backup.carModels) ? backup.carModels.length : 0;
  console.log(`VERIFY ONLY: nothing will be written.\nBackup: ${path.relative(ROOT, backupPath)} (taken ${backup.takenAt})`);
  if (!Array.isArray(backup.carModels)) console.log("  (backup has no carModels list; expecting 0, since seeding is held)");
  reportVerify(verifyAgainstBackup({ beforeCars: backup.cars, afterCars: after, modelsBefore, modelsAfter: modelsAfter.length }), path.relative(ROOT, backupPath));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  });
}
