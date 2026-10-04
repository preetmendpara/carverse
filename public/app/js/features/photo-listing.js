// AI photo-to-listing, inside the admin car form.
// The admin picks 5-10 photos; the Worker (/api/photo-listing) asks Gemini what
// is visible and checks the answer in plain code. This panel only SHOWS the
// result. Nothing reaches the form until the admin ticks values and presses
// "Fill the form"; nothing reaches Firestore until they save the car; a new
// car is always left as a draft. Values that survive the admin's review are
// saved with provenance "ai-photo" and the full reading in `aiListing`.
import { esc } from "../components/layout.js";
import { analysePhotos } from "../core/store.js";
import { BODY_TYPES } from "../core/car-fields.js";

const LABELS = { make: "Make", model: "Model", variant: "Variant", bodyType: "Body type", colour: "Colour", odometerKm: "Kilometres (odometer)" };
// Which form control each field fills. Normalised fields use the "n-" ids.
const CONTROL = { model: "model", variant: "variant", bodyType: "n-bodyType", colour: "n-colour", odometerKm: "n-odometerKm" };
const PRE_TICK = 0.8; // only clearly observed values start ticked; the admin still confirms
const MAX_EDGE = 1600;

export const photoListingPanel = () => `
  <details class="card card-pad ai-photo" style="margin-bottom:16px">
    <summary><b>AI photo-to-listing</b> <span class="small muted">— draft fields from 5–10 photos</span></summary>
    <p class="small">AI reads only what the photos show. Every value has a status and confidence; nothing is filled in until you tick it and press "Fill the form", and nothing is published until you save it yourself.</p>
    <div class="field"><input type="file" id="ai-photos" accept="image/jpeg,image/png,image/webp" multiple></div>
    <button type="button" class="btn btn-sm" id="ai-run">Analyse photos</button>
    <p class="small" id="ai-st" role="status"></p>
    <div id="ai-out"></div>
  </details>`;

