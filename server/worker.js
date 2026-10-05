// ---------------------------------------------------------------------------
// CarVerse Worker: serves the static site, plus admin media upload/serve on R2.
// Everything else falls through to the static assets in public/.
// ---------------------------------------------------------------------------
import { generateJson, generateText, GeminiError } from "./lib/gemini.js";
import { listPublishedCars, writeMatchLog } from "./lib/firestore.js";
import { handleMatchRequest } from "./match/api.js";
import { handleChatRequest } from "./chat/api.js";
import { handleCompareAi } from "./compare/api.js";
import { handlePhotoListing } from "./listing/api.js";

// Mirrors the folder allowlist the admin panel uploads into.
const FOLDERS = new Set([
  "brand-logos",
  "car-images",
  "car-gallery",
  "car-interior",
  "car-exterior",
  "3d-models",
  "thumbnails",
]);

const MAX_BYTES = 60 * 1024 * 1024;
const ALLOWED_TYPES = /^(image\/(jpeg|png|webp|gif|avif|svg\+xml)|model\/gltf(-binary|\+json))$/;
// Browsers usually send .glb/.gltf with an empty or generic type, so every 3D
// upload failed as "unsupported". For the 3d-models folder only, the type
// comes from the extension instead.
const MODEL_TYPES = { glb: "model/gltf-binary", gltf: "model/gltf+json" };
export function uploadType(file, folder) {
  if (folder === "3d-models" && (!file.type || file.type === "application/octet-stream")) {
    return MODEL_TYPES[String(file.name || "").split(".").pop().toLowerCase()] || file.type;
  }
  return file.type;
}

const bad = (status, message) =>
  new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

// Any signed-in customer (not just admins). Used to gate the paid AI calls
// and the enquiry mailer so neither can be driven by a stranger with curl.
async function signedInUser(request, env) {
  const header = request.headers.get("Authorization") || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return null;
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idToken }) }
  );
  if (!res.ok) return null;
  const user = (await res.json())?.users?.[0];
  return user ? { uid: user.localId, email: user.email, idToken } : null;
}

// Google validates the signature and expiry for us (signedInUser), so we only
// decide who is allowed in. A forged or expired token fails there, not in our
// own crypto. Returns { uid, email, idToken } for an admin, else null.
async function adminUser(request, env) {
  const user = await signedInUser(request, env);
  const allowed = (env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return user && allowed.includes(user.uid) ? user : null;
}

async function handleUpload(request, env) {
  if (request.method !== "POST") return bad(405, "Use POST.");
  if (!(await adminUser(request, env))) return bad(401, "Admin sign-in required.");

  const form = await request.formData();
  const file = form.get("file");
  const folder = String(form.get("folder") || "");

  if (!(file instanceof File)) return bad(400, "No file provided.");
  if (!FOLDERS.has(folder)) return bad(400, `Unknown folder "${folder}".`);
  if (file.size > MAX_BYTES) return bad(413, "File is larger than 60 MB.");
  const type = uploadType(file, folder);
  if (!ALLOWED_TYPES.test(type)) return bad(415, `Unsupported file type "${type || "unknown"}".`);

  // Folder comes from the allowlist and the name is stripped, so the key can
  // never escape the prefix.
  const name = file.name.replace(/[^\w.\-]/g, "_").slice(-80);
  const key = `${folder}/${Date.now()}_${name}`;

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" },
  });

  return Response.json({ url: `/media/${key}`, path: key });
}

