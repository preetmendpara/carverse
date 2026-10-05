#!/usr/bin/env node
// Sketchfab 3D model import: UID parsing, admin-only routes, metadata,
// download vs embed, SSRF/size/type limits, R2 storage, the car fields the
// admin form saves, and that no secret reaches the browser. Fake network and
// fake R2 only; nothing real is called.
//   node scripts/test-sketchfab.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import {
  parseSketchfabUid,
  isAllowedDownloadUrl,
  normalizeMetadata,
  unzipGltf,
  safeEntryPath,
  sceneFile,
  MAX_DOWNLOAD_BYTES,
} from "../server/sketchfab/sketchfab.js";
import { handleSketchfabPreview, handleSketchfabImport } from "../server/sketchfab/api.js";
import { modelWrite, modelView } from "../public/app/js/core/model-source.js";
import { uploadType } from "../server/worker.js";

globalThis.fetch = () => {
  throw new Error("real network used in a test");
};
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const UID = "0123456789abcdef0123456789abcdef";
const PAGE = `https://sketchfab.com/3d-models/red-sports-car-${UID}`;
const TOKEN = "sketchfab-test-token-SECRET";
const S3 = "https://sketchfab-prod-media.s3.amazonaws.com/archives/x.zip?sig=1";

/* ------------------------------ zip builder ---------------------------- */
const enc = new TextEncoder();
async function deflateRaw(bytes) {
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer();
  return new Uint8Array(out);
}
async function zip(entries, { deflate = true } = {}) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const data = typeof content === "string" ? enc.encode(content) : content;
    const comp = deflate ? await deflateRaw(data) : data;
    const n = enc.encode(name);
    const local = new Uint8Array(30 + n.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, deflate ? 8 : 0, true);
    lv.setUint32(18, comp.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, n.length, true);
    local.set(n, 30);
    const cd = new Uint8Array(46 + n.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, deflate ? 8 : 0, true);
    cv.setUint32(20, comp.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, n.length, true);
    cv.setUint32(42, offset, true);
    cd.set(n, 46);
    parts.push(local, comp);
    central.push(cd);
    offset += local.length + comp.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Uint8Array(await new Blob([...parts, ...central, end]).arrayBuffer());
}
const GLB = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 12, 0, 0, 0]);

/* --------------------------------- fakes ------------------------------- */
const META = {
  uid: UID,
  name: "Red Sports Car",
  isDownloadable: true,
  user: { displayName: "Jane Modeller", username: "jane", profileUrl: "https://sketchfab.com/jane" },
  license: { label: "CC Attribution", url: "https://creativecommons.org/licenses/by/4.0/", requirements: "Author must be credited." },
  thumbnails: { images: [{ url: "https://media.sketchfab.com/models/x/thumb-1920.jpeg", width: 1920 }, { url: "https://media.sketchfab.com/models/x/thumb-720.jpeg", width: 720 }, { url: "https://evil.example/t.jpg", width: 500 }] },
};
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const bytesRes = (bytes, headers = {}) => new Response(bytes, { status: 200, headers });

