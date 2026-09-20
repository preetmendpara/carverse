// ---------------------------------------------------------------------------
// CarVerse Worker: serves the static site, plus admin media upload/serve on R2.
// Everything else falls through to the static assets in public/.
// ---------------------------------------------------------------------------

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
  return user ? { uid: user.localId, email: user.email } : null;
}

// Google validates the signature and expiry for us, so we only decide who is
// allowed in. A forged or expired token fails here, not in our own crypto.
async function adminUid(request, env) {
  const header = request.headers.get("Authorization") || "";
  const idToken = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!idToken) return null;

  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${env.FIREBASE_API_KEY}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!res.ok) return null;

  const uid = (await res.json())?.users?.[0]?.localId;
  const allowed = (env.ADMIN_UIDS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return uid && allowed.includes(uid) ? uid : null;
}

async function handleUpload(request, env) {
  if (request.method !== "POST") return bad(405, "Use POST.");
  if (!(await adminUid(request, env))) return bad(401, "Admin sign-in required.");

  const form = await request.formData();
  const file = form.get("file");
  const folder = String(form.get("folder") || "");

  if (!(file instanceof File)) return bad(400, "No file provided.");
  if (!FOLDERS.has(folder)) return bad(400, `Unknown folder "${folder}".`);
  if (file.size > MAX_BYTES) return bad(413, "File is larger than 60 MB.");
  if (!ALLOWED_TYPES.test(file.type)) return bad(415, `Unsupported file type "${file.type}".`);

  // Folder comes from the allowlist and the name is stripped, so the key can
  // never escape the prefix.
  const name = file.name.replace(/[^\w.\-]/g, "_").slice(-80);
  const key = `${folder}/${Date.now()}_${name}`;

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: { contentType: file.type, cacheControl: "public, max-age=31536000, immutable" },
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

// The Gemini key stays here as a Worker secret. When it lived in the page
// source anyone could copy it and spend the quota.
async function handleChat(request, env) {
  if (request.method !== "POST") return bad(405, "Use POST.");
  if (!env.GEMINI_API_KEY) return bad(500, "GEMINI_API_KEY is not set on the Worker.");
  if (!(await signedInUser(request, env))) return bad(401, "Sign in to use the assistant.");

  const { model, body } = await request.json().catch(() => ({}));
  if (!model || !body) return bad(400, "Missing model or body.");
  if (!/^gemini-[\w.-]+$/.test(model)) return bad(400, "Unknown model.");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );
  return new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } });
}

const escapeHtml = (s = "") =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function sendMail(env, to, subject, html, replyTo) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
}

// Two mails per enquiry: the dealer is alerted, the customer gets a receipt.
async function handleInquiry(request, env) {
  if (request.method !== "POST") return bad(405, "Use POST.");
  if (!env.RESEND_API_KEY || !env.MAIL_FROM || !env.SALES_EMAIL)
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
  await sendMail(
    env,
    env.SALES_EMAIL,
    `New enquiry: ${car} — ${name}`,
    `<h2>New car enquiry</h2><table>${row("Car", car)}${row("Name", name)}${row("Email", email)}${row("Phone", phone)}</table><p>${escapeHtml(message)}</p>`,
    email
  );
  // The customer's receipt must never fail the request: their enquiry is
  // already saved and the dealer already knows.
  try {
    await sendMail(
      env,
      email,
      "We received your enquiry — CarVerse",
      `<p>Hi ${escapeHtml(name)},</p><p>Thanks for your enquiry about <b>${escapeHtml(car)}</b>. Our team will call you within 24 hours.</p><p>Your message:</p><blockquote>${escapeHtml(message)}</blockquote><p>— CarVerse</p>`,
      env.SALES_EMAIL
    );
  } catch (err) {
    console.error("customer receipt failed", err);
  }
  return Response.json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/upload") return handleUpload(request, env);
    if (url.pathname === "/api/chat") return handleChat(request, env);
    if (url.pathname === "/api/inquiry") return handleInquiry(request, env);
    if (url.pathname.startsWith("/media/")) return serveMedia(url, env);
    return env.ASSETS.fetch(request);
  },
};