async function serveMedia(url, env) {
  const key = decodeURIComponent(url.pathname.slice("/media/".length));
  if (!key) return bad(404, "Not found.");

  const object = await env.MEDIA.get(key);
  if (!object) return bad(404, "Not found.");

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function sendMail(env, to, subject, html, replyTo) {
  // Brevo verifies a single sender address by email, so enquiry mail works
  // without owning DNS. MAIL_FROM is "Name <address>" or just the address.
  const m = /^\s*(?:(.*?)\s*)?<?([^<>\s]+@[^<>\s]+)>?\s*$/.exec(env.MAIL_FROM || "");
  if (!m) throw new Error("MAIL_FROM is not a valid sender address.");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": (env.BREVO_API_KEY || "").trim(), "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: m[1] || "CarVerse", email: m[2] },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      ...(replyTo ? { replyTo: { email: replyTo } } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

// Two mails per enquiry: the dealer is alerted, the customer gets a receipt.
async function handleInquiry(request, env) {
  if (request.method !== "POST") return bad(405, "Use POST.");
  if (!env.BREVO_API_KEY || !env.MAIL_FROM || !env.SALES_EMAIL)
    return bad(500, "Email is not configured on the Worker.");
  const user = await signedInUser(request, env);
  if (!user) return bad(401, "Sign in to send an enquiry.");

  const d = await request.json().catch(() => ({}));
  const name = String(d.name || "").slice(0, 100);
  const email = String(d.email || user.email || "").slice(0, 255);
  const phone = String(d.phone || "").slice(0, 30);
  const message = String(d.message || "").slice(0, 1000);
  const car = String(d.carName || "General enquiry").slice(0, 120);
  if (!name || !email || !phone || !message) return bad(400, "Missing enquiry fields.");

  const row = (k, v) => `<tr><td><b>${k}</b></td><td>${escapeHtml(v)}</td></tr>`;
  try {
    await sendMail(
    env,
    env.SALES_EMAIL,
    `New enquiry: ${car} — ${name}`,
      `<h2>New car enquiry</h2><table>${row("Car", car)}${row("Name", name)}${row("Email", email)}${row("Phone", phone)}</table><p>${escapeHtml(message)}</p>`,
      email
    );
  } catch (err) {
    // The enquiry is already in Firestore, so a mail outage is not a failure
    // the customer should see — but it must be visible in the Worker logs.
    console.error("sales alert failed", err.message);
    return Response.json({ ok: false, customerMailed: false, error: err.message }, { status: 200 });
  }
  // The customer's receipt must never fail the request: their enquiry is
  // already saved and the dealer already knows.
  try {
    await sendMail(
      env,
      email,
      "CarVerse will contact you shortly",
      `<p>Hi ${escapeHtml(name)},</p>
       <p>Thanks for your enquiry about <b>${escapeHtml(car)}</b>. Our team will contact you shortly, within 24 hours, on ${escapeHtml(phone)}.</p>
       <p>Your message:</p><blockquote>${escapeHtml(message)}</blockquote>
       <p>You can reply to this email with anything else you want to know — price, finance or a test drive.</p>
       <p>— CarVerse</p>`,
      env.SALES_EMAIL
    );
  } catch (err) {
    console.error("customer receipt failed", err.message);
    return Response.json({ ok: true, customerMailed: false });
  }
  return Response.json({ ok: true, customerMailed: true });
}

/* ------------------------- /api/match, /api/chat ---------------------- */
// Both live in their own modules and receive their network helpers here, so
// the handlers are tested without real Gemini, Firestore or Firebase Auth.
const aiDeps = {
  auth: signedInUser,
  extract: generateJson,
  answer: generateText,
  listCars: listPublishedCars,
  writeLog: writeMatchLog,
  GeminiError,
};

// Admin-only AI tools. Same pattern: Gemini reads, plain code decides.
const adminAiDeps = {
  admin: adminUser,
  extract: generateJson,
  GeminiError,
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/upload") return handleUpload(request, env);
    if (url.pathname === "/api/chat") return handleChatRequest(request, env, aiDeps);
    if (url.pathname === "/api/match") return handleMatchRequest(request, env, aiDeps);
    if (url.pathname === "/api/compare-ai") return handleCompareAi(request, env, aiDeps);
    if (url.pathname === "/api/inquiry") return handleInquiry(request, env);
    if (url.pathname === "/api/photo-listing") return handlePhotoListing(request, env, adminAiDeps);
    if (url.pathname.startsWith("/media/")) return serveMedia(url, env);
    return env.ASSETS.fetch(request);
  },
};
