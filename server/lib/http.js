// Small request helpers shared by /api/match and /api/chat.

export const json = (status, body) => Response.json(body, { status });
export const fail = (status, error, message) => json(status, { error, message });

/** Parses a JSON body; returns undefined (not a throw) when it is malformed. */
export async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === "object" && !Array.isArray(body) ? body : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Per-isolate, per-user limit on paid AI calls. Best effort: Workers run many
 * isolates, so it stops a single runaway client, not a determined one; every
 * request also needs a sign-in.
 */
export function rateLimiter(perHour, now = () => Date.now()) {
  const hits = new Map();
  return (uid) => {
    const t = now();
    const recent = (hits.get(uid) || []).filter((x) => t - x < 3600_000);
    recent.push(t);
    hits.set(uid, recent);
    return recent.length > perHour;
  };
}

/**
 * Removes anything token-like (ID tokens, JWTs, API keys: long unbroken runs of
 * letters, digits, "-", "_" or ".") from text before it is logged. An error
 * message can quote a token, and logs must never hold one.
 */
export const redact = (text) => String(text ?? "").replace(/[A-Za-z0-9_\-]{20,}(?:\.[A-Za-z0-9_\-]+)*/g, "[redacted]").slice(0, 300);

/** Wraps a handler so an unexpected error becomes a clean 500, never a crash or a stack trace. */
export const safely = (handler) => async (...args) => {
  try {
    return await handler(...args);
  } catch (err) {
    console.error("handler error", err?.name || "Error", redact(err?.message));
    return fail(500, "server_error", "Something went wrong. Please try again.");
  }
};
