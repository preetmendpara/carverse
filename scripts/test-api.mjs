#!/usr/bin/env node
// POST /api/match and POST /api/chat, end to end through the real handlers,
// with Gemini, Firestore and Firebase Auth replaced by fakes. For 429 / 503 /
// timeout, the REAL hedged Gemini helper runs against a fake network.
// No real network is used; no key is needed.
//   node scripts/test-api.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleMatchRequest, QUERY_MAX } from "../server/match/api.js";
import { handleChatRequest, OFF_TOPIC_REPLY, resolveCar } from "../server/chat/api.js";
import { generateJson, GeminiError } from "../server/lib/gemini.js";

globalThis.fetch = () => {
  throw new Error("real network used in a test");
};
const { cars: fixture } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
const cars = fixture.map((c) => ({ ...c, status: "published" }));
const TOKEN = "test-id-token-SECRET";

// Everything printed during the run, to prove tokens and keys never appear.
const printed = [];
for (const k of ["log", "error", "warn"]) {
  const orig = console[k];
  console[k] = (...a) => {
    printed.push(a.map(String).join(" "));
    if (k === "log") orig(...a);
  };
}

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const base = (over = {}) => ({
  intent: "recommend", carRef: null, budgetMaxInr: null, budgetMinInr: null, transmission: null, fuel: null, seatsMin: null,
  bodyTypes: null, usage: [], priorities: [], mustHaveFeatures: [], inferred: [], unparsed: [], ...over,
});
function deps({ extract = base(), answer = "An answer.", listCars = async () => cars, writeLog } = {}) {
  const calls = { extract: [], answer: [], logs: [] };
  return {
    calls,
    auth: async (req) => ((req.headers.get("Authorization") || "") === `Bearer ${TOKEN}` ? { uid: "buyer-1", idToken: TOKEN } : null),
    extract: async (env, opts) => {
      calls.extract.push(opts);
      if (typeof extract === "function") return extract(env, opts);
      return { data: extract, modelVersion: "fake-model" };
    },
    answer: async (env, opts) => {
      calls.answer.push(opts);
      return { data: answer, modelVersion: "fake-model" };
    },
    listCars,
    writeLog: writeLog || (async (env, token, doc) => { calls.logs.push(doc); return true; }),
    GeminiError,
  };
}
const post = (path, body, { auth = true, raw } = {}) =>
  new Request(`http://local${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(auth ? { Authorization: `Bearer ${TOKEN}` } : {}) },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
const call = async (handler, req, d) => {
  const res = await handler(req, {}, d);
  return { status: res.status, body: await res.json() };
};
const noSecrets = (body) => {
  const s = JSON.stringify(body);
  assert.ok(!s.includes(TOKEN), "token in response");
  assert.ok(!/AIza|AQ\.[A-Za-z0-9_-]{20}|xkeysib|fake-model|modelVersion|"ms"/.test(s), `internal data in response: ${s.slice(0, 200)}`);
};
const TWELVE_LAKH_AUTO = base({ budgetMaxInr: 1200000, transmission: { value: "automatic", strength: "required" }, usage: ["city"] });

console.log("POST /api/match");
await check("valid authenticated request -> 200 with ranked results", async () => {
  const d = deps({ extract: TWELVE_LAKH_AUTO });
  const r = await call(handleMatchRequest, post("/api/match", { query: "automatic under 12 lakh, city" }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results.map((x) => x.title), ["Hyundai Venue"]);
  noSecrets(r.body);
});
await check("unauthenticated -> 401, no AI call", async () => {
  const d = deps();
  const r = await call(handleMatchRequest, post("/api/match", { query: "x" }, { auth: false }), d);
  assert.equal(r.status, 401);
  assert.equal(d.calls.extract.length, 0);
});
await check("empty query -> 400, no AI call", async () => {
  const d = deps();
  assert.equal((await call(handleMatchRequest, post("/api/match", { query: "   " }), d)).status, 400);
  assert.equal(d.calls.extract.length, 0);
});
await check(`query over ${QUERY_MAX} characters -> 400, no AI call`, async () => {
  const d = deps();
  assert.equal((await call(handleMatchRequest, post("/api/match", { query: "a".repeat(QUERY_MAX + 1) }), d)).status, 400);
  assert.equal(d.calls.extract.length, 0);
});
await check("malformed JSON -> 400, no crash", async () => {
  const d = deps();
  const r = await call(handleMatchRequest, post("/api/match", null, { raw: "{not json" }), d);
  assert.deepEqual([r.status, r.body.error], [400, "bad_json"]);
});
await check("GET -> 405", async () => {
  const res = await handleMatchRequest(new Request("http://local/api/match"), {}, deps());
  assert.equal(res.status, 405);
});
await check("ambiguous budget ('car under 12') -> 422 clarify, even if the AI returned 12 lakh", async () => {
  const d = deps({ extract: base({ budgetMaxInr: 1200000 }) });
  const r = await call(handleMatchRequest, post("/api/match", { query: "car under 12" }), d);
  assert.deepEqual([r.status, r.body.error], [422, "clarify"]);
  assert.match(r.body.message, /What does "12" mean/);
  assert.equal(d.calls.logs.length, 0, "a clarification is not logged as a search");
});
await check("valid no-match -> 200 with no results, and no invented car", async () => {
  const d = deps({ extract: base({ budgetMaxInr: 200000 }) });
  const r = await call(handleMatchRequest, post("/api/match", { query: "any car under 2 lakh" }), d);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.results, []);
});
await check("not a car search (intent off_topic) -> 422, no results", async () => {
  const d = deps({ extract: base({ intent: "off_topic" }) });
  const r = await call(handleMatchRequest, post("/api/match", { query: "write python code" }), d);
  assert.deepEqual([r.status, r.body.error], [422, "not_a_search"]);
});
await check("chip edit (requirements) -> re-ranked with NO AI call", async () => {
  const d = deps();
  const r = await call(handleMatchRequest, post("/api/match", { requirements: { budgetMaxInr: 1200000, usage: ["city"] } }), d);
  assert.equal(r.status, 200);
  assert.equal(d.calls.extract.length, 0);
  assert.equal(r.body.results.length, 3);
  assert.equal(d.calls.logs.length, 0, "chip edits are not logged");
});
for (const [label, fetchImpl] of [
  ["Gemini 429", async () => ({ ok: false, status: 429, text: async () => "{}" })],
  ["Gemini 503", async () => ({ ok: false, status: 503, text: async () => "{}" })],
  ["Gemini timeout", (u, init) => new Promise((_, rej) => init.signal.addEventListener("abort", () => rej(Object.assign(new Error("a"), { name: "AbortError" }))))],
])
  await check(`${label} (real hedged helper, fake network) -> 503 'busy', no fabricated results`, async () => {
    const d = deps({
      extract: (env, opts) =>
        generateJson({ GEMINI_API_KEY: "k" }, { ...opts, fetchImpl, plan: [["a", 0], ["b", 20], ["c", 40]], attemptTimeoutMs: 80, deadlineMs: 200 }),
    });
    const r = await call(handleMatchRequest, post("/api/match", { query: "automatic under 12 lakh" }), d);
    assert.deepEqual([r.status, r.body.error], [503, "ai_unavailable"]);
    assert.match(r.body.message, /busy/);
    assert.ok(!("results" in r.body) && !("requirements" in r.body), "nothing fabricated");
    assert.equal(d.calls.logs.length, 0);
  });
await check("log refused by Firestore (rule not published) -> search still succeeds", async () => {
  const d = deps({ extract: TWELVE_LAKH_AUTO, writeLog: async () => { throw new Error("PERMISSION_DENIED"); } });
  const r = await call(handleMatchRequest, post("/api/match", { query: "automatic under 12 lakh, city" }), d);
  assert.equal(r.status, 200);
  assert.equal(r.body.results.length, 1);
});
await check("the log holds exactly the eight fields, nothing personal", async () => {
  const d = deps({ extract: TWELVE_LAKH_AUTO });
  await call(handleMatchRequest, post("/api/match", { query: "automatic under 12 lakh, city" }), d);
  assert.deepEqual(Object.keys(d.calls.logs[0]).sort(), ["clickedId", "createdAt", "expireAt", "model", "query", "requirements", "resultIds", "uid"]);
  assert.equal(d.calls.logs[0].uid, "buyer-1");
});
await check("car list unavailable -> 503, no crash", async () => {
  const d = deps({ extract: TWELVE_LAKH_AUTO, listCars: async () => { throw new Error("firestore down"); } });
  assert.equal((await call(handleMatchRequest, post("/api/match", { query: "automatic under 12 lakh" }), d)).status, 503);
});
await check("unexpected failure inside the handler -> clean 500, no stack in the response", async () => {
  const d = deps();
  d.auth = async () => { throw new Error("boom " + TOKEN); };
  const r = await call(handleMatchRequest, post("/api/match", { query: "x" }), d);
  assert.deepEqual([r.status, r.body.error], [500, "server_error"]);
  assert.ok(!JSON.stringify(r.body).includes("boom"));
});

console.log("POST /api/chat (point 7)");
// A stocked car counts as "named" when its full name (brand + model) appears,
// so the word "city" in "city driving" is not mistaken for the Honda City.
const namesOf = cars.map((c) => [`${c.brandName} ${c.model}`.toLowerCase(), c.model]);
const carsNamedIn = (text) => namesOf.filter(([full]) => String(text).toLowerCase().includes(full)).map(([, model]) => model);
await check("1. recommend -> the matcher (one AI call, no second, results from rank)", async () => {
  const d = deps({ extract: TWELVE_LAKH_AUTO });
  const r = await call(handleChatRequest, post("/api/chat", { message: "an automatic under 12 lakh for the city" }), d);
  assert.deepEqual([r.status, r.body.intent], [200, "recommend"]);
  assert.equal(d.calls.extract.length, 1);
  assert.equal(d.calls.answer.length, 0, "no AI-written recommendation");
  assert.deepEqual(r.body.results.map((x) => x.title), ["Hyundai Venue"]);
  noSecrets(r.body);
});
await check("2. specific_car -> ONLY that car's record reaches Gemini", async () => {
  const d = deps({ extract: base({ intent: "specific_car", carRef: "Hyundai Venue" }), answer: "It is automatic." });
  const r = await call(handleChatRequest, post("/api/chat", { message: "Tell me about the Hyundai Venue" }), d);
  assert.deepEqual([r.status, r.body.intent, r.body.reply], [200, "specific_car", "It is automatic."]);
  assert.equal(d.calls.answer.length, 1);
  const prompt = d.calls.answer[0].user;
  assert.deepEqual(carsNamedIn(prompt), ["Venue"]);
  const record = JSON.parse(prompt.slice(prompt.indexOf("{"), prompt.lastIndexOf("}") + 1));
  assert.equal(record.car, "Hyundai Venue");
  for (const k of ["provenance", "dataReview", "id", "description", "mainImage"]) assert.ok(!(k in record), k);
});
await check("2b. asked from a car's page (carId) -> that car only, even for a vague question", async () => {
  const seltos = cars.find((c) => c.model === "Seltos");
  const d = deps({ extract: base({ intent: "general" }), answer: "Yes." });
  const r = await call(handleChatRequest, post("/api/chat", { message: "is this one good on fuel?", carId: seltos.id }), d);
  assert.equal(r.body.intent, "specific_car");
  assert.deepEqual(carsNamedIn(d.calls.answer[0].user), ["Seltos"]);
});
await check("2c. an unknown car -> says so, with no second AI call", async () => {
  const d = deps({ extract: base({ intent: "specific_car", carRef: "Tata Nexon" }) });
  const r = await call(handleChatRequest, post("/api/chat", { message: "tell me about the Tata Nexon" }), d);
  assert.match(r.body.reply, /couldn't find that car/);
  assert.equal(d.calls.answer.length, 0);
});
await check("3. general -> the general assistant, with no inventory data", async () => {
  const d = deps({ extract: base({ intent: "general" }), answer: "Every 10,000 km." });
  const r = await call(handleChatRequest, post("/api/chat", { message: "how often should I service a car?" }), d);
  assert.deepEqual([r.body.intent, r.body.reply], ["general", "Every 10,000 km."]);
  assert.equal(d.calls.answer.length, 1);
  assert.deepEqual(carsNamedIn(d.calls.answer[0].system + d.calls.answer[0].user), []);
});
await check("4. off_topic -> fixed reply, no second AI call", async () => {
  const d = deps({ extract: base({ intent: "off_topic" }) });
  const r = await call(handleChatRequest, post("/api/chat", { message: "write python code to sort a list" }), d);
  assert.deepEqual([r.body.intent, r.body.reply], ["off_topic", OFF_TOPIC_REPLY]);
  assert.equal(d.calls.extract.length, 1);
  assert.equal(d.calls.answer.length, 0);
});
await check("5. no prompt ever contains the catalogue (all intents)", async () => {
  for (const [extract, message] of [
    [TWELVE_LAKH_AUTO, "automatic under 12 lakh"], [base({ intent: "general" }), "what is a CVT?"],
    [base({ intent: "specific_car", carRef: "Honda City" }), "tell me about the Honda City"], [base({ intent: "off_topic" }), "joke please"],
  ]) {
    const d = deps({ extract });
    await call(handleChatRequest, post("/api/chat", { message }), d);
    for (const p of [...d.calls.extract, ...d.calls.answer]) assert.ok(carsNamedIn(`${p.system}\n${p.user}`).length <= 1, message);
    for (const p of d.calls.extract) assert.deepEqual(carsNamedIn(p.system), [], "extraction prompt names cars");
  }
});
await check("6. Finder and chat give identical result IDs and order for the same requirements", async () => {
  for (const reqs of [TWELVE_LAKH_AUTO, base({ budgetMaxInr: 10000000, priorities: ["fuel_economy"] }), base({ fuel: { value: "petrol", strength: "required" }, priorities: ["low_price"] }), base({ budgetMaxInr: 300000 })]) {
    const q = `${reqs.budgetMaxInr ? `under ${reqs.budgetMaxInr / 1e5} lakh` : "a car"}`;
    const f = await call(handleMatchRequest, post("/api/match", { query: q }), deps({ extract: reqs }));
    const c = await call(handleChatRequest, post("/api/chat", { message: q }), deps({ extract: reqs }));
    assert.deepEqual(c.body.results.map((x) => x.carId), f.body.results.map((x) => x.carId));
    assert.deepEqual(c.body.nearMisses.map((x) => x.carId), f.body.nearMisses.map((x) => x.carId));
  }
});
const chatApiSrc = await readFile(new URL("../server/chat/api.js", import.meta.url), "utf8");
const chatUiSrc = await readFile(new URL("../public/app/js/features/chatbot.js", import.meta.url), "utf8");
const matchApiSrc = await readFile(new URL("../server/match/api.js", import.meta.url), "utf8");
await check("7. the chatbot does not reimplement ranking (server and browser)", async () => {
  assert.ok(/import \{ matchResponse \} from "\.\.\/match\/pipeline\.js"/.test(chatApiSrc));
  assert.ok(/import \{ matchResponse \} from "\.\/pipeline\.js"/.test(matchApiSrc));
  // Code only: comments may describe the pipeline ("-> rank()") without doing it.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  for (const src of [chatApiSrc, chatUiSrc].map(code)) {
    assert.ok(!/from "[^"]*rank\.js"|from "[^"]*car-tags\.js"|\brank\(|suitability\(/.test(src), "ranking imported or called");
    assert.ok(!/\.sort\(/.test(src), "sorting cars");
  }
  assert.ok(!/loadCatalog|listCars|INVENTORY|systemInstruction|generativelanguage/.test(chatUiSrc), "browser chat builds prompts or holds the catalogue");
});
await check("the chat message limit and auth apply", async () => {
  assert.equal((await call(handleChatRequest, post("/api/chat", { message: "x" }, { auth: false }), deps())).status, 401);
  assert.equal((await call(handleChatRequest, post("/api/chat", { message: "" }), deps())).status, 400);
  assert.equal((await call(handleChatRequest, post("/api/chat", { message: "a".repeat(501) }), deps())).status, 400);
  assert.equal((await call(handleChatRequest, post("/api/chat", null, { raw: "{" }), deps())).status, 400);
});
await check("chat recommend with an ambiguous budget asks instead of ranking", async () => {
  const r = await call(handleChatRequest, post("/api/chat", { message: "car under 12" }), deps({ extract: base({ budgetMaxInr: 1200000 }) }));
  assert.equal(r.body.intent, "clarify");
  assert.match(r.body.reply, /What does "12" mean/);
});
await check("resolveCar: brand+model beats model only; two equal matches ask which", () => {
  assert.equal(resolveCar("tell me about the hyundai venue", cars).car.model, "Venue");
  assert.equal(resolveCar("what about the X1", cars).car.model, "X1");
  assert.ok(resolveCar("toyota please", cars).none);
  const two = resolveCar("compare the Fortuner and the XC90", cars);
  assert.equal(two.ambiguous.length, 2);
});

console.log("Security");
const { redact } = await import("../server/lib/http.js");
await check("redact() removes ID tokens, JWTs and API keys from anything logged", () => {
  const jwt = "eyJhbGciOiJSUzI1NiIsImtpZCI6IjEifQ.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLXZhbHVl";
  const out = redact(`bad token ${jwt} key AIzaSyDtNQMbEr_sIVNWirivrl9klcb3vpIFzZU and ${TOKEN}`);
  assert.ok(!out.includes(jwt) && !out.includes("AIzaSy") && !out.includes(TOKEN), out);
  assert.equal(redact("PERMISSION_DENIED: Missing or insufficient permissions."), "PERMISSION_DENIED: Missing or insufficient permissions.");
});
await check("no token, key or request body was ever printed during the whole run", () => {
  const all = printed.join("\n");
  assert.ok(!all.includes(TOKEN), "a Firebase ID token was logged");
  assert.ok(!/AIza|xkeysib|AQ\.[A-Za-z0-9_-]{20}/.test(all));
});

console.log(`\n${passed} checks passed. (Fakes only; no real network.)`);
