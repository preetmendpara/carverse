// Admin-only Sketchfab endpoints. They never write the car: they return the
// values for the admin form, which saves them with the car as usual.
//
// POST /api/admin/sketchfab/preview { url }
//   -> metadata for the review card (title, author, thumbnail, license,
//      downloadable, and whether this server can download it)
// POST /api/admin/sketchfab/import  { url, mode: "download" | "embed" }
//   download: only when Sketchfab says the model is downloadable. The archive
//             comes from the official Download API (token held server-side),
//             is checked, and is stored in R2 under 3d-models/sketchfab/.
//   embed:    no download at all; the official Sketchfab viewer URL is used.
// The metadata is always fetched again here; nothing the browser sends about
// the model is trusted except the URL/UID, which must parse as Sketchfab's.
import { json, fail, readJson, rateLimiter, safely, redact } from "../lib/http.js";
import {
  API,
  parseSketchfabUid,
  normalizeMetadata,
  attribution,
  isAllowedDownloadUrl,
  unzipGltf,
  sceneFile,
  isGlb,
  ImportError,
  MAX_DOWNLOAD_BYTES,
  DOWNLOAD_TIMEOUT_MS,
  METADATA_TIMEOUT_MS,
} from "./sketchfab.js";

const overLimit = rateLimiter(60);

async function metadata(env, deps, uid) {
  let res;
  try {
    res = await deps.fetch(`${API}/models/${uid}`, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(METADATA_TIMEOUT_MS) });
  } catch {
    throw new ImportError(502, "Sketchfab could not be reached. Try again.");
  }
  if (res.status === 404) throw new ImportError(404, "Sketchfab has no public model with that address.");
  if (!res.ok) throw new ImportError(502, `Sketchfab returned an error (${res.status}).`);
  const body = await res.json().catch(() => null);
  if (!body || typeof body !== "object") throw new ImportError(502, "Sketchfab sent an unreadable answer.");
  return normalizeMetadata(body, uid);
}

/** Reads a response body, aborting as soon as it passes `limit` bytes. */
async function readLimited(res, limit) {
  const declared = Number(res.headers.get("content-length"));
  if (declared > limit) throw new ImportError(413, "The model file is too large to import.");
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ImportError(413, "The model file is too large to import.");
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function download(env, deps, meta) {
  const token = String(env.SKETCHFAB_API_TOKEN || "").trim();
  if (!token) throw new ImportError(503, "Sketchfab downloads are not configured on the server. Use the Sketchfab embed instead.");
  let res;
  try {
    res = await deps.fetch(`${API}/models/${meta.uid}/download`, {
      headers: { Authorization: `Token ${token}`, Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
  } catch {
    throw new ImportError(502, "Sketchfab could not be reached. Try again.");
  }
  if (res.status === 401 || res.status === 403) throw new ImportError(403, "Sketchfab did not authorise this download. Use the Sketchfab embed instead.");
  if (!res.ok) throw new ImportError(502, `Sketchfab's Download API returned an error (${res.status}).`);
  const links = await res.json().catch(() => ({}));
  // A single GLB is preferred; otherwise the official glTF archive.
  const pick = links?.glb?.url ? { format: "glb", ...links.glb } : links?.gltf?.url ? { format: "gltf", ...links.gltf } : null;
  if (!pick) throw new ImportError(422, "Sketchfab offered no glTF download for this model. Use the Sketchfab embed instead.");
  if (!isAllowedDownloadUrl(pick.url)) throw new ImportError(502, "Sketchfab returned an unexpected download address, so it was not used.");
  if (Number(pick.size) > MAX_DOWNLOAD_BYTES) throw new ImportError(413, "The model file is too large to import.");

  let file;
  try {
    // redirect "error": a signed link must answer directly, never send us elsewhere.
    file = await deps.fetch(pick.url, { redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch (err) {
    throw new ImportError(err?.name === "TimeoutError" ? 504 : 502, err?.name === "TimeoutError" ? "The download took too long." : "The model could not be downloaded.");
  }
  if (!file.ok) throw new ImportError(502, `The model download failed (${file.status}).`);
  const bytes = await readLimited(file, MAX_DOWNLOAD_BYTES);

  const bucket = deps.bucket(env);
  const prefix = `3d-models/sketchfab/${meta.uid}/${deps.now()}`;
  const put = (key, body, contentType) =>
    bucket.put(key, body, { httpMetadata: { contentType, cacheControl: "public, max-age=31536000, immutable" } });

  if (pick.format === "glb") {
    if (!isGlb(bytes)) throw new ImportError(422, "The download is not a valid GLB file.");
    await put(`${prefix}/model.glb`, bytes, "model/gltf-binary");
    return { modelUrl: `/media/${prefix}/model.glb`, modelPath: prefix, format: "glb", files: 1 };
  }
  const files = await unzipGltf(bytes);
  const scene = sceneFile(files);
  if (!scene) throw new ImportError(422, "The archive has no glTF scene file.");
  for (const f of files) await put(`${prefix}/${f.path}`, f.bytes, f.contentType);
  return { modelUrl: `/media/${prefix}/${scene.path}`, modelPath: prefix, format: "gltf", files: files.length };
}

const guard = (handler) =>
  safely(async (request, env, deps) => {
    if (request.method !== "POST") return fail(405, "method", "Use POST.");
    const admin = await deps.admin(request, env);
    if (!admin) return fail(401, "auth", "Admin sign-in required.");
    if (overLimit(admin.uid)) return fail(429, "rate_limited", "Too many Sketchfab requests in the last hour.");
    const body = await readJson(request);
    const uid = parseSketchfabUid(body?.url);
    if (!uid) return fail(400, "bad_url", "Paste a Sketchfab model link, like https://sketchfab.com/3d-models/name-<id>.");
    try {
      return await handler({ env, deps, body, uid });
    } catch (err) {
      if (err instanceof ImportError) return fail(err.status, "sketchfab", err.message);
      console.error("sketchfab", redact(err?.message));
      throw err;
    }
  });

/** deps: { admin(request, env), fetch, bucket(env) -> R2 bucket, now() -> number } */
export const handleSketchfabPreview = guard(async ({ env, deps, uid }) => {
  const meta = await metadata(env, deps, uid);
  return json(200, { ...meta, canDownload: meta.isDownloadable && Boolean(String(env.SKETCHFAB_API_TOKEN || "").trim()) });
});

export const handleSketchfabImport = guard(async ({ env, deps, body, uid }) => {
  const mode = body?.mode === "download" ? "download" : body?.mode === "embed" ? "embed" : null;
  if (!mode) return fail(400, "bad_mode", 'Choose "download" or "embed".');
  const meta = await metadata(env, deps, uid);
  const importedAt = new Date(deps.now()).toISOString();

  if (mode === "embed") {
    return json(200, {
      modelUrl: meta.embedUrl,
      modelPath: null,
      modelSource: { type: "sketchfab-embed", ...attribution(meta), embedUrl: meta.embedUrl, importedAt },
    });
  }
  // Never try to get around Sketchfab's own download setting.
  if (!meta.isDownloadable) return fail(409, "not_downloadable", "This model is not downloadable on Sketchfab. Use the Sketchfab embed instead.");
  const out = await download(env, deps, meta);
  return json(200, {
    modelUrl: out.modelUrl,
    modelPath: out.modelPath,
    modelSource: { type: "sketchfab-download", ...attribution(meta), format: out.format, files: out.files, importedAt },
  });
});
