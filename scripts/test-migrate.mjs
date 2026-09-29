#!/usr/bin/env node
// Checks the Phase 0 migration plan without touching Firestore.
//   node scripts/test-migrate.mjs                 uses the newest backups/*.json
// Exits non-zero if any guarantee is broken.
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  NEW_FIELDS,
  planCar,
  planModels,
  modelIndex,
  placeholderOdometers,
  overwrites,
  parseFuels,
  parseTransmission,
  parsePower,
} from "./migrate-phase0.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ref = JSON.parse(await readFile(path.join(ROOT, "scripts/data/car-models.json"), "utf8"));
const models = modelIndex(ref);

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};

/* ---------------------------- real backup data ------------------------- */
const backups = (await readdir(path.join(ROOT, "backups"))).filter((f) => f.endsWith(".json")).sort();
assert.ok(backups.length, "No backup found. Run the dry run first: node scripts/migrate-phase0.mjs");
const backup = JSON.parse(await readFile(path.join(ROOT, "backups", backups.at(-1)), "utf8"));
const cars = backup.cars;
const placeholders = placeholderOdometers(cars);
const plans = cars.map((c) => planCar(c, models, placeholders));
console.log(`Using ${backups.at(-1)} (${cars.length} cars)\n`);

check("every car gets a plan", () => assert.equal(plans.length, cars.length));

check("no existing field is overwritten", () => assert.deepEqual(overwrites(cars, plans), []));

check("plans only ever add fields from NEW_FIELDS", () => {
  for (const p of plans) for (const k of Object.keys(p.add)) assert.ok(NEW_FIELDS.includes(k), `${p.id} adds unexpected ${k}`);
});

check("planning does not mutate the input documents", () => {
  const fresh = JSON.parse(JSON.stringify(cars));
  fresh.forEach((c) => planCar(c, models, placeholders));
  assert.deepEqual(fresh, cars);
});

check("no odometer is migrated", () => {
  for (const p of plans) assert.equal(p.add.odometerKm, null, `${p.title} got odometerKm`);
});

check("every car with an odometer string is flagged for review", () => {
  for (const c of cars) {
    if (!c.specifications?.Odometer) continue;
    const p = plans.find((x) => x.id === c.id);
    assert.ok(p.review.some((r) => r.startsWith("Kilometres driven not provided.")), `${p.title} not flagged`);
  }
});

check("the shared placeholder readings are detected", () => {
  for (const v of [26400, 21000, 11500]) assert.ok(placeholders.has(v), `${v} not seen as placeholder`);
});

check("contradictory fields stay null and are reported (Wrangler)", () => {
  const p = plans.find((x) => x.title === "Jeep Wrangler Rubicon");
  assert.equal(p.add.fuelTypes, null);
  assert.equal(p.add.transmissionNorm, null);
  assert.ok(p.review.some((r) => r.startsWith("Fuel conflict")));
  assert.ok(p.review.some((r) => r.startsWith("Transmission conflict")));
});

check("a multi-fuel listing is not resolved to one fuel (Range Rover)", () => {
  const p = plans.find((x) => x.title === "Land Rover Range Rover Vogue");
  assert.equal(p.add.fuelTypes, null);
  assert.ok(p.review.some((r) => r.includes("lists several fuels")));
});

check("year and seat conflicts are reported, and the existing fields are not added to", () => {
  const mustang = plans.find((x) => x.title === "Ford Mustang");
  assert.ok(mustang.review.some((r) => r.startsWith("Year conflict")));
  assert.ok(mustang.review.some((r) => r.startsWith("Seats 2")));
  assert.ok(!("year" in mustang.add) && !("seats" in mustang.add));
});

check("safety specs are never filled", () => {
  for (const p of plans) {
    assert.equal(p.add.airbags, null);
    assert.equal(p.add.ncapStars, null);
  }
  for (const m of planModels(ref)) {
    assert.equal(m.data.airbags, null);
    assert.equal(m.data.ncapStars, null);
    assert.equal(m.data.verified, false);
  }
});

