// The car's 3D model, in one place. Pure (no DOM, no Firebase) for tests.
//
// Stored on the car (existing fields reused, one optional field added):
//   modelUrl     the model to show: a GLB/glTF URL, or for a Sketchfab embed
//                the official embed URL https://sketchfab.com/models/{uid}/embed
//   modelPath    R2 key (upload) or R2 prefix (Sketchfab import); null for embed
//   modelSource  null for a plain upload, else Sketchfab attribution:
//                { type: "sketchfab-download" | "sketchfab-embed", uid, title,
//                  author, authorUrl, license, licenseUrl, viewerUrl, ... }
// Cars saved before this have only modelUrl/modelPath and keep working.

const EMBED = /^https:\/\/sketchfab\.com\/models\/[0-9a-f]{32}\/embed$/;
const SKETCHFAB_LINK = /^https:\/\/([a-z0-9-]+\.)*sketchfab\.com\//;
const HTTPS = /^https:\/\//;

/**
 * The model fields to save, given what the admin did in the form:
 *   uploaded   { url, path }        a file uploaded through /api/upload
 *   sketchfab  { modelUrl, modelPath, modelSource } from /api/admin/sketchfab/import
 *   remove     true                 "Remove" pressed
 * Returns {} when nothing changed, so untouched cars are never rewritten.
 * A new choice replaces the old one, including its Sketchfab attribution.
 */
export function modelWrite({ uploaded = null, sketchfab = null, remove = false } = {}) {
  if (uploaded) return { modelUrl: uploaded.url, modelPath: uploaded.path, modelSource: null };
  if (sketchfab) return { modelUrl: sketchfab.modelUrl, modelPath: sketchfab.modelPath ?? null, modelSource: sketchfab.modelSource };
  if (remove) return { modelUrl: null, modelPath: null, modelSource: null };
  return {};
}

/** The credit line for a Sketchfab model, with only safe https links. */
export function modelCredit(src) {
  if (!src || !String(src.type || "").startsWith("sketchfab")) return null;
  return {
    title: String(src.title || "3D model"),
    titleUrl: SKETCHFAB_LINK.test(src.viewerUrl || "") ? src.viewerUrl : null,
    author: String(src.author || "Unknown author"),
    authorUrl: SKETCHFAB_LINK.test(src.authorUrl || "") ? src.authorUrl : null,
    license: src.license ? String(src.license) : null,
    licenseUrl: HTTPS.test(src.licenseUrl || "") ? src.licenseUrl : null,
  };
}

/**
 * How the car page shows the model:
 *   { kind: "embed", url, credit }  official Sketchfab viewer (iframe)
 *   { kind: "gltf",  url, credit }  our Three.js viewer
 *   null                            no model, or an embed URL that is not
 *                                   exactly Sketchfab's (never iframe anything else)
 */
export function modelView(car) {
  const url = car?.modelUrl;
  if (!url) return null;
  const credit = modelCredit(car.modelSource);
  if (car.modelSource?.type === "sketchfab-embed" || /^https:\/\/sketchfab\.com\/models\//.test(url)) {
    return EMBED.test(url) ? { kind: "embed", url, credit } : null;
  }
  return { kind: "gltf", url, credit };
}
