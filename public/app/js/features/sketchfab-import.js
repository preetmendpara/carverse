// Admin car form: the 3D model section.
//   Upload 3D Model            a GLB/glTF file to R2 (unchanged)
//   Paste Sketchfab Embed Code an <iframe> snippet from Sketchfab's "Embed"
//   Paste Sketchfab URL        a model link
// The pasted text is only validated as text (core/model-source.js): no
// Sketchfab API is called, nothing is downloaded, and the pasted HTML is never
// inserted into the page or stored. Preview builds a fresh, sandboxed iframe
// from the normalised embed URL. Save writes the model to the car (admins only,
// Firestore rules) or, for a car not yet saved, with the car.
import { esc, toast } from "../components/layout.js";
import { saveCar } from "../core/store.js";
import { sketchfabFromEmbedCode, sketchfabFromUrl, modelWrite, sketchfabViewerUrl } from "../core/model-source.js";

// Used by the admin Preview and the public car page. The Sketchfab viewer
// needs scripts; it runs on Sketchfab's own origin. The src is always built
// from a validated embed URL with Sketchfab's documented options; no
// fullscreen permission is given.
export const SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";
export const embedFrame = (url, title = "3D model") =>
  `<iframe title="${esc(title)} (Sketchfab viewer)" src="${esc(sketchfabViewerUrl(url) || "about:blank")}" sandbox="${SANDBOX}" allow="xr-spatial-tracking" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" style="width:100%;height:100%;border:0"></iframe>`;

export function modelSectionHtml(car) {
  const src = car?.modelSource;
  const current = !car?.modelUrl
    ? ""
    : src?.type === "sketchfab-embed"
      ? `Current model: Sketchfab embed — ${esc(src.attribution || "Model on Sketchfab")}.`
      : "Current model uploaded.";
  return `
      <h3>3D model</h3>
      ${current ? `<p class="small" id="model-current">${current} <button type="button" class="btn btn-sm btn-ghost" id="rm-model">Remove</button></p>` : ""}
      <div class="field"><label for="model-file">Upload 3D Model (GLB / glTF)</label>
        <input type="file" id="model-file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json"></div>
      <p class="small muted" style="margin:4px 0 8px">OR</p>
      <div class="field"><label for="sf-code">Paste Sketchfab Embed Code</label>
        <textarea id="sf-code" rows="3" maxlength="5000" placeholder="Paste Sketchfab &lt;iframe&gt; code here..."></textarea></div>
      <div class="field"><label for="sf-url">Paste Sketchfab URL</label>
        <input id="sf-url" autocomplete="off" placeholder="https://sketchfab.com/3d-models/..."></div>
      <div class="field"><label for="sf-credit">Credit (author, license)</label>
        <input id="sf-credit" maxlength="200" placeholder="Filled from the embed code; add it for a link"></div>
      <div class="row-actions"><button type="button" class="btn btn-sm" id="sf-preview">Preview</button>
        <button type="button" class="btn btn-sm btn-primary" id="sf-save">Save</button></div>
      <p class="small" id="sf-st" role="status"></p>
      <div id="sf-out"></div>`;
}

/**
 * Wires the section. `car` is the car being edited (null for a new car).
 * Returns { pending() } -> the Sketchfab choice to save with the car, or null.
 */
export function mountModelSection({ car = null } = {}) {
  const $ = (id) => document.getElementById(id);
  let pending = null;
  const st = (t) => ($("sf-st").textContent = t);

  // The embed code wins when both boxes are filled.
  function read() {
    const code = $("sf-code").value;
    const r = code.trim() ? sketchfabFromEmbedCode(code) : sketchfabFromUrl($("sf-url").value, $("sf-credit").value);
    if (r.ok && code.trim() && $("sf-credit").value.trim()) r.attribution = $("sf-credit").value.trim();
    return r;
  }

  $("sf-preview").addEventListener("click", () => {
    const r = read();
    if (!r.ok) {
      $("sf-out").innerHTML = "";
      return st(r.error);
    }
    if (!$("sf-credit").value.trim()) $("sf-credit").value = r.attribution;
    st("");
    $("sf-out").innerHTML = `<div style="height:320px;max-width:560px">${embedFrame(r.embedUrl)}</div>
      <p class="small muted">${esc(r.attribution)} · <a href="${esc(r.sourceUrl)}" target="_blank" rel="noopener">View on Sketchfab</a></p>`;
  });

  $("sf-save").addEventListener("click", async () => {
    const r = read();
    if (!r.ok) return st(r.error);
    $("model-file").value = ""; // one model per car: the Sketchfab model replaces a picked file
    if (!car?.id) {
      pending = r;
      return st("Sketchfab model chosen. It is saved when you save the car.");
    }
    $("sf-save").disabled = true;
    try {
      await saveCar(modelWrite({ sketchfab: r }), car.id);
      pending = null;
      st("Saved. The car now shows this Sketchfab model.");
      toast("3D model saved");
    } catch (err) {
      st(`Could not save: ${err.message}`);
    } finally {
      $("sf-save").disabled = false;
    }
  });

  // Picking a file means the admin wants the file instead.
  $("model-file").addEventListener("change", () => {
    if ($("model-file").files.length && pending) {
      pending = null;
      st("The uploaded file will be used instead of the Sketchfab model.");
    }
  });

  return { pending: () => pending };
}
