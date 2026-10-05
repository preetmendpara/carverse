// Sketchfab integration: pure helpers (no network). Official API only:
//   metadata  GET https://api.sketchfab.com/v3/models/{uid}
//   download  GET https://api.sketchfab.com/v3/models/{uid}/download  (token)
// Nothing here scrapes a page or fetches a URL a user typed: the only URLs the
// Worker downloads are the ones Sketchfab's Download API returns, and only
// when they pass isAllowedDownloadUrl().

export const API = "https://api.sketchfab.com/v3";
export const UID = /^[0-9a-f]{32}$/;
export const MAX_DOWNLOAD_BYTES = 60 * 1024 * 1024; // compressed / GLB size
export const MAX_UNZIPPED_BYTES = 120 * 1024 * 1024;
export const MAX_ZIP_ENTRIES = 300;
export const DOWNLOAD_TIMEOUT_MS = 60000;
export const METADATA_TIMEOUT_MS = 10000;

const SKETCHFAB_HOSTS = new Set(["sketchfab.com", "www.sketchfab.com"]);
// Hosts Sketchfab's Download API hands out for archives (signed links).
const DOWNLOAD_HOSTS = new Set(["sketchfab-prod-media.s3.amazonaws.com"]);
const isSketchfabSubdomain = (h) => h === "sketchfab.com" || h.endsWith(".sketchfab.com");

/**
 * The model UID from a Sketchfab model URL, or a bare 32-hex UID. Null for
 * anything else (another site, http, a user/collection page...).
 */
export function parseSketchfabUid(input) {
  const s = String(input ?? "").trim();
  if (UID.test(s.toLowerCase())) return s.toLowerCase();
  let url;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !SKETCHFAB_HOSTS.has(url.hostname.toLowerCase()) || url.port || url.username || url.password) return null;
  const parts = url.pathname.split("/").filter(Boolean);
  // /3d-models/{slug}-{uid}  |  /models/{uid}  |  /models/{uid}/embed
  if (parts[0] === "3d-models" && parts[1]) {
    const m = /(?:^|-)([0-9a-f]{32})$/i.exec(parts[1]);
    return m ? m[1].toLowerCase() : null;
  }
  if (parts[0] === "models" && parts[1] && UID.test(parts[1].toLowerCase())) return parts[1].toLowerCase();
  return null;
}

/** True only for an https URL on a host Sketchfab's Download API uses. */
export function isAllowedDownloadUrl(u) {
  let url;
  try {
    url = new URL(String(u));
  } catch {
    return false;
  }
  const h = url.hostname.toLowerCase();
  return url.protocol === "https:" && !url.port && !url.username && !url.password && (DOWNLOAD_HOSTS.has(h) || isSketchfabSubdomain(h));
}

const httpsSketchfab = (u) => {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" && isSketchfabSubdomain(url.hostname.toLowerCase()) ? url.href : null;
  } catch {
    return null;
  }
};
const httpsAny = (u) => {
  try {
    const url = new URL(String(u));
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
};
const text = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Sketchfab's model JSON -> the few fields CarVerse shows and stores. */
export function normalizeMetadata(m, uid) {
  const thumbs = (m?.thumbnails?.images || []).filter((i) => httpsSketchfab(i?.url)).sort((a, b) => (b.width || 0) - (a.width || 0));
  const thumb = thumbs.find((i) => (i.width || 0) <= 1024) || thumbs[thumbs.length - 1];
  const lic = m?.license || null;
  return {
    uid,
    title: text(m?.name, 120) || "Untitled model",
    author: text(m?.user?.displayName || m?.user?.username, 80) || "Unknown author",
    authorUrl: httpsSketchfab(m?.user?.profileUrl),
    thumbnail: thumb ? thumb.url : null,
    license: lic
      ? { label: text(lic.label || lic.fullName || lic.slug, 80) || "See Sketchfab", url: httpsAny(lic.url), requirements: text(lic.requirements, 300) }
      : null,
    isDownloadable: m?.isDownloadable === true,
    viewerUrl: `https://sketchfab.com/3d-models/${uid}`,
    embedUrl: `https://sketchfab.com/models/${uid}/embed`,
  };
}

/** The attribution kept on the car with any Sketchfab model. */
export const attribution = (meta) => ({
  uid: meta.uid,
  title: meta.title,
  author: meta.author,
  authorUrl: meta.authorUrl,
  license: meta.license?.label || null,
  licenseUrl: meta.license?.url || null,
  viewerUrl: meta.viewerUrl,
});

const TYPES = {
  gltf: "model/gltf+json",
  glb: "model/gltf-binary",
  bin: "application/octet-stream",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  ktx2: "image/ktx2",
};
export const contentTypeFor = (path) => TYPES[String(path).split(".").pop().toLowerCase()] || null;

/** A zip entry name safe to use inside our R2 prefix, or null. */
export function safeEntryPath(name) {
  const n = String(name);
  if (!n || n.endsWith("/") || n.startsWith("/") || n.includes("\\") || n.includes("\0")) return null;
  const parts = n.split("/");
  if (parts.some((p) => !p || p === "." || p === ".." || !/^[\w .()+-]+$/.test(p))) return null;
  return contentTypeFor(n) ? n : null;
}

async function inflateRaw(bytes, limit) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > limit) {
      await reader.cancel();
      throw new ImportError(413, "The model is too large once unpacked.");
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

export class ImportError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Reads a glTF .zip (the archive Sketchfab's Download API returns). Only
 * model files (gltf, bin, textures) with safe relative names are returned;
 * anything else is skipped. Zip64, encryption and unknown compression are
 * refused. Returns [{ path, bytes, contentType }].
 */
export async function unzipGltf(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 22 || dv.getUint32(0, true) !== 0x04034b50) throw new ImportError(422, "The download is not a zip archive.");
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ImportError(422, "The zip archive is damaged.");
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff) throw new ImportError(422, "Zip64 archives are not supported.");
  if (count > MAX_ZIP_ENTRIES) throw new ImportError(413, "The archive has too many files.");

  const files = [];
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) throw new ImportError(422, "The zip archive is damaged.");
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const compSize = dv.getUint32(p + 20, true);
    const size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    const path = safeEntryPath(name);
    if (!path) continue;
    if (flags & 1) throw new ImportError(422, "Encrypted archives are not supported.");
    total += size;
    if (total > MAX_UNZIPPED_BYTES) throw new ImportError(413, "The model is too large once unpacked.");
    if (local + 30 > u8.length || dv.getUint32(local, true) !== 0x04034b50) throw new ImportError(422, "The zip archive is damaged.");
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true);
    const raw = u8.subarray(start, start + compSize);
    if (raw.length !== compSize) throw new ImportError(422, "The zip archive is damaged.");
    let bytes;
    if (method === 0) bytes = raw.slice();
    else if (method === 8) bytes = await inflateRaw(raw, MAX_UNZIPPED_BYTES);
    else throw new ImportError(422, "The archive uses an unsupported compression method.");
    files.push({ path, bytes, contentType: contentTypeFor(path) });
  }
  return files;
}

/** The scene file to load: the .gltf closest to the archive root. */
export const sceneFile = (files) =>
  files.filter((f) => f.path.toLowerCase().endsWith(".gltf")).sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))[0] || null;

export const isGlb = (bytes) => bytes.length >= 12 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46; // "glTF"
