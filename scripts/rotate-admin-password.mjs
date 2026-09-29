#!/usr/bin/env node
// One-time password rotation for the existing Firebase admin account.
//
//   node scripts/rotate-admin-password.mjs
//
// Run it in an interactive terminal (PowerShell, cmd, Windows Terminal). It
// refuses piped input so a password can never come from a file or history.
//
// What it does, and nothing else:
//   1. asks for the current password, the new one and a confirmation, all
//      hidden (nothing is echoed, printed, logged or written to disk)
//   2. checks the new password and confirmation match, before any request
//   3. signs in to Firebase Authentication as admin@carverse.local
//   4. stops unless the signed-in UID is the expected admin UID
//   5. sets the new password through Firebase's authenticated account update
//   6. signs in once more with the new password to prove it took
//
// It never touches Firestore, the UID, ADMIN_UIDS or the account itself. The
// passwords are sent only to identitytoolkit.googleapis.com (Firebase Auth).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readHidden } from "./migrate-phase0.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const ADMIN_EMAIL = "admin@carverse.local";
export const EXPECTED_UID = "U95gwk62Ale4kPfCNSAlUQ7TQcq2";
export const MIN_LENGTH = 12;
const AUTH = "https://identitytoolkit.googleapis.com/v1";

// Control and zero-width characters. In a new password they would lock you
// out (you could never type them again); Ctrl+V at a PowerShell prompt types
// U+0016 instead of pasting.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f​-‍⁠﻿]/;

const MESSAGES = {
  INVALID_LOGIN_CREDENTIALS: "The current password is wrong. Nothing was changed.",
  INVALID_PASSWORD: "The current password is wrong. Nothing was changed.",
  EMAIL_NOT_FOUND: "The admin account was not found. Nothing was changed.",
  USER_DISABLED: "The admin account is disabled in Firebase Authentication. Nothing was changed.",
  TOO_MANY_ATTEMPTS_TRY_LATER: "Firebase has blocked sign-in for a while after too many attempts. Wait a few minutes. Nothing was changed.",
  WEAK_PASSWORD: "Firebase rejected the new password as too weak. The old password still works.",
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: "Firebase wants a fresh sign-in. Run the script again. The old password still works.",
  TOKEN_EXPIRED: "The sign-in expired before the update. Run the script again. The old password still works.",
};
const explain = (code, fallback) => MESSAGES[code] || fallback;

/** Pure: why a new password is not acceptable, or null if it is. */
export function newPasswordProblem(current, next, confirm) {
  if (next !== confirm) return "The new password and the confirmation do not match. Nothing was changed.";
  if (next.length < MIN_LENGTH) return `The new password must be at least ${MIN_LENGTH} characters. Nothing was changed.`;
  if (INVISIBLE.test(next))
    return "The new password contains an invisible control character (Ctrl+V does not paste at this prompt; use right-click or type it). Nothing was changed.";
  if (next === current) return "The new password is the same as the current one. Nothing was changed.";
  return null;
}

async function firebaseApiKey() {
  const src = await readFile(path.join(ROOT, "public/app/js/config/config.js"), "utf8");
  const apiKey = src.match(/apiKey:\s*"([^"]+)"/)?.[1];
  const projectId = src.match(/projectId:\s*"([^"]+)"/)?.[1];
  const admins = [...(src.match(/ADMIN_UIDS\s*=\s*\[([^\]]*)\]/)?.[1] || "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  if (!apiKey) throw new Error("Could not read the Firebase apiKey from public/app/js/config/config.js.");
  return { apiKey, projectId, admins };
}

