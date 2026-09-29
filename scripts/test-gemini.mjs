#!/usr/bin/env node
// Hedged Gemini calls (server/lib/gemini.js) with a fake network: no real
// request is made and no key is used.
//   node scripts/test-gemini.mjs
import assert from "node:assert/strict";
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
const env = { GEMINI_API_KEY: "test-key" };
const ok = (obj, model) => ({ ok: true, json: async () => ({ modelVersion: model, candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] }) });
const status = (code) => ({ ok: false, status: code, text: async () => "{}" });
const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); });
  });
const plan = [["lite", 0], ["lite", 50], ["flash", 100]];
const opts = { system: "s", user: "u", schema: {}, plan, attemptTimeoutMs: 300, deadlineMs: 600 };

await check("fast first answer wins; later attempts never start", async () => {
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); return ok({ a: 1 }, "lite-1"); };
  const r = await generateJson(env, { ...opts, fetchImpl });
  assert.deepEqual(r, { data: { a: 1 }, modelVersion: "lite-1" });
  await sleep(150);
  assert.equal(calls.length, 1);
});
await check("slow first attempt: the hedge started later answers first", async () => {
  let n = 0;
  const fetchImpl = async (_u, init) => {
    const i = n++;
    if (i === 0) { await sleep(250, init.signal); return ok({ from: "first" }, "lite"); }
    return ok({ from: "second" }, "lite");
  };
  const r = await generateJson(env, { ...opts, fetchImpl });
  assert.equal(r.data.from, "second");
});
await check("the losing attempt is cancelled", async () => {
  let aborted = false;
  let n = 0;
  const fetchImpl = async (_u, init) => {
    if (n++ === 0) { init.signal.addEventListener("abort", () => (aborted = true)); await sleep(1000, init.signal); }
    return ok({}, "lite");
  };
  await generateJson(env, { ...opts, fetchImpl });
  assert.ok(aborted);
});
await check("overloaded models fall through to the next attempt", async () => {
  let n = 0;
  const fetchImpl = async () => (n++ < 2 ? status(503) : ok({ ok: true }, "flash"));
  const r = await generateJson(env, { ...opts, fetchImpl });
  assert.equal(r.modelVersion, "flash");
});
await check("every attempt overloaded -> 'busy' message, not a crash", async () => {
  const fetchImpl = async () => status(503);
  await assert.rejects(generateJson(env, { ...opts, fetchImpl }), (e) => e instanceof GeminiError && /busy/.test(e.message));
});
await check("nothing answers before the deadline -> 'busy', within the deadline", async () => {
  const fetchImpl = async (_u, init) => { await sleep(5000, init.signal); return ok({}, "x"); };
  const t = Date.now();
  await assert.rejects(generateJson(env, { ...opts, fetchImpl }), GeminiError);
  assert.ok(Date.now() - t < 900, `took ${Date.now() - t}ms`);
});
await check("non-JSON model output is treated as a failed attempt", async () => {
  let n = 0;
  const bad = { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }) };
  const fetchImpl = async () => (n++ === 0 ? bad : ok({ fine: true }, "lite"));
  assert.deepEqual((await generateJson(env, { ...opts, fetchImpl })).data, { fine: true });
});
await check("the key goes only in a header, never the URL, and never in an error", async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, headers: init.headers }; return status(400); };
  const err = await generateJson(env, { ...opts, fetchImpl }).catch((e) => e);
  assert.ok(!seen.url.includes("test-key"));
  assert.equal(seen.headers["x-goog-api-key"], "test-key");
  assert.ok(!String(err.message).includes("test-key"));
});
await check("no key configured -> clear error, no request", async () => {
  let called = false;
  await assert.rejects(generateJson({}, { ...opts, fetchImpl: async () => { called = true; } }), /not configured/);
  assert.equal(called, false);
});

console.log(`\n${passed} checks passed. (Fake network; no Gemini request made.)`);
