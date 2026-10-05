// The car's 3D model, in one place. Pure (no DOM, no Firebase, no network),
// so the browser and the tests use the same rules.
//
// Two kinds of model:
//   Local      a GLB/glTF file uploaded to R2 (/api/upload), shown in our
//              Three.js viewer. Fields: modelUrl (/media/...), modelPath (R2 key).
//   Sketchfab  the official Sketchfab viewer, embedded. Nothing is downloaded,
//              proxied or scraped, and no Sketchfab API is called: the admin
//              pastes an embed code or a model link, and only the validated,
//              normalised embed URL is kept, never the pasted HTML.
//              Fields: modelUrl = https://sketchfab.com/models/{uid}/embed,
//              modelPath = null,
//              modelSource = { type: "sketchfab-embed", embedUrl, sourceUrl, attribution }
// Cars saved before this have only modelUrl/modelPath and keep working.

export const UID = /^[0-9a-f]{32}$/;
const HOSTS = new Set(["sketchfab.com", "www.sketchfab.com"]);
export const embedUrlFor = (uid) => `https://sketchfab.com/models/${uid}/embed`;
export const modelPageFor = (uid) => `https://sketchfab.com/3d-models/${uid}`;
const EMBED = /^https:\/\/sketchfab\.com\/models\/[0-9a-f]{32}\/embed$/;
const SKETCHFAB_PAGE = /^https:\/\/sketchfab\.com\/(3d-models|models)\/[^\s"'<>]+$/;

/** A URL object only for https://(www.)sketchfab.com with no port or credentials. */
function sketchfabUrl(input) {
  const s = String(input ?? "").trim();
  // Reject any other scheme outright, whatever the URL parser would make of it.
  if (!/^https:\/\//i.test(s)) return null;
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !HOSTS.has(url.hostname.toLowerCase()) || url.port || url.username || url.password) return null;
  return url;
}

/**
 * The model UID from a Sketchfab link:
 *   https://sketchfab.com/3d-models/{slug}-{uid}
 *   https://sketchfab.com/models/{uid}  (or .../embed)
 * Host is case-insensitive; anything else gives null.
 */
export function parseSketchfabUid(input) {
  const url = sketchfabUrl(input);
  if (!url) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts[0] === "3d-models" && parts.length === 2) {
    const m = /(?:^|-)([0-9a-f]{32})$/i.exec(parts[1]);
    return m ? m[1].toLowerCase() : null;
  }
  if (parts[0] === "models" && (parts.length === 2 || (parts.length === 3 && parts[2] === "embed")) && UID.test(parts[1].toLowerCase())) {
    return parts[1].toLowerCase();
  }
  return null;
}

const decode = (s) =>
  String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
const plain = (html, max) =>
  decode(String(html).replace(/<[^>]*>/g, " "))
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
const attr = (tag, name) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "") : null;
};

export const MAX_EMBED_CODE = 5000;
export const MAX_ATTRIBUTION = 200;

/**
 * From a pasted Sketchfab embed code. The HTML is only READ as text (never
 * parsed into a document, executed or inserted): exactly one <iframe> whose
 * src is an official Sketchfab model embed. The credit line Sketchfab adds
 * under the iframe becomes plain text. Returns
 *   { ok: true, uid, embedUrl, sourceUrl, attribution } | { ok: false, error }
 */
export function sketchfabFromEmbedCode(code) {
  const html = String(code ?? "");
  if (!html.trim()) return { ok: false, error: "Paste the Sketchfab embed code." };
  if (html.length > MAX_EMBED_CODE) return { ok: false, error: "That embed code is too long to be a Sketchfab embed." };
  const iframes = html.match(/<iframe\b[^>]*>/gi) || [];
  if (iframes.length !== 1) return { ok: false, error: "The embed code must contain exactly one Sketchfab <iframe>." };
  const src = attr(iframes[0], "src");
  const uid = parseSketchfabUid(src);
  if (!uid || !/\/models\/[0-9a-f]{32}\/embed/i.test(new URL(src).pathname)) {
    return { ok: false, error: "Only a Sketchfab model embed (https://sketchfab.com/models/…/embed) is accepted." };
  }
  // The model's own page, from Sketchfab's credit link when present.
  const links = [...html.matchAll(/<a\b[^>]*>/gi)].map((m) => attr(m[0], "href")).filter(Boolean);
  const page = links.find((h) => parseSketchfabUid(h) === uid);
  const credit = plain(html.replace(/<iframe\b[\s\S]*?(<\/iframe>|$)/gi, " "), MAX_ATTRIBUTION);
  const title = plain(attr(iframes[0], "title") || "", 120);
  return {
    ok: true,
    uid,
    embedUrl: embedUrlFor(uid),
    sourceUrl: page && SKETCHFAB_PAGE.test(page.split("?")[0]) ? page.split("?")[0] : modelPageFor(uid),
    attribution: credit || (title ? `${title} on Sketchfab` : "Model on Sketchfab"),
  };
}