/** POSTs to Firebase Auth; returns the JSON body or throws with Firebase's error code. */
async function authCall(fetchImpl, apiKey, endpoint, body) {
  let res, json;
  try {
    res = await fetchImpl(`${AUTH}/${endpoint}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    json = await res.json();
  } catch (err) {
    throw Object.assign(new Error(`Could not reach Firebase Authentication (${err.message}).`), { code: "NETWORK" });
  }
  if (!res.ok) {
    // Firebase codes look like "WEAK_PASSWORD : Password should be at least 6 characters"
    const code = String(json?.error?.message || res.status).split(" ")[0];
    throw Object.assign(new Error(code), { code });
  }
  return json;
}

/**
 * The rotation itself, with its inputs passed in so it can be tested without
 * a terminal or a network. Returns { ok, message }. Never includes a password
 * in the message.
 */
export async function rotate({ apiKey, admins, ask, fetchImpl = fetch, log = console.log }) {
  const current = await ask("Current admin password (hidden): ");
  const next = await ask("New password (hidden): ");
  const confirm = await ask("Confirm new password (hidden): ");

  const problem = newPasswordProblem(current, next, confirm);
  if (problem) return { ok: false, message: problem };

  // 1. Sign in with the current password.
  let session;
  try {
    session = await authCall(fetchImpl, apiKey, "accounts:signInWithPassword", {
      email: ADMIN_EMAIL,
      password: current,
      returnSecureToken: true,
    });
  } catch (err) {
    return { ok: false, message: `Sign-in failed (${err.code}). ${explain(err.code, "Nothing was changed.")}` };
  }
  log(`  Signed in as ${ADMIN_EMAIL}.`);

  // 2. Make sure this is the admin account the site trusts, before changing it.
  if (session.localId !== EXPECTED_UID || !admins.includes(session.localId))
    return {
      ok: false,
      message:
        `Signed-in UID ${session.localId} is not the expected admin UID ${EXPECTED_UID}` +
        `${admins.includes(session.localId) ? "" : " (and it is not in ADMIN_UIDS)"}. Nothing was changed.`,
    };
  log(`  UID matches the admin UID (${EXPECTED_UID}).`);

  // 3. Authenticated password update (what the SDK's updatePassword() calls).
  try {
    await authCall(fetchImpl, apiKey, "accounts:update", {
      idToken: session.idToken,
      password: next,
      returnSecureToken: false,
    });
  } catch (err) {
    return { ok: false, message: `Password update failed (${err.code}). ${explain(err.code, "The old password still works.")}` };
  }
  log("  Password updated.");

  // 4. Prove the new password works and still reaches the same account.
  try {
    const check = await authCall(fetchImpl, apiKey, "accounts:signInWithPassword", {
      email: ADMIN_EMAIL,
      password: next,
      returnSecureToken: true,
    });
    if (check.localId !== EXPECTED_UID)
      return { ok: false, message: `The new password signed in to UID ${check.localId}, not ${EXPECTED_UID}. Check Firebase Authentication.` };
  } catch (err) {
    return {
      ok: false,
      message: `The update was accepted, but signing in with the new password failed (${err.code}). Try logging in to the admin page with the new password before anything else.`,
    };
  }
  return {
    ok: true,
    message:
      "SUCCESS: the admin password was changed and the new one signs in to the admin UID.\n" +
      "Firebase ends existing sessions after a password change, so anyone signed in with the old password is signed out.",
  };
}

async function main() {
  if (!process.stdin.isTTY) {
    console.error("Run this in an interactive terminal. It does not accept piped input. Nothing was changed.");
    process.exitCode = 1;
    return;
  }
  const { apiKey, projectId, admins } = await firebaseApiKey();
  console.log(`Firebase project: ${projectId}\nAccount: ${ADMIN_EMAIL} (expected UID ${EXPECTED_UID})\n`);
  const ask = (prompt) => readHidden(process.stdin, process.stdout, prompt);
  const result = await rotate({ apiKey, admins, ask });
  (result.ok ? console.log : console.error)(`\n${result.message}`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // err.message never contains a password: authCall only ever puts Firebase's
    // error code or a network error in it.
    console.error(`Failed: ${err.message}. Nothing further was attempted.`);
    process.exitCode = 1;
  });
}