check("every value with a source has provenance", () => {
  for (const p of plans)
    for (const k of ["fuelTypes", "transmissionNorm", "fuelEconomyKmpl", "powerHp", "groundClearanceMm", "bootLitres"])
      if (p.add[k] != null) assert.ok(p.add.provenance[k], `${p.title}.${k} has no provenance`);
});

check("no value is taken from the unverified reference file", () => {
  for (const p of plans) {
    assert.equal(p.add.bodyType, null, `${p.title} got bodyType`);
    assert.ok(!Object.values(p.add.provenance).some((v) => /reference/.test(v)), `${p.title} has reference provenance`);
    assert.ok(p.review.some((r) => r.startsWith("Body type not recorded")));
  }
});

check("every draft reference entry is unverified", () => {
  for (const m of ref.models) assert.notEqual(m.verified, true, `${m.brand} ${m.model} marked verified`);
});

/* ------------------------------ edge cases ----------------------------- */

check("a field that already exists is skipped, never rewritten", () => {
  const car = { id: "x", brandName: "Hyundai", model: "Venue", fuelType: "Petrol", fuelTypes: ["diesel"], odometerKm: 5000 };
  const p = planCar(car, models, new Set());
  assert.ok(!("fuelTypes" in p.add) && !("odometerKm" in p.add));
  assert.deepEqual(p.skipped.sort(), ["fuelTypes", "odometerKm"]);
});

check("running the plan twice changes nothing the second time", () => {
  const car = { ...cars[0] };
  Object.assign(car, planCar(car, models, placeholders).add);
  assert.deepEqual(planCar(car, models, placeholders).add, {});
});

check("a car with no reference model gets a null body type and a review entry", () => {
  const p = planCar({ id: "y", brandName: "Maruti", model: "Swift", fuelType: "Petrol" }, models, new Set());
  assert.equal(p.add.bodyType, null);
  assert.ok(p.review.some((r) => r.includes("no reference entry")));
});

check("parsers", () => {
  assert.deepEqual(parseFuels("petrol and diesel"), ["petrol", "diesel"]);
  assert.deepEqual(parseFuels("Diesel"), ["diesel"]);
  assert.equal(parseTransmission("Automatic"), "automatic");
  assert.equal(parseTransmission("Manual"), "manual");
  assert.equal(parseTransmission(""), null);
  assert.equal(parsePower("201 to 204"), 201);
  assert.equal(parsePower("134 hp"), 134);
  assert.equal(parsePower("183.7"), 184);
});

/* --------------------------- source guarantees ------------------------- */

