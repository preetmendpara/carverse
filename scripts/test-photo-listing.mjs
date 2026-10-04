#!/usr/bin/env node
// AI Photo-to-Listing: validate.js (pure), the /api/photo-listing handler with
// fake Gemini and auth, image parts in the Gemini request, and the admin
// wiring. No real network is used; no key is needed.
//   node scripts/test-photo-listing.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateListing, OBSERVED_MIN, LISTING_FIELDS } from "../server/listing/validate.js";
import { handlePhotoListing, MIN_PHOTOS, MAX_PHOTOS, MAX_PHOTO_BYTES, PHOTO_PLAN } from "../server/listing/api.js";
import { LISTING_SCHEMA, LISTING_PROMPT } from "../server/listing/extract.js";
import { generateJson, GeminiError } from "../server/lib/gemini.js";

globalThis.fetch = () => {
  throw new Error("real network used in a test");
};
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const f = (value, status = "observed", confidence = 0.9, photos = [1], evidence = "badge on tailgate") => ({ value, status, confidence, evidence, photos });
const none = { value: null, status: "not_visible", confidence: 0, evidence: "", photos: [] };
const raw = (over = {}) => ({
  sameCarInAllPhotos: true,
  make: f("Hyundai"),
  model: f("Venue"),
  variant: { ...none },
  bodyType: f("compact_suv", "observed", 0.85, [2], "short SUV body"),
  colour: f("white", "observed", 0.9, [1, 3], "paint in daylight"),
  odometerKm: { ...none },
  damage: [],
  features: [],
  description: "A white Hyundai Venue compact SUV.",
  imageNotes: [],
  ...over,
});

console.log("validate.js");
await check("clean observed values pass through unchanged", () => {
  const out = validateListing(raw(), 6);
  assert.deepEqual(out.fields.make, { value: "Hyundai", status: "observed", confidence: 0.9, evidence: "badge on tailgate", photos: [1] });
  assert.equal(out.fields.bodyType.value, "compact_suv");
  assert.deepEqual(Object.keys(out.fields), LISTING_FIELDS);
  assert.equal(out.photoCount, 6);
});
await check("not_visible or missing value always means null with confidence 0", () => {
  const out = validateListing(raw({ variant: f("SX(O)", "not_visible", 0.9), model: f(null, "observed", 0.9) }), 6);
  assert.deepEqual(out.fields.variant, none);
  assert.deepEqual(out.fields.model, none);
  assert.deepEqual(validateListing({}, 5).fields.make, none);
});
await check("observed with low confidence, no photo or no evidence is downgraded to uncertain, below the threshold", () => {
  for (const bad of [f("Hyundai", "observed", 0.5), f("Hyundai", "observed", 0.95, []), f("Hyundai", "observed", 0.95, [1], "")]) {
    const m = validateListing(raw({ make: bad }), 6).fields.make;
    assert.equal(m.status, "uncertain");
    assert.ok(m.confidence < OBSERVED_MIN);
  }
});
await check("uncertain confidence is capped below the observed threshold", () => {
  assert.equal(validateListing(raw({ colour: f("grey", "uncertain", 0.95) }), 6).fields.colour.confidence, OBSERVED_MIN - 0.01);
});
await check("confidence is clamped to 0..1 and photo numbers outside 1..N are dropped", () => {
  const m = validateListing(raw({ make: f("Hyundai", "observed", 7, [0, 1, 9, 1, 2]) }), 6).fields.make;
  assert.equal(m.confidence, 1);
  assert.deepEqual(m.photos, [1, 2]);
});
await check("bodyType outside the enum is rejected", () => {
  assert.deepEqual(validateListing(raw({ bodyType: f("crossover") }), 6).fields.bodyType, none);
});
await check("odometer is kept only when observed on a legible reading, in range; never estimated", () => {
  assert.equal(validateListing(raw({ odometerKm: f(42150, "observed", 0.9, [4], "cluster reads 42150") }), 6).fields.odometerKm.value, 42150);
  const guessed = validateListing(raw({ odometerKm: f(60000, "uncertain", 0.6, [4], "tyre wear") }), 6);
  assert.deepEqual(guessed.fields.odometerKm, none);
  assert.ok(guessed.warnings.some((w) => /odometer/i.test(w)));
  for (const v of [-5, 2_000_000, 1234.5, "42000"]) assert.deepEqual(validateListing(raw({ odometerKm: f(v) }), 6).fields.odometerKm, none);
});
await check("damage and features need a valid photo; features are de-duplicated and downgraded when weak", () => {
  const out = validateListing(
    raw({
      damage: [
        { area: "rear bumper", description: "scratch", severity: "minor", confidence: 0.8, photos: [3] },
        { area: "door", description: "dent", severity: "terrible", confidence: 0.8, photos: [] },
      ],
      features: [
        { name: "Sunroof", status: "observed", confidence: 0.9, photos: [5] },
        { name: "sunroof", status: "observed", confidence: 0.9, photos: [5] },
        { name: "Alloy wheels", status: "observed", confidence: 0.4, photos: [2] },
        { name: "Touchscreen", status: "observed", confidence: 0.9, photos: [99] },
      ],
    }),
    6
  );
  assert.deepEqual(out.damage.map((d) => d.area), ["rear bumper"]);
  assert.deepEqual(out.features.map((x) => [x.name, x.status]), [["Sunroof", "observed"], ["Alloy wheels", "uncertain"]]);
  assert.equal(validateListing(raw({ damage: [{ area: "x", description: "y", severity: "terrible", confidence: 1, photos: [1] }] }), 6).damage[0].severity, "unclear");
});
await check("different-car and photo-quality notes become warnings", () => {
  const out = validateListing(raw({ sameCarInAllPhotos: false, imageNotes: ["Photo 4 is blurry"] }), 6);
  assert.ok(out.warnings.some((w) => /different car/.test(w)));
  assert.ok(out.warnings.includes("Photo 4 is blurry"));
});
await check("strings are trimmed and length-capped; garbage input never throws", () => {
  const out = validateListing(raw({ make: f("  Hyundai   Motor ".padEnd(200, "x")), description: "d".repeat(5000) }), 6);
  assert.ok(out.fields.make.value.length <= 60 && !out.fields.make.value.startsWith(" "));
  assert.equal(out.description.length, 1200);
  for (const junk of [null, 42, "x", [], { make: "Hyundai", damage: "none", features: {} }]) validateListing(junk, 5);
});

