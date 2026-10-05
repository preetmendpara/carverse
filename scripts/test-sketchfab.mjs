#!/usr/bin/env node
// 3D models: Sketchfab embeds (no API, no download) and local uploads.
// Pure checks of public/app/js/core/model-source.js, plus wiring and a scan
// that no Sketchfab API, token or download code remains. No network.
//   node scripts/test-sketchfab.mjs
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  parseSketchfabUid,
  sketchfabFromEmbedCode,
  sketchfabFromUrl,
  sketchfabSource,
  modelWrite,
  modelView,
  embedUrlFor,
} from "../public/app/js/core/model-source.js";
import { uploadType } from "../server/worker.js";

globalThis.fetch = () => {
  throw new Error("network used in a test");
};
let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};

const UID = "94b24a60dc1b48248de50bf087c0f042";
const EMBED = `https://sketchfab.com/models/${UID}/embed`;
const PAGE = `https://sketchfab.com/3d-models/red-sports-car-${UID}`;
// What Sketchfab's "Embed" button gives (shape of the official snippet).
const SNIPPET = `<div class="sketchfab-embed-wrapper"> <iframe title="Red Sports Car" frameborder="0" allowfullscreen mozallowfullscreen="true" webkitallowfullscreen="true" allow="autoplay; fullscreen; xr-spatial-tracking" xr-spatial-tracking execution-while-out-of-viewport execution-while-not-rendered web-share src="https://sketchfab.com/models/${UID}/embed?autostart=1&amp;ui_theme=dark"> </iframe> <p style="font-size: 13px;"> <a href="${PAGE}?utm_medium=embed&utm_campaign=share-popup" target="_blank" rel="nofollow">Red Sports Car</a> by <a href="https://sketchfab.com/jane?utm_medium=embed" target="_blank" rel="nofollow">Jane Modeller</a> on <a href="https://sketchfab.com?utm_medium=embed" target="_blank" rel="nofollow">Sketchfab</a></p></div>`;

console.log("UID parsing and normalised embed URL");
await check("model page, /models/{uid}, embed URL and www resolve to the UID", () => {
  for (const u of [PAGE, `https://sketchfab.com/models/${UID}`, EMBED, `https://www.sketchfab.com/3d-models/x-${UID}?a=1`, `https://sketchfab.com/models/${UID.toUpperCase()}/embed`])
    assert.equal(parseSketchfabUid(u), UID, u);
});
await check("host is case-insensitive", () => {
  assert.equal(parseSketchfabUid(`https://SKETCHFAB.COM/3d-models/x-${UID}`), UID);
  assert.equal(parseSketchfabUid(`HTTPS://WWW.Sketchfab.com/models/${UID}`), UID);
});
await check("embed URL is rebuilt from the UID, query string dropped", () => {
  assert.equal(embedUrlFor(UID), EMBED);
  assert.equal(sketchfabFromEmbedCode(SNIPPET).embedUrl, EMBED);
  assert.equal(sketchfabFromUrl(PAGE).embedUrl, EMBED);
});
await check("non-model Sketchfab pages give no UID", () => {
  for (const u of ["https://sketchfab.com/jane", "https://sketchfab.com/3d-models/no-uid", `https://sketchfab.com/models/${UID.slice(1)}`, `https://sketchfab.com/models/${UID}/embed/extra`, `https://sketchfab.com/3d-models/x-${UID}/more`])
    assert.equal(parseSketchfabUid(u), null, u);
});

console.log("Sketchfab URL");
await check("valid model URL gives embed URL, source page and default credit", () => {
  const r = sketchfabFromUrl(PAGE);
  assert.deepEqual(r, { ok: true, uid: UID, embedUrl: EMBED, sourceUrl: PAGE, attribution: "Model on Sketchfab" });
  assert.equal(sketchfabFromUrl(PAGE, "Red Sports Car by Jane (CC BY 4.0)").attribution, "Red Sports Car by Jane (CC BY 4.0)");
  assert.equal(sketchfabFromUrl(`https://sketchfab.com/models/${UID}`).sourceUrl, `https://sketchfab.com/3d-models/${UID}`);
});

console.log("Embed code");
await check("official embed snippet: one iframe, normalised URL, credit as plain text, source link", () => {
  const r = sketchfabFromEmbedCode(SNIPPET);
  assert.equal(r.ok, true);
  assert.equal(r.uid, UID);
  assert.equal(r.attribution, "Red Sports Car by Jane Modeller on Sketchfab");
  assert.equal(r.sourceUrl, PAGE);
});
await check("a bare iframe works, credit falls back to its title", () => {
  const r = sketchfabFromEmbedCode(`<iframe title="Blue Coupe" src='${EMBED}'></iframe>`);
  assert.equal(r.ok, true);
  assert.equal(r.attribution, "Blue Coupe on Sketchfab");
  assert.equal(r.sourceUrl, `https://sketchfab.com/3d-models/${UID}`);
});
await check("credit text cannot carry markup or scripts", () => {
  const r = sketchfabFromEmbedCode(`<iframe src="${EMBED}"></iframe><p><script>alert(1)</script><img src=x onerror=alert(1)>Car &lt;b&gt;x&lt;/b&gt; by <a href="javascript:alert(1)">Eve</a></p>`);
  assert.equal(r.ok, true);
  assert.ok(!/[<>]/.test(r.attribution), r.attribution);
  assert.equal(r.sourceUrl, `https://sketchfab.com/3d-models/${UID}`, "a javascript: link is never used");
});