function setup({ meta = META, links = { gltf: { url: S3, size: 1000 } }, file = null, admin = true, env = { SKETCHFAB_API_TOKEN: TOKEN }, fetchOverride = null } = {}) {
  const calls = [];
  const stored = new Map();
  const deps = {
    admin: async () => (admin ? { uid: "admin-1", idToken: "t" } : null),
    bucket: () => ({ put: async (key, body, opts) => stored.set(key, { body: new Uint8Array(body), type: opts.httpMetadata.contentType }) }),
    now: () => 1790000000000,
    fetch: async (url, init = {}) => {
      calls.push({ url: String(url), init });
      if (fetchOverride) return fetchOverride(String(url), init);
      if (String(url) === `https://api.sketchfab.com/v3/models/${UID}`) return meta ? jsonRes(meta) : jsonRes({ detail: "Not found" }, 404);
      if (String(url) === `https://api.sketchfab.com/v3/models/${UID}/download`) return jsonRes(links);
      return file || bytesRes(new Uint8Array(0));
    },
  };
  return { deps, calls, stored, env };
}
const post = (body, method = "POST") =>
  new Request("https://x/api/admin/sketchfab/import", method === "POST" ? { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { method });

/* --------------------------------- tests ------------------------------- */
console.log("URL / UID parsing");
await check("model page, /models/{uid}, embed URL, www and bare UID all resolve", () => {
  for (const u of [PAGE, `https://sketchfab.com/models/${UID}`, `https://sketchfab.com/models/${UID}/embed`, `https://www.sketchfab.com/3d-models/x-${UID}?utm=1`, UID, ` ${UID.toUpperCase()} `])
    assert.equal(parseSketchfabUid(u), UID, u);
});
await check("anything else is rejected", () => {
  for (const u of [
    "",
    null,
    "not a url",
    `http://sketchfab.com/3d-models/x-${UID}`,
    `https://evil.com/3d-models/x-${UID}`,
    `https://sketchfab.com.evil.com/3d-models/x-${UID}`,
    `https://sketchfab.com:8443/models/${UID}`,
    `https://user:pw@sketchfab.com/models/${UID}`,
    "https://sketchfab.com/jane",
    "https://sketchfab.com/3d-models/no-uid-here",
    `https://sketchfab.com/models/${UID.slice(1)}`,
    "javascript:alert(1)",
  ])
    assert.equal(parseSketchfabUid(u), null, String(u));
});

console.log("Admin authentication");
await check("preview and import refuse non-admins without calling Sketchfab", async () => {
  for (const h of [handleSketchfabPreview, handleSketchfabImport]) {
    const s = setup({ admin: false });
    const res = await h(post({ url: PAGE, mode: "embed" }), s.env, s.deps);
    assert.equal(res.status, 401);
    assert.equal(s.calls.length, 0);
  }
});
await check("GET is refused", async () => {
  const s = setup();
  assert.equal((await handleSketchfabPreview(post(null, "GET"), s.env, s.deps)).status, 405);
});

console.log("Invalid Sketchfab URL");
await check("a non-Sketchfab URL is 400 and nothing is fetched (no open proxy)", async () => {
  for (const url of ["https://example.com/model.glb", "http://169.254.169.254/latest/meta-data", "file:///etc/passwd", S3]) {
    const s = setup();
    const res = await handleSketchfabImport(post({ url, mode: "download" }), s.env, s.deps);
    assert.equal(res.status, 400, url);
    assert.equal(s.calls.length, 0, url);
  }
});
await check("an unknown mode is 400", async () => {
  const s = setup();
  assert.equal((await handleSketchfabImport(post({ url: PAGE, mode: "steal" }), s.env, s.deps)).status, 400);
});

console.log("Metadata");
await check("preview returns title, author, safe thumbnail, license, downloadable", async () => {
  const s = setup();
  const res = await handleSketchfabPreview(post({ url: PAGE }), s.env, s.deps);
  assert.equal(res.status, 200);
  const m = await res.json();
  assert.equal(m.title, "Red Sports Car");
  assert.equal(m.author, "Jane Modeller");
  assert.equal(m.authorUrl, "https://sketchfab.com/jane");
  assert.equal(m.thumbnail, "https://media.sketchfab.com/models/x/thumb-720.jpeg");
  assert.deepEqual(m.license, { label: "CC Attribution", url: "https://creativecommons.org/licenses/by/4.0/", requirements: "Author must be credited." });
  assert.equal(m.isDownloadable, true);
  assert.equal(m.canDownload, true);
  assert.equal(m.embedUrl, `https://sketchfab.com/models/${UID}/embed`);
  assert.equal(s.calls[0].url, `https://api.sketchfab.com/v3/models/${UID}`);
  assert.ok(!JSON.stringify(m).includes(TOKEN));
});
await check("metadata is fetched without the token and with redirects refused", async () => {
  const s = setup();
  await handleSketchfabPreview(post({ url: PAGE }), s.env, s.deps);
  assert.equal(s.calls[0].init.headers.Authorization, undefined);
  assert.equal(s.calls[0].init.redirect, "error");
});
await check("unknown model is 404; Sketchfab error is 502; odd metadata is normalised safely", async () => {
  const s = setup({ meta: null });
  assert.equal((await handleSketchfabPreview(post({ url: PAGE }), s.env, s.deps)).status, 404);
  const e = setup({ fetchOverride: () => jsonRes({}, 500) });
  assert.equal((await handleSketchfabPreview(post({ url: PAGE }), e.env, e.deps)).status, 502);
  const n = normalizeMetadata({ user: { profileUrl: "javascript:alert(1)" }, license: { url: "http://x" }, thumbnails: { images: [{ url: "http://media.sketchfab.com/a.jpg" }] } }, UID);
  assert.equal(n.authorUrl, null);
  assert.equal(n.license.url, null);
  assert.equal(n.thumbnail, null);
  assert.equal(n.isDownloadable, false);
});
await check("without a server token, preview says download is not possible here", async () => {
  const s = setup({ env: {} });
  const m = await (await handleSketchfabPreview(post({ url: PAGE }), s.env, s.deps)).json();
  assert.equal(m.isDownloadable, true);
  assert.equal(m.canDownload, false);
});

console.log("Downloadable model");
await check("glTF zip is downloaded via the Download API, unpacked and stored in R2", async () => {
  const archive = await zip([
    ["scene.gltf", '{"asset":{"version":"2.0"}}'],
    ["scene.bin", new Uint8Array([1, 2, 3])],
    ["textures/body_baseColor.png", new Uint8Array([137, 80, 78, 71])],
    ["license.txt", "CC-BY"],
  ]);
  const s = setup({ file: bytesRes(archive) });
  const res = await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps);
  assert.equal(res.status, 200, await res.clone().text());
  const out = await res.json();
  const prefix = `3d-models/sketchfab/${UID}/1790000000000`;
  assert.equal(out.modelUrl, `/media/${prefix}/scene.gltf`);
  assert.equal(out.modelPath, prefix);
  assert.equal(out.modelSource.type, "sketchfab-download");
  assert.equal(out.modelSource.author, "Jane Modeller");
  assert.equal(out.modelSource.license, "CC Attribution");
  assert.equal(out.modelSource.format, "gltf");
  assert.deepEqual([...s.stored.keys()].sort(), [`${prefix}/scene.bin`, `${prefix}/scene.gltf`, `${prefix}/textures/body_baseColor.png`]);
  assert.equal(s.stored.get(`${prefix}/scene.gltf`).type, "model/gltf+json");
  assert.equal(s.stored.get(`${prefix}/textures/body_baseColor.png`).type, "image/png");
  assert.deepEqual([...s.stored.get(`${prefix}/scene.bin`).body], [1, 2, 3]);
  const dl = s.calls.find((c) => c.url.endsWith("/download"));
  assert.equal(dl.init.headers.Authorization, `Token ${TOKEN}`);
  assert.equal(s.calls.at(-1).url, S3);
  assert.equal(s.calls.at(-1).init.redirect, "error");
  assert.equal(s.calls.at(-1).init.headers, undefined, "token never sent to the file host");
  assert.ok(!JSON.stringify(out).includes(TOKEN));
});
await check("a GLB is preferred when offered and stored as one file", async () => {
  const s = setup({ links: { glb: { url: S3, size: 12 }, gltf: { url: S3, size: 99 } }, file: bytesRes(GLB) });
  const out = await (await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps)).json();
  assert.equal(out.modelSource.format, "glb");
  assert.ok(out.modelUrl.endsWith("/model.glb"));
  assert.equal(s.stored.size, 1);
  assert.equal([...s.stored.values()][0].type, "model/gltf-binary");
});
await check("stored (uncompressed) zip entries work too", async () => {
  const files = await unzipGltf(await zip([["model/scene.gltf", "{}"]], { deflate: false }));
  assert.equal(sceneFile(files).path, "model/scene.gltf");
});