console.log("Schema and prompt");
await check("schema asks for status, confidence, evidence and photos on every field", () => {
  for (const k of LISTING_FIELDS) assert.deepEqual(LISTING_SCHEMA.properties[k].required, ["value", "status", "confidence", "evidence", "photos"]);
  assert.ok(LISTING_SCHEMA.required.includes("description"));
});
await check("prompt forbids guessing and covers the odometer and damage rules", () => {
  for (const bit of ["Never use general knowledge", "not_visible", "odometer", "Never estimate", "Do not say the car is undamaged", "No price"]) assert.ok(LISTING_PROMPT.includes(bit), bit);
});

console.log("POST /api/photo-listing");
const ADMIN = { uid: "admin-1", idToken: "tok" };
const photo = (type = "image/jpeg", size = 1000) => new File([new Uint8Array(size)], "p.jpg", { type });
const request = (files, method = "POST") => {
  const form = new FormData();
  files.forEach((x) => form.append("photos", x));
  return new Request("https://x/api/photo-listing", method === "POST" ? { method, body: form } : { method });
};
const deps = (over = {}) => {
  const calls = [];
  return {
    calls,
    admin: async () => ADMIN,
    extract: async (env, opts) => {
      calls.push(opts);
      return { data: raw(), modelVersion: "gemini-3.8-flash" };
    },
    GeminiError,
    ...over,
  };
};
const six = () => Array.from({ length: 6 }, () => photo());