const src = await readFile(path.join(ROOT, "scripts/migrate-phase0.mjs"), "utf8");
check("the migration script has no delete operation", () => {
  assert.ok(!/method:\s*["']DELETE["']/i.test(src), "found a DELETE request");
  assert.ok(!/deleteDoc|\.delete\(/.test(src), "found a delete call");
});

check("--apply creates no carModels documents", () => {
  assert.ok(!/createDoc|documentId=/.test(src), "migration can create documents");
  assert.ok(!/\/carModels\?|"carModels", m\./.test(src), "migration writes carModels");
});

const seedSrc = await readFile(path.join(ROOT, "scripts/seed-car-models.mjs"), "utf8");
check("seed script cannot write (no fetch, no POST/PATCH)", () => {
  assert.ok(!/fetch\(|method:/.test(seedSrc));
});

check("writes are restricted to an update mask on existing documents", () => {
  assert.ok(/updateMask\.fieldPaths/.test(src));
  assert.ok(/currentDocument\.exists=true/.test(src));
});

check("apply only runs with --apply", () => {
  assert.ok(/if \(!apply\)\s*\{[\s\S]*?return;/.test(src));
});


/* ------------------------- sign-in error handling ---------------------- */
// Firebase is simulated here: USER_DISABLED and TOO_MANY_ATTEMPTS_TRY_LATER
// cannot be triggered safely against the live project.
const { signIn } = await import("./migrate-phase0.mjs");
const { Readable, Writable } = await import("node:stream");
const quiet = new Writable({ write: (_c, _e, cb) => cb() });
async function signInWith(firebaseReply, lines = "admin@example.com\nPa ss\n") {
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(init.body);
    return { ok: !firebaseReply.error, json: async () => firebaseReply };
  };
  const realLog = console.log;
  console.log = () => {};
  try {
    return { result: await signIn({ apiKey: "k" }, { input: Readable.from([lines]), output: quiet }), sent };
  } catch (err) {
    return { error: err.message, sent };
  } finally {
    globalThis.fetch = realFetch;
    console.log = realLog;
  }
}

for (const [code, words] of [
  ["INVALID_EMAIL", "not valid"],
  ["INVALID_LOGIN_CREDENTIALS", "Wrong email or password"],
  ["USER_DISABLED", "disabled"],
  ["TOO_MANY_ATTEMPTS_TRY_LATER : Access to this account has been temporarily disabled", "Wait a few minutes"],
]) {
  const r = await signInWith({ error: { message: code } });
  check(`sign-in error ${code.split(" ")[0]} gets a clear message`, () => {
    assert.ok(r.error.includes(code.split(" ")[0]), r.error);
    assert.ok(r.error.includes(words), r.error);
  });
}

const ok = await signInWith({ idToken: "t", localId: "uid1", email: "admin@example.com" }, "\u0016  admin@example.com \nPa ss \n");
check("email is trimmed and cleaned; password is sent unchanged", () => {
  assert.equal(ok.sent.email, "admin@example.com");
  assert.equal(ok.sent.password, "Pa ss ");
  assert.equal(ok.result.uid, "uid1");
});

check("--apply signs in through the admin check before any write", () => {
  const applyAt = src.indexOf("await authenticateAdmin(cfg)).idToken");
  assert.ok(applyAt > 0, "apply does not use authenticateAdmin");
  assert.ok(applyAt < src.indexOf("await patchFields("), "a write happens before the admin check");
});


/* -------------------- verification: deep equality ---------------------- */
const { deepEqual, verifyAgainstBackup, readHidden } = await import("./migrate-phase0.mjs");

check("deepEqual: same keys in a different order are equal", () => {
  assert.ok(deepEqual({ Fuel: "Diesel", Year: "2023", Odometer: "11,500 km" }, { Odometer: "11,500 km", Year: "2023", Fuel: "Diesel" }));
});
check("deepEqual: nested objects in a different key order are equal", () => {
  assert.ok(deepEqual({ a: 1, n: { x: { p: 1, q: [1, 2] }, y: 2 } }, { n: { y: 2, x: { q: [1, 2], p: 1 } }, a: 1 }));
});
check("deepEqual: array order still matters", () => {
  assert.ok(!deepEqual(["petrol", "diesel"], ["diesel", "petrol"]));
  assert.ok(!deepEqual({ f: [1, 2] }, { f: [2, 1] }));
});
check("deepEqual: primitives compare normally", () => {
  assert.ok(deepEqual(5, 5) && deepEqual("a", "a") && deepEqual(null, null) && deepEqual(false, false));
  assert.ok(!deepEqual(5, "5") && !deepEqual(0, false) && !deepEqual(null, undefined) && !deepEqual("", null));
});
check("deepEqual: a changed, added or removed key is a difference", () => {
  assert.ok(!deepEqual({ a: 1, b: 2 }, { a: 1, b: 3 }));
  assert.ok(!deepEqual({ a: 1 }, { a: 1, b: 2 }));
  assert.ok(!deepEqual({ a: 1, b: 2 }, { a: 1 }));
  assert.ok(!deepEqual({ a: { b: 1 } }, { a: { b: 1, c: 1 } }));
  assert.ok(!deepEqual({}, []));
});

/* ----------------------- verification: regressions --------------------- */
const migrated = (list) => list.map((c) => ({ ...c, ...planCar(c, models, placeholderOdometers(list)).add }));
const base = [
  { id: "a", model: "X", specifications: { Fuel: "Diesel", Year: "2023", meta: { src: "seed", n: 1 } }, features: ["x", "y"] },
  { id: "b", model: "Y", specifications: {} },
];
const reordered = (c) => ({ ...c, specifications: Object.fromEntries(Object.entries(c.specifications).reverse().map(([k, v]) => [k, v && typeof v === "object" ? Object.fromEntries(Object.entries(v).reverse()) : v])) });
const verify = (after, extra = {}) => verifyAgainstBackup({ beforeCars: base, afterCars: after, modelsBefore: 0, modelsAfter: 0, ...extra }).problems;

check("REGRESSION: map keys returned in a different order -> VERIFY OK", () => {
  assert.deepEqual(verify(migrated(base).map(reordered)), []);
});

// The two backups taken before any write (11:38 and 11:39) came back from
// Firestore with specifications keys in different orders. Treating the second
// read plus the planned new fields as "after" must give VERIFY OK.
const early = backups.filter((f) => f < "firestore-2026-09-27T11-40");
if (early.length >= 2) {
  const [b1, b2] = await Promise.all(early.slice(0, 2).map(async (f) => JSON.parse(await readFile(path.join(ROOT, "backups", f), "utf8")).cars));
  check("REGRESSION: two real Firestore reads with reordered map keys -> VERIFY OK", () => {
    const orderDiffers = b1.filter((c) => {
      const d = b2.find((x) => x.id === c.id);
      return c.specifications && Object.keys(c.specifications).join() !== Object.keys(d.specifications).join();
    }).length;
    assert.ok(orderDiffers > 0, "fixture no longer shows reordered keys");
    const after = b2.map((c) => ({ ...c, ...planCar(c, models, placeholderOdometers(b2)).add }));
    assert.deepEqual(verifyAgainstBackup({ beforeCars: b1, afterCars: after, modelsBefore: 0, modelsAfter: 0 }).problems, []);
  });
}

check("verifier still catches a changed value inside a map", () => {
  const after = migrated(base);
  after[0] = { ...after[0], specifications: { ...after[0].specifications, Fuel: "Petrol" } };
  assert.deepEqual(verify(after), ["CHANGED a.specifications"]);
});
check("verifier still catches a changed value in a nested object", () => {
  const after = migrated(base);
  after[0] = { ...after[0], specifications: { ...after[0].specifications, meta: { n: 2, src: "seed" } } };
  assert.deepEqual(verify(after), ["CHANGED a.specifications"]);
});
check("verifier still catches a reordered array", () => {
  const after = migrated(base);
  after[0] = { ...after[0], features: ["y", "x"] };
  assert.deepEqual(verify(after), ["CHANGED a.features"]);
});
check("verifier catches a deleted car", () => {
  assert.deepEqual(verify(migrated(base).slice(0, 1)), ["MISSING after apply: b"]);
});
check("verifier catches an unexpected new car", () => {
  assert.deepEqual(verify([...migrated(base), { id: "z" }]), ["UNEXPECTED car created: z"]);
});
check("verifier catches an unexpected new field", () => {
  const after = migrated(base);
  after[1] = { ...after[1], price: 5 };
  assert.deepEqual(verify(after), ["UNEXPECTED field b.price"]);
});
check("verifier catches a missing new field", () => {
  const after = migrated(base);
  delete after[0].schemaVersion;
  assert.deepEqual(verify(after), ["NOT ADDED a.schemaVersion"]);
});
check("verifier catches a held field that is not null (odometer, body type, safety, colour, owners)", () => {
  for (const k of ["odometerKm", "bodyType", "airbags", "ncapStars", "colour", "owners"]) {
    const after = migrated(base);
    after[0] = { ...after[0], [k]: 1 };
    assert.deepEqual(verify(after), [`NOT NULL a.${k} = 1`], k);
  }
});
check("verifier allows a held field that already existed before", () => {
  const before = [{ id: "a", odometerKm: 900 }];
  const after = before.map((c) => ({ ...c, ...planCar(c, models, new Set()).add }));
  assert.deepEqual(verifyAgainstBackup({ beforeCars: before, afterCars: after, modelsBefore: 0, modelsAfter: 0 }).problems, []);
});
check("verifier catches carModels documents being created", () => {
  assert.deepEqual(verify(migrated(base), { modelsAfter: 3 }), ["carModels count changed: 0 -> 3"]);
});
check("apply uses the fixed verifier, not a JSON.stringify comparison", () => {
  assert.ok(/verifyAgainstBackup\(\{ beforeCars: cars, afterCars: after/.test(src));
  assert.ok(!/JSON\.stringify\(now\[k\]\) !== JSON\.stringify\(v\)/.test(src));
});

/* --------------------------- password masking -------------------------- */
const { PassThrough } = await import("node:stream");
function fakeTerminal() {
  const input = new PassThrough();
  input.isTTY = true;
  const modes = [];
  input.setRawMode = (on) => modes.push(on);
  let shown = "";
  const output = new Writable({ write: (c, _e, cb) => { shown += c; cb(); } });
  return { input, output, modes, shown: () => shown };
}

{
  const t = fakeTerminal();
  const p = readHidden(t.input, t.output, "Password: ");
  t.input.write("s3cret-Pa");
  t.input.write("ss\r");
  const value = await p;
  check("masked prompt returns what was typed", () => assert.equal(value, "s3cret-Pass"));
  check("masked prompt never writes the password to the screen", () => {
    assert.ok(!t.shown().includes("s3cret"), t.shown());
    assert.equal(t.shown(), "Password: \n");
  });
  check("masked prompt turns raw mode on and restores it", () => assert.deepEqual(t.modes, [true, false]));
}
{
  const t = fakeTerminal();
  const p = readHidden(t.input, t.output, "P: ");
  t.input.write("abX\u007fc\r");
  const typed = await p;
  check("masked prompt handles backspace", () => assert.equal(typed, "abc"));
}
{
  const t = fakeTerminal();
  const p = readHidden(t.input, t.output, "P: ");
  t.input.write("ab\u0003");
  const err = await p.catch((e) => e.message);
  check("Ctrl+C cancels the masked prompt and writes nothing", () => assert.match(err, /Cancelled/));
}
{
  // End to end: a terminal session through signIn, Firebase simulated.
  const t = fakeTerminal();
  const realFetch = globalThis.fetch;
  let sent = null;
  globalThis.fetch = async (_u, init) => { sent = JSON.parse(init.body); return { ok: true, json: async () => ({ idToken: "t", localId: "u", email: "admin@example.com" }) }; };
  const realLog = console.log;
  const logged = [];
  console.log = (...a) => logged.push(a.join(" "));
  const p = signIn({ apiKey: "k" }, { input: t.input, output: t.output });
  t.input.write(" admin@example.com \n");
  await new Promise((r) => setTimeout(r, 20));
  t.input.write("Hidden Pw \r");
  await p;
  globalThis.fetch = realFetch;
  console.log = realLog;
  check("terminal sign-in: email trimmed, password sent unchanged", () => {
    assert.equal(sent.email, "admin@example.com");
    assert.equal(sent.password, "Hidden Pw ");
  });
  check("terminal sign-in: password never shown or logged", () => {
    assert.ok(!t.shown().includes("Hidden Pw"), t.shown());
    assert.ok(!logged.join("\n").includes("Hidden Pw"));
  });
}

console.log(`\n${passed} checks passed.`);
