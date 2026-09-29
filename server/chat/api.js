// POST /api/chat: the chatbot is an interface onto the same marketplace logic.
//
//   message -> ONE Gemini extraction (intent + requirements, same schema as the Finder)
//     recommend    -> matchResponse() -> rank()      (no second AI call; the Finder's pipeline)
//     specific_car -> ONE car's effective record -> Gemini answer from that record only
//     general      -> Gemini general answer, no inventory data at all
//     off_topic    -> fixed reply, no second AI call
//
// The catalogue is never sent to Gemini. Ranking is never done here.
import { json, fail, readJson, rateLimiter, safely } from "../lib/http.js";
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from "../match/extract.js";
import { matchResponse } from "../match/pipeline.js";
import { buildMatchLog } from "../match/log.js";
import { effectiveFields } from "../../public/app/js/core/car-fields.js";

export const MESSAGE_MAX = 500;
const overLimit = rateLimiter(40);

export const OFF_TOPIC_REPLY =
  "I'm CarVerse's car assistant, so I can only help with cars: finding one that suits you, questions about a car we list, or general car-buying advice.";

const SPECIFIC_PROMPT = `You answer a buyer's question about ONE car listed on CarVerse, an Indian used-car marketplace.
Use ONLY the JSON record provided. If the record does not contain the answer, say it is not listed and suggest sending an enquiry.
A null value means "not provided": never guess it. Never compare with other cars, never claim the car is the best, safest or most reliable,
and never promise maintenance costs or condition. Prices are in Indian Rupees. Keep it short, plain text, no markdown.`;

const GENERAL_PROMPT = `You are CarVerse's car assistant for an Indian used-car marketplace. Answer general car-buying, ownership,
finance, insurance and maintenance questions briefly and factually, in plain text without markdown.
You have no access to CarVerse's listings: do not name, recommend or describe specific cars for sale; for that, suggest the Car Finder.
Do not claim any car is the best, safest or most reliable.`;

const FIELD_LABEL = {
  fuelTypes: "fuel", transmissionNorm: "transmission", fuelEconomyKmpl: "fuel economy (kmpl)", odometerKm: "kilometres driven",
  powerHp: "power (hp)", groundClearanceMm: "ground clearance (mm)", bootLitres: "boot (litres)", seats: "seats",
  bodyType: "body type", airbags: "airbags", ncapStars: "NCAP stars", colour: "colour", owners: "owners",
};
const title = (c) => [c.brandName, c.model, c.variant].filter(Boolean).join(" ");

/** The ONLY car data a specific-car answer may see: one car, effective fields, nothing internal. */
export function carRecord(car) {
  const e = effectiveFields(car);
  return {
    car: title(car),
    year: car.year ?? null,
    priceInr: Number(car.price) || null,
    availability: car.availability || null,
    ...Object.fromEntries(Object.entries(FIELD_LABEL).map(([k, label]) => [label, e[k] ?? null])),
    fuelStatus: e.fuelStatus,
    transmissionStatus: e.transmissionStatus,
    listedFeatures: (car.features || []).slice(0, 20),
  };
}

/**
 * Finds the car a message refers to, by name, in code. Returns
 * { car } | { ambiguous: [cars] } | { none: true }. Never asks the AI.
 */