/** Shrinks a photo to at most MAX_EDGE px as JPEG, so 10 photos fit one request. */
async function shrink(file) {
  try {
    const img = await createImageBitmap(file);
    const k = Math.min(1, MAX_EDGE / Math.max(img.width, img.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * k);
    canvas.height = Math.round(img.height * k);
    canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file; // the Worker still checks type and size
  }
}

const pct = (c) => `${Math.round(c * 100)}%`;
const statusBadge = (s) => `<span class="badge ai-${esc(s)}">${s === "observed" ? "Observed" : s === "uncertain" ? "Uncertain" : "Not visible"}</span>`;
const photosText = (p) => (p.length ? `photo ${p.join(", ")}` : "");
const shown = (k, v) => (k === "bodyType" ? BODY_TYPES.find(([b]) => b === v)?.[1] || v : k === "odometerKm" ? `${Number(v).toLocaleString("en-IN")} km` : v);

/**
 * Wires the panel. `brands` is the brand list of the form's brand select.
 * Returns { kept() } for the save handler: the provenance entries and the
 * `aiListing` record for values still as the AI gave them, or null.
 */
export function mountPhotoListing({ brands }) {
  let result = null;
  let files = [];
  const applied = {}; // key -> the control value the AI filled in
  const appliedFeatures = new Set();
  let appliedDescription = null;
  const $ = (id) => document.getElementById(id);

  $("ai-run").addEventListener("click", async () => {
    files = [...$("ai-photos").files];
    if (files.length < 5 || files.length > 10) return ($("ai-st").textContent = "Choose 5 to 10 photos.");
    $("ai-run").disabled = true;
    $("ai-st").textContent = "Reading the photos… this can take up to a minute.";
    $("ai-out").innerHTML = "";
    try {
      result = await analysePhotos(await Promise.all(files.map(shrink)));
      $("ai-st").textContent = `Read ${result.photoCount} photos. Review every value before using it.`;
      render();
    } catch (err) {
      result = null;
      $("ai-st").textContent = `Could not analyse the photos: ${err.message}`;
    } finally {
      $("ai-run").disabled = false;
    }
  });

  function render() {
    const rows = Object.entries(result.fields)
      .map(([k, f]) => {
        const usable = f.value !== null;
        const tick = usable && f.status === "observed" && f.confidence >= PRE_TICK;
        return `<tr>
          <td><input type="checkbox" data-ai-field="${esc(k)}" ${usable ? "" : "disabled"} ${tick ? "checked" : ""} aria-label="Use ${esc(LABELS[k])}"></td>
          <td>${esc(LABELS[k])}</td>
          <td>${usable ? esc(shown(k, f.value)) : `<span class="muted">—</span>`}</td>
          <td>${statusBadge(f.status)}</td>
          <td>${usable ? pct(f.confidence) : ""}</td>
          <td class="small muted">${esc([f.evidence, photosText(f.photos)].filter(Boolean).join(" · "))}</td></tr>`;
      })
      .join("");
    const features = result.features
      .map(
        (f, i) =>
          `<label class="small" style="display:block"><input type="checkbox" data-ai-feature="${i}" ${f.status === "observed" && f.confidence >= PRE_TICK ? "checked" : ""}> ${esc(f.name)} ${statusBadge(f.status)} ${pct(f.confidence)} <span class="muted">${esc(photosText(f.photos))}</span></label>`
      )
      .join("");
    const damage = result.damage
      .map((d) => `<li>${esc(d.area)}: ${esc(d.description)} <span class="muted">(${esc(d.severity)}, ${pct(d.confidence)}, ${esc(photosText(d.photos))})</span></li>`)
      .join("");
    $("ai-out").innerHTML = `
      ${result.warnings.map((w) => `<p class="small" role="note">⚠ ${esc(w)}</p>`).join("")}
      <table class="table"><thead><tr><th></th><th>Field</th><th>AI reading</th><th>Status</th><th>Confidence</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table>
      <h4>Visible features</h4>${features || `<p class="small muted">None identified.</p>`}
      <h4>Visible damage</h4>${damage ? `<ul class="small">${damage}</ul>` : `<p class="small muted">None identified in these photos. This does not mean the car is undamaged.</p>`}
      <h4>Draft description</h4>
      <textarea id="ai-desc" rows="4">${esc(result.description)}</textarea>
      <label class="small"><input type="checkbox" id="ai-use-desc"> Use this description</label>
      <label class="small" style="display:block"><input type="checkbox" id="ai-gallery"> Also add these ${files.length} photos to the gallery</label>
      <p class="small muted">Read by ${esc(result.model)}. Nothing is saved until you save the car.</p>
      <button type="button" class="btn btn-sm btn-primary" id="ai-fill">Fill the form with ticked values</button>`;
    $("ai-fill").addEventListener("click", fill);
  }

  function fill() {
    const notes = [];
    document.querySelectorAll("[data-ai-field]:checked").forEach((box) => {
      const k = box.dataset.aiField;
      const v = result.fields[k].value;
      if (k === "make") {
        const brand = brands.find((b) => String(b.name || "").toLowerCase() === String(v).toLowerCase());
        if (!brand) return notes.push(`Brand "${v}" is not in the brand list; add it first, then pick it.`);
        $("brandId").value = brand.id;
        applied.make = brand.id;
        return;
      }
      const el = $(CONTROL[k]);
      if (!el) return;
      el.value = String(v);
      applied[k] = el.value;
    });
    for (const box of document.querySelectorAll("[data-ai-feature]:checked")) {
      const name = result.features[Number(box.dataset.aiFeature)].name;
      const have = [...document.querySelectorAll("#features [data-f]")].some((i) => i.value.trim().toLowerCase() === name.toLowerCase());
      if (!have) {
        $("add-feature").click(); // the form's own "Add feature" row
        document.querySelector("#features .list-row:last-child [data-f]").value = name;
      }
      appliedFeatures.add(name);
    }
    if ($("ai-use-desc").checked) {
      $("description").value = $("ai-desc").value.trim();
      appliedDescription = $("description").value;
    }
    if ($("ai-gallery").checked) {
      // Reuses the form's own gallery picker, so upload and removal work as usual.
      const input = document.querySelector('[data-img="gallery"]');
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(f));
      input.files = dt.files;
      input.dispatchEvent(new Event("change"));
      $("ai-gallery").checked = false;
    }
    // AI output is never published by itself.
    $("status").value = "draft";
    $("ai-st").textContent = [`Filled in. The car is set to Draft. Check every value, then save.`, ...notes].join(" ");
  }

  return {
    kept() {
      if (!result) return null;
      const provenance = {};
      const keptFields = [];
      for (const [k, value] of Object.entries(applied)) {
        const id = k === "make" ? "brandId" : CONTROL[k];
        if ($(id)?.value !== value) continue; // the admin changed it: theirs, not the AI's
        keptFields.push(k);
        provenance[k === "make" ? "brandId" : k] = "ai-photo";
      }
      const features = [...document.querySelectorAll("#features [data-f]")].map((i) => i.value.trim());
      const keptFeatures = [...appliedFeatures].filter((n) => features.includes(n));
      const keptDescription = appliedDescription !== null && $("description").value === appliedDescription;
      if (keptDescription) provenance.description = "ai-photo";
      if (!keptFields.length && !keptFeatures.length && !keptDescription) return null;
      return {
        provenance,
        record: {
          model: result.model,
          analysedAt: result.analysedAt,
          photoCount: result.photoCount,
          fields: result.fields,
          features: result.features,
          damage: result.damage,
          warnings: result.warnings,
          keptFields,
          keptFeatures,
          keptDescription,
          reviewedAt: new Date().toISOString(),
        },
      };
    },
  };
}
