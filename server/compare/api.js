// POST /api/compare-ai { carIds: [2-4 ids], question }: signed-in users.
// The car facts come from the catalogue on the server (never from the browser),
// are built in code (context.js), and only the selected cars are sent to
// Gemini. Gemini explains which car fits the question, citing fact ids; the
// answer is checked in code before it is returned. Nothing is written.
import { json, fail, readJson, rateLimiter, safely } from "../lib/http.js";
import { buildCompareContext, validateComparison, VERDICTS, DISCLAIMER, NOT_PROVIDED } from "./context.js";

export const QUESTION_MAX = 300;
const overLimit = rateLimiter(30);
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REFS = ["A", "B", "C", "D"];

export const OFF_TOPIC =
  "Ask how these cars compare for your needs, for example \"Which is better for city driving?\" or \"Which gives better value?\".";

export const COMPARE_SCHEMA = {
  type: "OBJECT",
  properties: {
    relevant: { type: "BOOLEAN" },
    winner: { type: "STRING", nullable: true, enum: REFS },
    winnerReason: { type: "STRING", nullable: true },
    noWinnerReason: { type: "STRING", nullable: true },
    summary: { type: "STRING" },
    assessments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          ref: { type: "STRING", enum: REFS },
          verdict: { type: "STRING", enum: VERDICTS },
          reasoning: { type: "STRING" },
          evidence: { type: "ARRAY", items: { type: "STRING" } },
        },
        required: ["ref", "verdict", "reasoning", "evidence"],
      },
    },
    evidence: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["relevant", "winner", "winnerReason", "noWinnerReason", "summary", "assessments", "evidence"],
};

export const COMPARE_PROMPT = `You help a used-car buyer compare the cars they shortlisted on CarVerse for THEIR question.

You get the buyer's question and, for each car (A, B, C, D), a list of listing facts, each with an id such as "A.price", plus the facts that are missing from that listing.

Rules:
- Use ONLY the facts given. Never use outside knowledge about these models (no typical mileage, reliability, safety, comfort or resale claims).
- Cite the fact ids that support every judgement: "evidence" in each assessment lists that car's fact ids; the top-level "evidence" lists the ids the summary relies on.
- If a fact that matters for the question is missing, say "${NOT_PROVIDED}" for that point. Do not guess it.
- verdict per car: best_fit, good_fit, partial_fit, poor_fit, or insufficient_data when the listing lacks what the question needs.
- winner: the ref of ONE car only if the facts clearly favour it for this question; otherwise null and explain why in noWinnerReason (e.g. a close trade-off, or missing data). Do not force a winner.
- Phrase suitability as a recommendation from the listing data ("based on the listing, B suits this better because..."), not as a fact.
- relevant: false if the question is not about choosing between these cars; then keep the other fields short.
- summary: 2-4 plain sentences. No marketing language. Never mention a car that is not in the list.`;

/** deps: { auth(request, env) -> user|null, extract, listCars, GeminiError } */
export const handleCompareAi = safely(async (request, env, deps) => {
  if (request.method !== "POST") return fail(405, "method", "Use POST.");
  const user = await deps.auth(request, env);
  if (!user) return fail(401, "auth", "Sign in to use AI Compare.");
  const body = await readJson(request);
  if (!body) return fail(400, "bad_json", "The request could not be read.");

  const ids = Array.isArray(body.carIds) ? [...new Set(body.carIds.filter((id) => typeof id === "string" && ID.test(id)))] : [];
  if (ids.length < 2 || ids.length > 4) return fail(400, "car_count", "Select 2 to 4 cars to compare.");
  const question = typeof body.question === "string" ? body.question.replace(/\s+/g, " ").trim() : "";
  if (!question) return fail(400, "empty_question", "Ask a question about these cars.");
  if (question.length > QUESTION_MAX) return fail(400, "too_long", `Please keep it under ${QUESTION_MAX} characters.`);
  if (overLimit(user.uid)) return fail(429, "rate_limited", "Too many comparisons in the last hour. Please try again later.");

  let catalogue;
  try {
    catalogue = await deps.listCars(env);
  } catch {
    return fail(503, "cars_unavailable", "The car list is unavailable right now. Please try again.");
  }
  // Order follows the buyer's selection; facts come from the catalogue, not the request.
  const cars = ids.map((id) => catalogue.find((c) => c.id === id));
  if (cars.some((c) => !c)) return fail(404, "car_unavailable", "One of these cars is no longer listed. Remove it and try again.");

  const ctx = buildCompareContext(cars);
  const facts = ctx.cars
    .map((c) => `Car ${c.ref}: ${c.title}\n${c.facts.map((f) => `  ${f.id}: ${f.label} = ${f.text}`).join("\n")}\n  Missing from the listing: ${c.missing.join(", ") || "none"}`)
    .join("\n\n");

  let out;
  try {
    out = await deps.extract(env, { system: COMPARE_PROMPT, user: `Buyer's question: ${question}\n\n${facts}`, schema: COMPARE_SCHEMA, maxOutputTokens: 1500 });
  } catch (err) {
    return fail(503, "ai_unavailable", err instanceof deps.GeminiError ? err.message : "The AI service is unavailable right now. Please try again.");
  }

  const result = validateComparison(out.data, ctx);
  if (!result.relevant) return fail(422, "not_a_comparison", OFF_TOPIC);
  return json(200, {
    question,
    winner: result.winner,
    winnerReason: result.winnerReason,
    summary: result.summary,
    assessments: result.assessments,
    evidence: result.evidence,
    missingData: ctx.cars.map((c) => ({ ref: c.ref, carId: c.carId, car: c.title, missing: c.missing })),
    keyDifferences: ctx.keyDifferences,
    disclaimer: DISCLAIMER,
    model: String(out.modelVersion || "unknown"),
  });
});