await check("non-admin gets 401 and Gemini is never called", async () => {
  const d = deps({ admin: async () => null });
  const res = await handlePhotoListing(request(six()), {}, d);
  assert.equal(res.status, 401);
  assert.equal(d.calls.length, 0);
});
await check("GET is refused", async () => {
  assert.equal((await handlePhotoListing(request([], "GET"), {}, deps())).status, 405);
});
await check(`fewer than ${MIN_PHOTOS} or more than ${MAX_PHOTOS} photos is 400`, async () => {
  for (const n of [MIN_PHOTOS - 1, MAX_PHOTOS + 1]) {
    const d = deps();
    const res = await handlePhotoListing(request(Array.from({ length: n }, () => photo())), {}, d);
    assert.equal(res.status, 400);
    assert.equal(d.calls.length, 0);
  }
});
await check("wrong type is 415, an oversized photo is 413", async () => {
  assert.equal((await handlePhotoListing(request([...six().slice(1), photo("image/gif")]), {}, deps())).status, 415);
  assert.equal((await handlePhotoListing(request([...six().slice(1), photo("image/jpeg", MAX_PHOTO_BYTES + 1)]), {}, deps())).status, 413);
});
await check("valid request: photos sent as base64 images, vision plan used, validated result returned, nothing written", async () => {
  const d = deps();
  const res = await handlePhotoListing(request(six()), {}, d);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(d.calls.length, 1);
  const opts = d.calls[0];
  assert.equal(opts.images.length, 6);
  assert.equal(opts.images[0].mimeType, "image/jpeg");
  assert.equal(opts.images[0].data, Buffer.from(new Uint8Array(1000)).toString("base64"));
  assert.deepEqual(opts.plan, PHOTO_PLAN);
  assert.equal(opts.schema, LISTING_SCHEMA);
  assert.equal(body.photoCount, 6);
  assert.equal(body.fields.make.value, "Hyundai");
  assert.equal(body.model, "gemini-3.8-flash");
  assert.ok(!Number.isNaN(Date.parse(body.analysedAt)));
  assert.ok(!("getDoc" in d) && !("patchDoc" in d));
});
await check("Gemini answer is validated before it is returned", async () => {
  const d = deps({ extract: async () => ({ data: raw({ odometerKm: f(60000, "uncertain", 0.5, [2], "guess") }), modelVersion: "m" }) });
  const body = await (await handlePhotoListing(request(six()), {}, d)).json();
  assert.equal(body.fields.odometerKm.value, null);
});
await check("Gemini failure is 503 with the safe message, never a guessed listing", async () => {
  const d = deps({ extract: async () => { throw new GeminiError("The AI service is busy right now. Please try again in a moment."); } });
  const res = await handlePhotoListing(request(six()), {}, d);
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.error, "ai_unavailable");
  assert.ok(!("fields" in body));
});

console.log("Gemini helper: image parts");
await check("images are sent as inlineData parts after the text, in order", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ modelVersion: "m", candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
  };
  await generateJson({ GEMINI_API_KEY: "k" }, { system: "s", user: "u", schema: {}, images: [{ mimeType: "image/jpeg", data: "AAA" }, { mimeType: "image/png", data: "BBB" }], plan: [["m", 0]], fetchImpl });
  assert.deepEqual(sent.contents[0].parts, [{ text: "u" }, { inlineData: { mimeType: "image/jpeg", data: "AAA" } }, { inlineData: { mimeType: "image/png", data: "BBB" } }]);
});
await check("without images the request is unchanged (one text part)", async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = JSON.parse(init.body);
    return { ok: true, json: async () => ({ modelVersion: "m", candidates: [{ content: { parts: [{ text: "{}" }] } }] }) };
  };
  await generateJson({ GEMINI_API_KEY: "k" }, { system: "s", user: "u", schema: {}, plan: [["m", 0]], fetchImpl });
  assert.deepEqual(sent.contents[0].parts, [{ text: "u" }]);
});

console.log("Wiring");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [worker, admin, panel, store, fields] = await Promise.all([
  read("../server/worker.js"),
  read("../public/app/js/pages/admin.js"),
  read("../public/app/js/features/photo-listing.js"),
  read("../public/app/js/core/store.js"),
  read("../public/app/js/core/car-fields.js"),
]);
await check("route is admin-only through adminUser", async () => {
  assert.ok(/"\/api\/photo-listing"\) return handlePhotoListing\(request, env, adminAiDeps\)/.test(worker));
  assert.ok(/admin: adminUser/.test(worker));
});
await check("browser never calls Gemini or holds a key", async () => {
  for (const src of [panel, store]) assert.ok(!/generativelanguage|GEMINI_API_KEY|x-goog-api-key/.test(src));
  assert.ok(/"\/api\/photo-listing"/.test(store));
});
await check("nothing is applied before 'Fill the form', and filling sets the car to Draft", async () => {
  const fill = panel.slice(panel.indexOf("function fill()"), panel.indexOf("return {"));
  assert.ok(/\$\("status"\)\.value = "draft"/.test(fill));
  const before = panel.slice(0, panel.indexOf("function fill()"));
  assert.ok(!/\.value = String\(v\)/.test(before), "a form control is set before fill()");
  assert.ok(/PRE_TICK = 0\.8/.test(panel));
});
await check("save marks only unchanged AI values as ai-photo and stores the reading in aiListing", async () => {
  assert.ok(/if \(\$\(id\)\?\.value !== value\) continue;/.test(panel));
  assert.ok(/const ai = photoAi\.kept\(\);/.test(admin));
  assert.ok(/data\.aiListing = ai\.record;/.test(admin));
  assert.ok(fields.includes(`if (p === "ai-photo") return "From photos (AI), reviewed by admin";`));
});

console.log(`\n${passed} checks passed. (Fakes only; no real network.)`);