console.log("Not downloadable -> embed");
await check("download of a non-downloadable model is 409 and the Download API is never called", async () => {
  const s = setup({ meta: { ...META, isDownloadable: false } });
  const res = await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps);
  assert.equal(res.status, 409);
  assert.ok(/embed/i.test((await res.json()).message));
  assert.ok(!s.calls.some((c) => c.url.endsWith("/download")));
  assert.equal(s.stored.size, 0);
});
await check("the browser cannot claim a model is downloadable: metadata is re-read", async () => {
  const s = setup({ meta: { ...META, isDownloadable: false } });
  const res = await handleSketchfabImport(post({ url: PAGE, mode: "download", isDownloadable: true }), s.env, s.deps);
  assert.equal(res.status, 409);
});
await check("embed saves the official viewer URL and attribution, downloads nothing", async () => {
  const s = setup({ meta: { ...META, isDownloadable: false } });
  const out = await (await handleSketchfabImport(post({ url: PAGE, mode: "embed" }), s.env, s.deps)).json();
  assert.equal(out.modelUrl, `https://sketchfab.com/models/${UID}/embed`);
  assert.equal(out.modelPath, null);
  assert.equal(out.modelSource.type, "sketchfab-embed");
  assert.equal(out.modelSource.title, "Red Sports Car");
  assert.equal(s.calls.length, 1);
  assert.equal(s.stored.size, 0);
});
await check("Sketchfab refusing the download (403) and no token (503) both point to the embed", async () => {
  const r403 = setup({ fetchOverride: (url) => (url.endsWith("/download") ? jsonRes({}, 403) : jsonRes(META)) });
  const a = await handleSketchfabImport(post({ url: PAGE, mode: "download" }), r403.env, r403.deps);
  assert.equal(a.status, 403);
  const none = setup({ env: {} });
  const b = await handleSketchfabImport(post({ url: PAGE, mode: "download" }), none.env, none.deps);
  assert.equal(b.status, 503);
  assert.ok(!none.calls.some((c) => c.url.endsWith("/download")));
});