console.log("Rejections");
const bad = (code) => {
  const r = sketchfabFromEmbedCode(code);
  assert.equal(r.ok, false, code);
  assert.ok(r.error);
};
await check("invalid hosts are rejected", () => {
  for (const host of ["evil.com", "sketchfab.com.evil.com", "evilsketchfab.com", "sketchfab.co", "static.sketchfab.com"]) {
    bad(`<iframe src="https://${host}/models/${UID}/embed"></iframe>`);
    assert.equal(sketchfabFromUrl(`https://${host}/3d-models/x-${UID}`).ok, false, host);
  }
  for (const u of [`https://sketchfab.com:8443/models/${UID}/embed`, `https://u:p@sketchfab.com/models/${UID}/embed`, `//sketchfab.com/models/${UID}/embed`]) assert.equal(parseSketchfabUid(u), null, u);
});
await check("javascript:, data:, blob:, http:, file: and relative sources are rejected", () => {
  for (const src of [
    "javascript:alert(1)",
    `javascript://sketchfab.com/models/${UID}/embed%0aalert(1)`,
    `data:text/html,<script>alert(1)</script>`,
    `blob:https://sketchfab.com/${UID}`,
    `http://sketchfab.com/models/${UID}/embed`,
    `file:///models/${UID}/embed`,
    `/models/${UID}/embed`,
    ` jAvAsCrIpT:alert(1)`,
  ]) {
    bad(`<iframe src="${src}"></iframe>`);
    assert.equal(sketchfabFromUrl(src).ok, false, src);
  }
});
await check("arbitrary iframes and non-embed Sketchfab iframes are rejected", () => {
  bad(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`);
  bad(`<iframe src="${PAGE}"></iframe>`, "a model page is not an embed");
  bad(`<iframe src="https://sketchfab.com/playlists/abc/embed"></iframe>`);
  bad(`<iframe srcdoc="<script>alert(1)</script>"></iframe>`);
  bad(`<iframe src="${EMBED}"></iframe><iframe src="https://evil.com"></iframe>`);
  bad(`<script src="${EMBED}"></script>`);
  bad("");
  bad("x".repeat(6000));
});

console.log("Stored data");
await check("modelSource serialises to exactly type, embedUrl, sourceUrl, attribution", () => {
  const src = sketchfabSource(sketchfabFromEmbedCode(SNIPPET));
  assert.deepEqual(Object.keys(src), ["type", "embedUrl", "sourceUrl", "attribution"]);
  assert.deepEqual(src, { type: "sketchfab-embed", embedUrl: EMBED, sourceUrl: PAGE, attribution: "Red Sports Car by Jane Modeller on Sketchfab" });
  assert.equal(JSON.parse(JSON.stringify(src)).embedUrl, EMBED);
});
await check("raw HTML is never stored: the write holds only the normalised URL and plain text", () => {
  const w = modelWrite({ sketchfab: sketchfabFromEmbedCode(SNIPPET) });
  assert.deepEqual(w, { modelUrl: EMBED, modelPath: null, modelSource: { type: "sketchfab-embed", embedUrl: EMBED, sourceUrl: PAGE, attribution: "Red Sports Car by Jane Modeller on Sketchfab" } });
  const text = JSON.stringify(w);
  for (const bit of ["<", ">", "iframe", "autostart", "allowfullscreen", "style="]) assert.ok(!text.includes(bit), bit);
});
await check("a failed validation writes nothing", () => {
  assert.deepEqual(modelWrite({ sketchfab: sketchfabFromEmbedCode('<iframe src="https://evil.com"></iframe>') }), {});
});

console.log("Local models unchanged; removal and replacement");
await check("upload writes modelUrl/modelPath as before and clears any Sketchfab source", () => {
  assert.deepEqual(modelWrite({ uploaded: { url: "/media/3d-models/1_a.glb", path: "3d-models/1_a.glb" }, sketchfab: sketchfabFromUrl(PAGE) }), {
    modelUrl: "/media/3d-models/1_a.glb",
    modelPath: "3d-models/1_a.glb",
    modelSource: null,
  });
});
await check("remove clears all three fields; nothing chosen writes nothing", () => {
  assert.deepEqual(modelWrite({ remove: true }), { modelUrl: null, modelPath: null, modelSource: null });
  assert.deepEqual(modelWrite({}), {});
});
await check("car page: local model -> Three.js, Sketchfab -> embed with credit, none -> hidden", () => {
  assert.deepEqual(modelView({ modelUrl: "/media/3d-models/1_a.glb", modelPath: "3d-models/1_a.glb" }), { kind: "gltf", url: "/media/3d-models/1_a.glb" });
  const v = modelView({ modelUrl: EMBED, modelSource: { type: "sketchfab-embed", embedUrl: EMBED, sourceUrl: PAGE, attribution: "Red Sports Car by Jane" } });
  assert.deepEqual(v, { kind: "embed", url: EMBED, sourceUrl: PAGE, attribution: "Red Sports Car by Jane" });
  assert.equal(modelView({}), null);
  assert.equal(modelView({ modelUrl: "" }), null);
});
await check("car page never iframes or loads anything that is not validated", () => {
  for (const modelUrl of ["https://evil.com/x", "javascript:alert(1)", "data:text/html,x", "//evil.com/m.glb", `https://sketchfab.com/models/${UID}/embed?x=1`, "https://evil.com/car.glb"])
    assert.equal(modelView({ modelUrl, modelSource: { type: "sketchfab-embed" } }), null, modelUrl);
  assert.equal(modelView({ modelUrl: EMBED, modelSource: { type: "sketchfab-embed", sourceUrl: "javascript:alert(1)", attribution: "<b>x</b>" } }).sourceUrl, `https://sketchfab.com/3d-models/${UID}`);
  assert.ok(!/[<>]/.test(modelView({ modelUrl: EMBED, modelSource: { type: "sketchfab-embed", attribution: "<b>x</b>" } }).attribution));
});
await check("3D uploads with an empty browser type still get their type from the extension", () => {
  assert.equal(uploadType({ name: "car.glb", type: "" }, "3d-models"), "model/gltf-binary");
  assert.equal(uploadType({ name: "car.gltf", type: "application/octet-stream" }, "3d-models"), "model/gltf+json");
  assert.equal(uploadType({ name: "car.glb", type: "" }, "car-images"), "");
});

console.log("Wiring, admin-only writes, no API");
const read = (p) => readFile(new URL(p, import.meta.url), "utf8");
const [admin, details, panel, worker, rules, store] = await Promise.all([
  read("../public/app/js/pages/admin.js"),
  read("../public/app/js/pages/car-details.js"),
  read("../public/app/js/features/sketchfab-import.js"),
  read("../server/worker.js"),
  read("../server/rules/firestore.rules"),
  read("../public/app/js/core/store.js"),
]);
await check("admin UI offers upload, embed code and URL, with Preview and Save", () => {
  for (const bit of ["Upload 3D Model", "Paste Sketchfab Embed Code", "Paste Sketchfab &lt;iframe&gt; code here...", "Paste Sketchfab URL", "https://sketchfab.com/3d-models/...", '"sf-preview">Preview<', '"sf-save">Save<'])
    assert.ok(panel.includes(bit), bit);
});
await check("save and remove go through the admin-only car write (Firestore rules)", () => {
  assert.ok(/await saveCar\(modelWrite\(\{ sketchfab: r \}\), car\.id\)/.test(panel));
  assert.ok(/Object\.assign\(data, modelWrite\(\{ uploaded, sketchfab: modelSection\.pending\(\), remove: removeModel \}\)\);/.test(admin));
  assert.ok(/match \/cars\/\{id\}\s*\{ allow read: if true; allow write: if isAdmin\(\); \}/.test(rules));
});
await check("pasted HTML is never inserted: preview and page build their own sandboxed iframe", () => {
  assert.ok(!/innerHTML\s*=\s*[^;]*\$\("sf-code"\)\.value/.test(panel));
  assert.ok(/embedFrame\(r\.embedUrl\)/.test(panel));
  assert.ok(/sandbox="\$\{SANDBOX\}"/.test(panel));
  assert.ok(/embedFrame\(model\.url\)/.test(details) && /modelView\(car\)/.test(details));
});
await check("no Sketchfab API, token, download or import route remains", async () => {
  assert.ok(!existsSync(new URL("../server/sketchfab", import.meta.url)));
  assert.ok(!/sketchfab/i.test(worker), "worker still mentions sketchfab");
  assert.ok(!/sketchfab/i.test(store), "store still calls a sketchfab route");
  const files = [];
  const walk = async (dir) => {
    for (const d of await readdir(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", ".wrangler", "backups"].includes(d.name)) continue;
      const p = `${dir}/${d.name}`;
      if (d.isDirectory()) await walk(p);
      else if (/\.(m?js|html|toml|rules|json)$/.test(d.name)) files.push(p);
    }
  };
  const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1").replace(/\/$/, "");
  await walk(`${root}/public`);
  await walk(`${root}/server`);
  files.push(`${root}/wrangler.toml`);
  assert.ok(files.length >= 40, `only ${files.length} files scanned`);
  for (const f of files) {
    const src = await readFile(f, "utf8");
    assert.ok(!/SKETCHFAB_API_TOKEN|api\.sketchfab\.com|\/api\/admin\/sketchfab/i.test(src), f);
  }
});
await check("everything works with no Sketchfab token in the environment", () => {
  assert.equal(process.env.SKETCHFAB_API_TOKEN, undefined);
  assert.equal(sketchfabFromUrl(PAGE).ok, true);
  assert.equal(modelWrite({ sketchfab: sketchfabFromEmbedCode(SNIPPET) }).modelUrl, EMBED);
});

console.log(`\n${passed} checks passed. (No network; no Sketchfab API.)`);
