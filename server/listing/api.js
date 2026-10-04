// POST /api/photo-listing (multipart, field "photos", 5-10 images): admin only.
// Sends the photos to Gemini (multimodal), validates the answer in plain code
// (validate.js) and returns it for the admin to review in the car form.
// Writes nothing: the admin decides what to apply and saves the car as usual.
import { json, fail, rateLimiter, safely } from "../lib/http.js";
import { FLASH, LITE } from "../lib/gemini.js";
import { LISTING_PROMPT, LISTING_SCHEMA } from "./extract.js";
import { validateListing } from "./validate.js";

export const MIN_PHOTOS = 5;
export const MAX_PHOTOS = 10;
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
// Gemini accepts about 20 MB of inline data per request; base64 adds a third.
export const MAX_TOTAL_BYTES = 14 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const overLimit = rateLimiter(30);

// Vision needs the larger model first and more time than a text extraction.
export const PHOTO_PLAN = [
  [FLASH, 0],
  [LITE, 15000],
];

function base64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** deps: { admin(request, env) -> {uid,idToken}|null, extract, GeminiError } */
export const handlePhotoListing = safely(async (request, env, deps) => {
  if (request.method !== "POST") return fail(405, "method", "Use POST.");
  const admin = await deps.admin(request, env);
  if (!admin) return fail(401, "auth", "Admin sign-in required.");
  if (overLimit(admin.uid)) return fail(429, "rate_limited", "Too many photo analyses in the last hour.");

  let form;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad_form", "Send the photos as multipart form data.");
  }
  const files = form.getAll("photos").filter((f) => f instanceof File);
  if (files.length < MIN_PHOTOS || files.length > MAX_PHOTOS) return fail(400, "photo_count", `Choose ${MIN_PHOTOS} to ${MAX_PHOTOS} photos.`);
  if (files.some((f) => !TYPES.has(f.type))) return fail(415, "photo_type", "Photos must be JPEG, PNG or WebP.");
  if (files.some((f) => f.size > MAX_PHOTO_BYTES)) return fail(413, "photo_size", "Each photo must be under 4 MB.");
  if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) return fail(413, "photos_size", "The photos are too large together. Use smaller images.");

  const images = await Promise.all(files.map(async (f) => ({ mimeType: f.type, data: base64(new Uint8Array(await f.arrayBuffer())) })));
  let out;
  try {
    out = await deps.extract(env, {
      system: LISTING_PROMPT,
      user: `There are ${files.length} photos, numbered 1 to ${files.length} in this order.`,
      images,
      schema: LISTING_SCHEMA,
      maxOutputTokens: 2500,
      plan: PHOTO_PLAN,
      attemptTimeoutMs: 45000,
      deadlineMs: 55000,
    });
  } catch (err) {
    return fail(503, "ai_unavailable", err instanceof deps.GeminiError ? err.message : "The AI service is unavailable right now.");
  }

  return json(200, {
    ...validateListing(out.data, files.length),
    model: String(out.modelVersion || "unknown"),
    analysedAt: new Date().toISOString(),
  });
});
