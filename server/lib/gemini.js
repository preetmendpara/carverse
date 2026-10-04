// Shared Gemini helper for the Worker: JSON (schema-constrained) or plain text.
// The key comes from the Worker secret GEMINI_API_KEY and never leaves here.
import { redact } from "./http.js";

// Pinned versions, not "-latest" aliases, so an evaluation run today and one
// run next month use the same model.
export const LITE = "gemini-3.5-flash-lite";
export const FLASH = "gemini-3.8-flash";

// Gemini's latency is spiky: the same request measured 1.6 s and 21-40 s
// minutes apart, and FLASH returned 503 under load. So attempts are hedged:
// start one, and if it has not answered by the next start time, start another
// in parallel. The first valid answer wins; the rest are cancelled.
//   [model, start after ms]
export const HEDGE_PLAN = [
  [LITE, 0],
  [LITE, 3000],
  [FLASH, 6000],
];
const ATTEMPT_TIMEOUT_MS = 14000;
const OVERALL_DEADLINE_MS = 20000;

export class GeminiError extends Error {}

/**
 * Asks Gemini for JSON matching `schema`. Returns { data, modelVersion }.
 * `images` (optional): [{ mimeType, data }] with base64 data, sent after the
 * text in the same user turn (photo-to-listing).
 */
export const generateJson = (env, opts) => generate(env, opts);

/** Asks Gemini for a plain-text answer. Returns { data: string, modelVersion }. */
export const generateText = (env, opts) => generate(env, { ...opts, schema: null });

/**
 * One hedged request, JSON (with schema) or text (schema null).
 * Throws GeminiError with a message safe to show the buyer.
 */
async function generate(env, { system, user, images = [], schema, maxOutputTokens = 800, plan = HEDGE_PLAN, fetchImpl = fetch, attemptTimeoutMs = ATTEMPT_TIMEOUT_MS, deadlineMs = OVERALL_DEADLINE_MS }) {
  const key = String(env.GEMINI_API_KEY || "").trim();
  if (!key) throw new GeminiError("The AI service is not configured.");
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text: user }, ...images.map((i) => ({ inlineData: { mimeType: i.mimeType, data: i.data } }))] }],
    generationConfig: schema
      ? { responseMimeType: "application/json", responseSchema: schema, temperature: 0, maxOutputTokens }
      : { temperature: 0.2, maxOutputTokens },
  });

  const controllers = [];
  let settled = false;
  const failures = [];
  const timers = [];

  const attempt = (model, delay) =>
    new Promise((resolve, reject) => {
      timers.push(
        setTimeout(async () => {
          const ctl = new AbortController();
          controllers.push(ctl);
          const timer = setTimeout(() => ctl.abort(), attemptTimeoutMs);
          try {
            const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "x-goog-api-key": key },
              body,
              signal: ctl.signal,
            });
            if (!res.ok) {
              failures.push(String(res.status));
              console.error("gemini", model, res.status, redact(await res.text()));
              return reject(new Error(String(res.status)));
            }
            const json = await res.json();
            const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
            if (!schema && !text.trim()) throw Object.assign(new Error("empty"), { name: "SyntaxError" });
            resolve({ data: schema ? JSON.parse(text) : text.trim(), modelVersion: json.modelVersion || model });
          } catch (err) {
            const kind = err.name === "AbortError" ? "timeout" : err.name === "SyntaxError" ? "bad-json" : "network";
            failures.push(kind);
            // A hedge cancelled because another attempt won is not a failure worth logging.
            if (!settled) console.error("gemini", model, kind);
            reject(err);
          } finally {
            clearTimeout(timer);
          }
        }, delay)
      );
    });

  const deadline = new Promise((_, reject) =>
    timers.push(setTimeout(() => reject(Object.assign(new Error("deadline"), { deadline: true })), deadlineMs))
  );

  try {
    const winner = await Promise.race([Promise.any(plan.map(([m, d]) => attempt(m, d))), deadline]);
    settled = true;
    return winner;
  } catch {
    const busy = failures.some((f) => f === "429" || f === "503" || f === "timeout") || failures.length < plan.length;
    throw new GeminiError(busy ? "The AI service is busy right now. Please try again in a moment." : "The AI service is unavailable right now. Please try again.");
  } finally {
    settled = true;
    timers.forEach(clearTimeout); // attempts not yet started never start
    controllers.forEach((c) => c.abort()); // attempts still running are cancelled
  }
}
