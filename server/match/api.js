// POST /api/match: the AI Car Finder.
// Gemini turns the sentence into requirements; matchResponse() (plain code,
// rank.js) does the rest. Sending `requirements` instead of `query` (a chip was
// removed) re-ranks without any AI call. Dependencies are passed in, so the
// handler is tested without real Gemini, Firestore or Firebase Auth.
import { json, fail, readJson, rateLimiter, safely } from "../lib/http.js";
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from "./extract.js";
import { matchResponse } from "./pipeline.js";
import { buildMatchLog } from "./log.js";

export const QUERY_MAX = 500;
const overLimit = rateLimiter(30);

export const NOT_A_SEARCH =
  "The Car Finder matches cars to what you need. Try something like \"an automatic under 12 lakh for city driving\".";

/**
 * deps: { auth(request, env) -> user|null, extract(env, opts), listCars(env),
 *         writeLog(env, idToken, doc), GeminiError }
 */
export const handleMatchRequest = safely(async (request, env, deps) => {
  if (request.method !== "POST") return fail(405, "method", "Use POST.");
  const user = await deps.auth(request, env);
  if (!user) return fail(401, "auth", "Sign in to use the AI Car Finder.");
  const body = await readJson(request);
  if (!body) return fail(400, "bad_json", "The request could not be read.");

  let raw;
  let query = null;
  let model = null;
  if (body.requirements && typeof body.requirements === "object" && !Array.isArray(body.requirements)) {
    raw = body.requirements; // chip edit: already confirmed, no AI call, not rate-limited as AI
  } else {
    query = typeof body.query === "string" ? body.query.trim() : "";
    if (!query) return fail(400, "empty_query", "Describe the car you are looking for.");
    if (query.length > QUERY_MAX) return fail(400, "too_long", `Please keep it under ${QUERY_MAX} characters.`);
    if (overLimit(user.uid)) return fail(429, "rate_limited", "Too many searches in the last hour. Please try again later.");
    try {
      const out = await deps.extract(env, { system: EXTRACTION_PROMPT, user: query, schema: EXTRACTION_SCHEMA });
      raw = out.data;
      model = out.modelVersion;
    } catch (err) {
      // Never fall back to guessed requirements: no AI answer means no search.
      return fail(503, "ai_unavailable", err instanceof deps.GeminiError ? err.message : "The AI service is unavailable right now. Please try again.");
    }
    if (raw?.intent !== "recommend") return fail(422, "not_a_search", NOT_A_SEARCH);
  }

  let cars;
  try {
    cars = await deps.listCars(env);
  } catch {
    return fail(503, "cars_unavailable", "The car list is unavailable right now. Please try again.");
  }

  const { status, body: out } = matchResponse({ raw, query, cars });
  // Best effort: a refused or failed log (e.g. rule not yet published) never
  // changes the buyer's response.
  if (status === 200 && query)
    await deps.writeLog(env, user.idToken, buildMatchLog({ uid: user.uid, query, requirements: out.requirements, results: out.results, model })).catch(() => false);
  return json(status, out);
});