/** From a pasted Sketchfab model link. Same result shape as sketchfabFromEmbedCode. */
export function sketchfabFromUrl(input, attribution = "") {
  const uid = parseSketchfabUid(input);
  if (!uid) return { ok: false, error: "Paste a Sketchfab model link, like https://sketchfab.com/3d-models/name-<id>." };
  const url = new URL(String(input).trim());
  const page = url.pathname.startsWith("/3d-models/") ? `https://sketchfab.com${url.pathname}` : modelPageFor(uid);
  return { ok: true, uid, embedUrl: embedUrlFor(uid), sourceUrl: page, attribution: plain(attribution, MAX_ATTRIBUTION) || "Model on Sketchfab" };
}

/** The modelSource stored on the car for a validated Sketchfab choice. */
export const sketchfabSource = (s) => ({
  type: "sketchfab-embed",
  embedUrl: embedUrlFor(s.uid),
  sourceUrl: SKETCHFAB_PAGE.test(s.sourceUrl || "") ? s.sourceUrl : modelPageFor(s.uid),
  attribution: plain(s.attribution || "", MAX_ATTRIBUTION) || "Model on Sketchfab",
});

/**
 * The model fields to save, given what the admin did:
 *   uploaded   { url, path }      a file uploaded through /api/upload
 *   sketchfab  a successful sketchfabFromEmbedCode / sketchfabFromUrl result
 *   remove     true               "Remove" pressed
 * Returns {} when nothing changed, so untouched cars are never rewritten. A new
 * choice replaces the old one. Only the normalised embed URL is stored.
 */
export function modelWrite({ uploaded = null, sketchfab = null, remove = false } = {}) {
  if (uploaded) return { modelUrl: uploaded.url, modelPath: uploaded.path, modelSource: null };
  if (sketchfab?.ok) {
    const src = sketchfabSource(sketchfab);
    return { modelUrl: src.embedUrl, modelPath: null, modelSource: src };
  }
  if (remove) return { modelUrl: null, modelPath: null, modelSource: null };
  return {};
}

/**
 * How the car page shows the model:
 *   { kind: "embed", url, sourceUrl, attribution }  official Sketchfab viewer
 *   { kind: "gltf", url }                            our Three.js viewer
 *   null                                             no model, or anything that
 *                                                    is not exactly a Sketchfab
 *                                                    embed URL (never iframed)
 */
export function modelView(car) {
  const url = car?.modelUrl;
  if (!url) return null;
  const src = car.modelSource;
  if (src?.type === "sketchfab-embed" || /^[a-z]+:/i.test(url)) {
    if (!EMBED.test(url)) return null;
    return {
      kind: "embed",
      url,
      sourceUrl: SKETCHFAB_PAGE.test(src?.sourceUrl || "") ? src.sourceUrl : modelPageFor(url.split("/")[4]),
      attribution: plain(src?.attribution || "", MAX_ATTRIBUTION) || "Model on Sketchfab",
    };
  }
  // A local model is always a path on this site (/media/...).
  return url.startsWith("/") && !url.startsWith("//") ? { kind: "gltf", url } : null;
}

// Sketchfab embed options, added when the viewer is drawn (the stored embedUrl
// stays canonical). Only options Sketchfab documents with no account
// limitation (sketchfab.com/developers/viewer/initialization): load the model
// straight away, never play its animations, and hide the "disable viewer"
// button. The ui_* options that hide the info bar, timeline, help, settings,
// fullscreen, VR/AR, hint and watermark are Premium-only on the model OWNER's
// account, so they are not sent; Sketchfab shows that UI and CarVerse does
// not hide it. Rotate, zoom and pan stay.
export const SKETCHFAB_VIEWER_OPTIONS = {
  autostart: 1,
  animation_autoplay: 0,
  ui_stop: 0,
};

/** The URL to iframe for a stored embed URL, or null unless it is exactly a Sketchfab model embed. */
export function sketchfabViewerUrl(embedUrl) {
  if (!EMBED.test(String(embedUrl ?? ""))) return null;
  return `${embedUrl}?${new URLSearchParams(SKETCHFAB_VIEWER_OPTIONS)}`;
}