console.log("SSRF protection");
await check("only https Sketchfab/S3 download hosts are allowed", () => {
  for (const ok of [S3, "https://media.sketchfab.com/x.glb", "https://sketchfab.com/a"]) assert.ok(isAllowedDownloadUrl(ok), ok);
  for (const bad of [
    "http://sketchfab-prod-media.s3.amazonaws.com/x.zip",
    "https://evil.s3.amazonaws.com/x.zip",
    "https://sketchfab.com.evil.com/x",
    "https://evilsketchfab.com/x",
    "https://169.254.169.254/latest",
    "https://localhost/x",
    "https://sketchfab-prod-media.s3.amazonaws.com:444/x",
    "https://u:p@media.sketchfab.com/x",
    "file:///etc/passwd",
    "not a url",
  ])
    assert.equal(isAllowedDownloadUrl(bad), false, bad);
});
await check("a Download API link to another host is refused and never fetched", async () => {
  const s = setup({ links: { gltf: { url: "http://169.254.169.254/latest/meta-data", size: 10 } } });
  const res = await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps);
  assert.equal(res.status, 502);
  assert.ok(!s.calls.some((c) => c.url.includes("169.254")));
});
await check("a redirect from the file host fails the import", async () => {
  const s = setup({
    fetchOverride: (url, init) => {
      if (url.endsWith("/download")) return jsonRes({ gltf: { url: S3, size: 10 } });
      if (url === S3) {
        assert.equal(init.redirect, "error");
        throw new TypeError("redirect mode is set to error");
      }
      return jsonRes(META);
    },
  });
  assert.equal((await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps)).status, 502);
  assert.equal(s.stored.size, 0);
});

console.log("Size and type validation");
await check("declared size over the limit is refused before downloading", async () => {
  const s = setup({ links: { gltf: { url: S3, size: MAX_DOWNLOAD_BYTES + 1 } } });
  assert.equal((await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps)).status, 413);
  assert.ok(!s.calls.some((c) => c.url === S3));
});
await check("an oversized body is cut off even if the declared size lied", async () => {
  const s = setup({ file: bytesRes(new Uint8Array(10), { "content-length": String(MAX_DOWNLOAD_BYTES + 5) }) });
  assert.equal((await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps)).status, 413);
  assert.equal(s.stored.size, 0);
});
await check("a GLB link that is not a GLB, or a zip that is not a zip, is refused", async () => {
  const g = setup({ links: { glb: { url: S3, size: 4 } }, file: bytesRes(enc.encode("<html>")) });
  assert.equal((await handleSketchfabImport(post({ url: PAGE, mode: "download" }), g.env, g.deps)).status, 422);
  const z = setup({ file: bytesRes(enc.encode("not a zip at all, definitely")) });
  assert.equal((await handleSketchfabImport(post({ url: PAGE, mode: "download" }), z.env, z.deps)).status, 422);
  assert.equal(g.stored.size + z.stored.size, 0);
});
await check("a zip without a .gltf scene is refused; unsafe or unknown entries are skipped", async () => {
  const s = setup({ file: bytesRes(await zip([["readme.txt", "hi"], ["scene.bin", "x"]])) });
  assert.equal((await handleSketchfabImport(post({ url: PAGE, mode: "download" }), s.env, s.deps)).status, 422);
  const files = await unzipGltf(await zip([["../../etc/passwd.png", "x"], ["/abs.gltf", "{}"], ["a\\b.png", "x"], ["run.js", "x"], ["ok/scene.gltf", "{}"]]));
  assert.deepEqual(files.map((f) => f.path), ["ok/scene.gltf"]);
  for (const bad of ["../x.png", "a/../b.png", "x.exe", "dir/", ""]) assert.equal(safeEntryPath(bad), null, bad);
});
await check("3D uploads with an empty browser type get their type from the extension", () => {
  assert.equal(uploadType({ name: "car.glb", type: "" }, "3d-models"), "model/gltf-binary");
  assert.equal(uploadType({ name: "car.GLTF", type: "application/octet-stream" }, "3d-models"), "model/gltf+json");
  assert.equal(uploadType({ name: "x.exe", type: "" }, "3d-models"), "");
  assert.equal(uploadType({ name: "car.glb", type: "" }, "car-images"), "", "only for the 3d-models folder");
});

