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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/upload") return handleUpload(request, env);
    if (url.pathname.startsWith("/media/")) return serveMedia(url, env);
    return env.ASSETS.fetch(request);
  },
};
