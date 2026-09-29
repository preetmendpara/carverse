#!/usr/bin/env node
// Tests for rotate-admin-password.mjs. Firebase is simulated; the real network
// is disabled for the whole run, so nothing here can change a password.
//   node scripts/test-rotate.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.fetch = () => {
  throw new Error("real network used in a test");
};
const { rotate, newPasswordProblem, EXPECTED_UID, ADMIN_EMAIL, MIN_LENGTH } = await import("./rotate-admin-password.mjs");

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const CUR = "current-Password-1";
const NEW = "brand-new-Password-2";

/** Fake Firebase Auth. Records calls; replies from a script of responses. */
function fakeFirebase({ uid = EXPECTED_UID, failSignIn, failUpdate, newWorks = true } = {}) {
  const calls = [];
  let password = CUR;
  const reply = (ok, body) => ({ ok, json: async () => body });
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ endpoint: url.split("/v1/")[1].split("?")[0], host: new URL(url).host, body });
    if (url.includes("signInWithPassword")) {
      if (failSignIn) return reply(false, { error: { message: failSignIn } });
      if (body.email !== ADMIN_EMAIL || body.password !== password || (!newWorks && password === NEW))
        return reply(false, { error: { message: "INVALID_LOGIN_CREDENTIALS" } });
      return reply(true, { idToken: "id-token", localId: uid });
    }
    if (url.includes("accounts:update")) {
      if (failUpdate) return reply(false, { error: { message: failUpdate } });
      password = body.password;
      return reply(true, {});
    }
    throw new Error(`unexpected endpoint ${url}`);
  };
  return { fetchImpl, calls };
}
const answers = (...a) => {
  const q = [...a];
  return async () => q.shift();
};
const run = (fb, ...a) => {
  const logs = [];
  return rotate({ apiKey: "k", admins: [EXPECTED_UID], ask: answers(...a), fetchImpl: fb.fetchImpl, log: (m) => logs.push(m) }).then((r) => ({ ...r, logs }));
};
const noSecret = (r) => {
  const text = [r.message, ...r.logs].join("\n");
  assert.ok(!text.includes(CUR) && !text.includes(NEW), `a password appeared in output: ${text}`);
};

await check("success: sign in, check UID, update, re-sign-in with the new password", async () => {
  const fb = fakeFirebase();
  const r = await run(fb, CUR, NEW, NEW);
  assert.equal(r.ok, true, r.message);
  assert.deepEqual(fb.calls.map((c) => c.endpoint), ["accounts:signInWithPassword", "accounts:update", "accounts:signInWithPassword"]);
  assert.equal(fb.calls[1].body.idToken, "id-token");
  assert.equal(fb.calls[1].body.password, NEW);
  noSecret(r);
});
await check("passwords are sent only to Firebase Authentication", async () => {
  const fb = fakeFirebase();
  await run(fb, CUR, NEW, NEW);
  assert.ok(fb.calls.every((c) => c.host === "identitytoolkit.googleapis.com"));
});
await check("signs in to the admin email, not anything typed", async () => {
  const fb = fakeFirebase();
  await run(fb, CUR, NEW, NEW);
  assert.ok(fb.calls.filter((c) => c.endpoint.includes("signIn")).every((c) => c.body.email === ADMIN_EMAIL));
});
await check("mismatched confirmation: no request is made at all", async () => {
  const fb = fakeFirebase();
  const r = await run(fb, CUR, NEW, NEW + "x");
  assert.equal(r.ok, false);
  assert.match(r.message, /do not match/);
  assert.equal(fb.calls.length, 0);
  noSecret(r);
});
await check(`new password shorter than ${MIN_LENGTH}: no request`, async () => {
  const fb = fakeFirebase();
  const r = await run(fb, CUR, "short-1", "short-1");
  assert.equal(r.ok, false);
  assert.equal(fb.calls.length, 0);
});
await check("new password with a Ctrl+V control character: refused, no request", async () => {
  const fb = fakeFirebase();
  const bad = "\u0016" + NEW;
  const r = await run(fb, CUR, bad, bad);
  assert.equal(r.ok, false);
  assert.match(r.message, /invisible control character/);
  assert.equal(fb.calls.length, 0);
});
await check("new password same as current: refused, no request", async () => {
  const fb = fakeFirebase();
  const r = await run(fb, CUR, CUR, CUR);
  assert.equal(r.ok, false);
  assert.equal(fb.calls.length, 0);
});
await check("wrong current password: stops after sign-in, no update", async () => {
  const fb = fakeFirebase();
  const r = await run(fb, "wrong-password-xyz", NEW, NEW);
  assert.equal(r.ok, false);
  assert.match(r.message, /INVALID_LOGIN_CREDENTIALS/);
  assert.ok(!fb.calls.some((c) => c.endpoint === "accounts:update"));
  noSecret(r);
});
await check("a different UID: stops before the update", async () => {
  const fb = fakeFirebase({ uid: "someone-else" });
  const r = await run(fb, CUR, NEW, NEW);
  assert.equal(r.ok, false);
  assert.match(r.message, /not the expected admin UID/);
  assert.ok(!fb.calls.some((c) => c.endpoint === "accounts:update"));
});
await check("UID missing from ADMIN_UIDS: stops before the update", async () => {
  const fb = fakeFirebase();
  const r = await rotate({ apiKey: "k", admins: [], ask: answers(CUR, NEW, NEW), fetchImpl: fb.fetchImpl, log: () => {} });
  assert.equal(r.ok, false);
  assert.ok(!fb.calls.some((c) => c.endpoint === "accounts:update"));
});
for (const code of ["USER_DISABLED", "TOO_MANY_ATTEMPTS_TRY_LATER"])
  await check(`sign-in ${code}: clear message, no update`, async () => {
    const fb = fakeFirebase({ failSignIn: code });
    const r = await run(fb, CUR, NEW, NEW);
    assert.equal(r.ok, false);
    assert.ok(r.message.includes(code));
    assert.ok(!fb.calls.some((c) => c.endpoint === "accounts:update"));
  });
await check("update rejected (WEAK_PASSWORD): says the old password still works", async () => {
  const fb = fakeFirebase({ failUpdate: "WEAK_PASSWORD : Password should be at least 6 characters" });
  const r = await run(fb, CUR, NEW, NEW);
  assert.equal(r.ok, false);
  assert.match(r.message, /WEAK_PASSWORD.*old password still works/);
  noSecret(r);
});
await check("update accepted but new password fails to sign in: reported, not called success", async () => {
  const fb = fakeFirebase({ newWorks: false });
  const r = await run(fb, CUR, NEW, NEW);
  assert.equal(r.ok, false);
  assert.match(r.message, /update was accepted/);
});
await check("newPasswordProblem accepts a good password", () => {
  assert.equal(newPasswordProblem(CUR, NEW, NEW), null);
});

const src = await readFile(new URL("./rotate-admin-password.mjs", import.meta.url), "utf8");
await check("script source: no Firestore, no file writes, no env, no password in logs", () => {
  assert.ok(!/firestore\.googleapis|writeFile|appendFile|process\.env/.test(src));
  assert.ok(!/log\([^)]*\b(current|next|confirm)\b/.test(src), "a password variable is logged");
  assert.ok(/process\.stdin\.isTTY/.test(src), "piped input is not refused");
});

console.log(`\n${passed} checks passed. (Firebase simulated; no network used.)`);