console.log("Car document update, removal and replacement");
await check("nothing chosen writes nothing", () => assert.deepEqual(modelWrite({}), {}));
await check("Sketchfab import writes modelUrl, modelPath and modelSource", () => {
  const sf = { modelUrl: "/media/3d-models/sketchfab/u/1/scene.gltf", modelPath: "3d-models/sketchfab/u/1", modelSource: { type: "sketchfab-download", uid: UID } };
  assert.deepEqual(modelWrite({ sketchfab: sf }), sf);
  assert.deepEqual(modelWrite({ sketchfab: { modelUrl: "https://sketchfab.com/models/x/embed", modelSource: { type: "sketchfab-embed" } } }).modelPath, null);
});
await check("an upload replaces a Sketchfab model and clears its attribution", () => {
  assert.deepEqual(modelWrite({ uploaded: { url: "/media/3d-models/1_a.glb", path: "3d-models/1_a.glb" }, sketchfab: { modelUrl: "x" }, remove: true }), {
    modelUrl: "/media/3d-models/1_a.glb",
    modelPath: "3d-models/1_a.glb",
    modelSource: null,
  });
});
await check("remove clears all three fields", () => assert.deepEqual(modelWrite({ remove: true }), { modelUrl: null, modelPath: null, modelSource: null }));
await check("car page: embed only for an exact Sketchfab embed URL; glTF otherwise; old cars still work", () => {
  const embed = `https://sketchfab.com/models/${UID}/embed`;
  const src = { type: "sketchfab-embed", title: "T", author: "A", authorUrl: "https://sketchfab.com/a", viewerUrl: `https://sketchfab.com/3d-models/${UID}`, license: "CC BY", licenseUrl: "https://creativecommons.org/licenses/by/4.0/" };
  const v = modelView({ modelUrl: embed, modelSource: src });
  assert.equal(v.kind, "embed");
  assert.equal(v.credit.author, "A");
  assert.equal(modelView({ modelUrl: "https://evil.com/x", modelSource: { type: "sketchfab-embed" } }), null);
  assert.equal(modelView({ modelUrl: "https://sketchfab.com/models/../evil", modelSource: null }), null);
  assert.deepEqual(modelView({ modelUrl: "/media/3d-models/1_a.glb" }), { kind: "gltf", url: "/media/3d-models/1_a.glb", credit: null });
  assert.equal(modelView({}), null);
  assert.equal(modelView({ modelUrl: "/m.glb", modelSource: { type: "sketchfab-download", authorUrl: "javascript:x" } }).credit.authorUrl, null);
});
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [admin, details, worker, panel] = await Promise.all([read("../public/app/js/pages/admin.js"), read("../public/app/js/pages/car-details.js"), read("../server/worker.js"), read("../public/app/js/features/sketchfab-import.js")]);
await check("admin form saves the model through modelWrite and offers both options", () => {
  assert.ok(/Object\.assign\(data, modelWrite\(\{ uploaded, sketchfab: modelSection\.pending\(\), remove: removeModel \}\)\);/.test(admin));
  assert.ok(panel.includes("Upload 3D Model") && panel.includes("Import from Sketchfab") && panel.includes("Use Sketchfab Embed"));
  assert.ok(/modelView\(car\)/.test(details));
});
await check("routes are admin-only through adminUser", () => {
  assert.ok(/"\/api\/admin\/sketchfab\/preview"\) return handleSketchfabPreview\(request, env, sketchfabDeps\)/.test(worker));
  assert.ok(/"\/api\/admin\/sketchfab\/import"\) return handleSketchfabImport\(request, env, sketchfabDeps\)/.test(worker));
  assert.ok(/const sketchfabDeps = \{\s*admin: adminUser,/.test(worker));
});

console.log("No secrets client-side");
await check("no public file mentions the token, the Download API, or a Sketchfab secret", async () => {
  const walk = async (dir) => (await readdir(dir, { withFileTypes: true })).flatMap((d) => (d.isDirectory() ? [] : [`${dir}/${d.name}`]));
  const dirs = ["public/app/js/core", "public/app/js/features", "public/app/js/pages", "public/app/pages"];
  let scanned = 0;
  for (const dir of dirs)
    for (const f of await walk(new URL(`../${dir}`, import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
      const src = await readFile(f, "utf8");
      assert.ok(!/SKETCHFAB_API_TOKEN|api\.sketchfab\.com|\/download["'`]|Token \$\{|client_secret/i.test(src), f);
      scanned++;
    }
  assert.ok(scanned >= 30, `only ${scanned} public files scanned`);
});

console.log(`\n${passed} checks passed. (Fake network and R2; nothing real called.)`);