export function resolveCar(text, cars) {
  const t = ` ${String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  const word = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const scored = cars
    .map((c) => {
      const model = word(c.model);
      const brand = word(c.brandName);
      if (!model || !t.includes(` ${model} `)) return null;
      return { car: c, score: brand && t.includes(` ${brand} `) ? 2 : 1 };
    })
    .filter(Boolean);
  if (!scored.length) return { none: true };
  const top = Math.max(...scored.map((s) => s.score));
  const best = scored.filter((s) => s.score === top).map((s) => s.car);
  return best.length === 1 ? { car: best[0] } : { ambiguous: best };
}

/** A short, factual lead-in for chat recommendations, from the ranking only. */
export function recommendReply(body) {
  const n = body.results.length;
  if (!n)
    return body.nearMisses.length
      ? "No car matches everything you asked for. The closest alternatives are below, with the one thing each misses."
      : "No car in stock matches everything you asked for. Try removing a requirement.";
  return `${n} car${n === 1 ? "" : "s"} match${n === 1 ? "es" : ""} what you asked for. Each shows why it matched.`;
}

/**
 * deps: { auth, extract(env, opts), answer(env, opts), listCars(env), writeLog(env, idToken, doc), GeminiError }
 */
export const handleChatRequest = safely(async (request, env, deps) => {
  if (request.method !== "POST") return fail(405, "method", "Use POST.");
  const user = await deps.auth(request, env);
  if (!user) return fail(401, "auth", "Sign in to chat with the assistant.");
  const body = await readJson(request);
  if (!body) return fail(400, "bad_json", "The request could not be read.");
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message) return fail(400, "empty_message", "Type a question first.");
  if (message.length > MESSAGE_MAX) return fail(400, "too_long", `Please keep it under ${MESSAGE_MAX} characters.`);
  if (overLimit(user.uid)) return fail(429, "rate_limited", "Too many messages in the last hour. Please try again later.");

  let raw;
  let model;
  try {
    const out = await deps.extract(env, { system: EXTRACTION_PROMPT, user: message, schema: EXTRACTION_SCHEMA });
    raw = out.data;
    model = out.modelVersion;
  } catch (err) {
    return fail(503, "ai_unavailable", err instanceof deps.GeminiError ? err.message : "The assistant is unavailable right now. Please try again.");
  }
  let intent = raw?.intent;
  // Asked from a car's own page: a question about "this car" is about that car.
  const pageCarId = typeof body.carId === "string" ? body.carId : null;
  if (pageCarId && (intent === "general" || intent === "specific_car")) intent = "specific_car";

  if (intent === "off_topic") return json(200, { intent, reply: OFF_TOPIC_REPLY });

  if (intent === "general") {
    try {
      const out = await deps.answer(env, { system: GENERAL_PROMPT, user: message, maxOutputTokens: 400 });
      return json(200, { intent, reply: out.data });
    } catch (err) {
      return fail(503, "ai_unavailable", err instanceof deps.GeminiError ? err.message : "The assistant is unavailable right now. Please try again.");
    }
  }

  let cars;
  try {
    cars = await deps.listCars(env);
  } catch {
    return fail(503, "cars_unavailable", "The car list is unavailable right now. Please try again.");
  }

  if (intent === "specific_car") {
    const found = pageCarId ? { car: cars.find((c) => c.id === pageCarId) } : resolveCar(`${raw?.carRef || ""} ${message}`, cars);
    if (found.ambiguous) return json(200, { intent, reply: `Which one do you mean: ${found.ambiguous.map(title).join(", ")}?` });
    if (!found.car) return json(200, { intent, reply: "I couldn't find that car in CarVerse's current listings. Browse the Cars page to see what's in stock." });
    try {
      const out = await deps.answer(env, {
        system: SPECIFIC_PROMPT,
        user: `Car record (JSON):\n${JSON.stringify(carRecord(found.car))}\n\nBuyer's question: ${message}`,
        maxOutputTokens: 400,
      });
      return json(200, { intent, carId: found.car.id, reply: out.data });
    } catch (err) {
      return fail(503, "ai_unavailable", err instanceof deps.GeminiError ? err.message : "The assistant is unavailable right now. Please try again.");
    }
  }

  // recommend: exactly the Car Finder's pipeline. No second AI call, no ranking here.
  const { status, body: out } = matchResponse({ raw, query: message, cars });
  if (status !== 200) return json(200, { intent: "clarify", reply: out.message, understood: out.understood || [] });
  await deps.writeLog(env, user.idToken, buildMatchLog({ uid: user.uid, query: message, requirements: out.requirements, results: out.results, model })).catch(() => false);
  return json(200, { intent: "recommend", reply: recommendReply(out), ...out });
});
