// Admin car form: the 3D model section. "Upload 3D Model" (unchanged upload)
// and "Import from Sketchfab". The browser only sends the Sketchfab link to
// the Worker (/api/admin/sketchfab/*), which holds any Sketchfab token, talks
// to Sketchfab's official API and stores downloads in R2. Nothing is written
// to the car until the admin saves it.
import { esc } from "../components/layout.js";
import { sketchfabPreview, sketchfabImport } from "../core/store.js";
import { modelCredit } from "../core/model-source.js";

const creditHtml = (c) =>
  c
    ? `"${c.titleUrl ? `<a href="${esc(c.titleUrl)}" target="_blank" rel="noopener">${esc(c.title)}</a>` : esc(c.title)}" by ${
        c.authorUrl ? `<a href="${esc(c.authorUrl)}" target="_blank" rel="noopener">${esc(c.author)}</a>` : esc(c.author)
      } on Sketchfab${c.license ? `, ${c.licenseUrl ? `<a href="${esc(c.licenseUrl)}" target="_blank" rel="noopener">${esc(c.license)}</a>` : esc(c.license)}` : ""}`
    : "";

export function modelSectionHtml(car) {
  const src = car?.modelSource;
  const current = !car?.modelUrl
    ? ""
    : src?.type === "sketchfab-embed"
      ? `Current model: Sketchfab embed — ${creditHtml(modelCredit(src))}.`
      : src?.type === "sketchfab-download"
        ? `Current model: imported from Sketchfab — ${creditHtml(modelCredit(src))}.`
        : "Current model uploaded.";
  return `
      <h3>3D model</h3>
      ${current ? `<p class="small" id="model-current">${current} <button type="button" class="btn btn-sm btn-ghost" id="rm-model">Remove</button></p>` : ""}
      <div class="field"><label for="model-file">Upload 3D Model (GLB / glTF)</label>
        <input type="file" id="model-file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></div>
      <button type="button" class="btn btn-sm" id="sf-toggle" aria-expanded="false" aria-controls="sf-panel">Import from Sketchfab</button>
      <div id="sf-panel" hidden style="margin-top:10px">
        <div class="finder-row">
          <input id="sf-url" placeholder="https://sketchfab.com/3d-models/name-…" autocomplete="off">
          <button type="button" class="btn btn-sm" id="sf-preview">Preview</button>
        </div>
        <p class="small" id="sf-st" role="status"></p>
        <div id="sf-out"></div>
      </div>`;
}

/** Wires the section. Returns { pending() } -> the chosen Sketchfab import, or null. */
export function mountModelSection({ onChange = () => {} } = {}) {
  const $ = (id) => document.getElementById(id);
  let chosen = null;
  const st = (t) => ($("sf-st").textContent = t);

  $("sf-toggle").addEventListener("click", () => {
    const open = $("sf-panel").hidden;
    $("sf-panel").hidden = !open;
    $("sf-toggle").setAttribute("aria-expanded", String(open));
    if (open) $("sf-url").focus();
  });

  $("sf-preview").addEventListener("click", async () => {
    const url = $("sf-url").value.trim();
    if (!url) return st("Paste a Sketchfab model link.");
    $("sf-preview").disabled = true;
    $("sf-out").innerHTML = "";
    st("Looking up the model on Sketchfab…");
    try {
      const m = await sketchfabPreview(url);
      st("");
      $("sf-out").innerHTML = `
        <div class="card card-pad" style="display:flex;gap:12px;align-items:flex-start">
          ${m.thumbnail ? `<img src="${esc(m.thumbnail)}" alt="" width="160" style="max-width:40%;height:auto">` : ""}
          <div class="small">
            <div><b>${esc(m.title)}</b> by ${m.authorUrl ? `<a href="${esc(m.authorUrl)}" target="_blank" rel="noopener">${esc(m.author)}</a>` : esc(m.author)}</div>
            <div>License: ${m.license ? (m.license.url ? `<a href="${esc(m.license.url)}" target="_blank" rel="noopener">${esc(m.license.label)}</a>` : esc(m.license.label)) : "not stated"}</div>
            ${m.license?.requirements ? `<div class="muted">${esc(m.license.requirements)}</div>` : ""}
            <div>Downloadable on Sketchfab: <b>${m.isDownloadable ? "yes" : "no"}</b></div>
            <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap">
              ${m.canDownload ? `<button type="button" class="btn btn-sm btn-primary" data-sf="download">Import model</button>` : ""}
              <button type="button" class="btn btn-sm" data-sf="embed">Use Sketchfab Embed</button>
            </div>
            ${
              m.isDownloadable && !m.canDownload
                ? `<p class="muted">Download is not configured on this server, so the official Sketchfab viewer will be used.</p>`
                : !m.isDownloadable
                  ? `<p class="muted">The author has not allowed downloads, so CarVerse uses the official Sketchfab viewer instead.</p>`
                  : ""
            }
            <p class="muted">Attribution is saved with the car and shown with the model.</p>
          </div>
        </div>`;
      $("sf-out").querySelectorAll("[data-sf]").forEach((b) => b.addEventListener("click", () => use(url, b.dataset.sf)));
    } catch (err) {
      st(err.message);
    } finally {
      $("sf-preview").disabled = false;
    }
  });

  async function use(url, mode) {
    $("sf-out").querySelectorAll("[data-sf]").forEach((b) => (b.disabled = true));
    st(mode === "download" ? "Importing the model from Sketchfab… this can take a minute." : "Preparing the Sketchfab viewer…");
    try {
      chosen = await sketchfabImport(url, mode);
      $("model-file").value = ""; // one model per car: the import replaces a picked file
      st(`${mode === "download" ? "Imported" : "Sketchfab embed ready"}: "${chosen.modelSource.title}". It replaces the current model when you save the car.`);
      onChange();
    } catch (err) {
      st(err.message);
      $("sf-out").querySelectorAll("[data-sf]").forEach((b) => (b.disabled = false));
    }
  }

  // Picking a file after an import means the admin wants the file instead.
  $("model-file").addEventListener("change", () => {
    if ($("model-file").files.length && chosen) {
      chosen = null;
      st("The uploaded file will be used instead of the Sketchfab import.");
    }
  });

  return { pending: () => chosen };
}
