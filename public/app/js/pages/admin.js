// ---------------------------------------------------------------------------
// Admin dashboard: brands, cars, media, 3D models, inquiries, chats, settings.
// Everything is stored in Firestore / Firebase Storage — no hardcoded data.
// ---------------------------------------------------------------------------
import { auth } from "../config/firebase.js";
import {
  onAuthStateChanged,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { esc, money, toast, initTheme, toggleTheme } from "../components/layout.js";
import { carTitle } from "../components/car-card.js";
import * as store from "../core/store.js";
import { matchesBrand } from "../core/catalog.js";
import { initAnimations } from "../features/animate.js";
import { isDemoAdmin, demoSignOut } from "../features/demo-admin.js";

initTheme();
initAnimations();

// The admin shell is static markup, so its toggle is wired here rather than
// coming from renderLayout().
document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);

const view = document.getElementById("view");
const modalBack = document.getElementById("modal-back");
const modal = document.getElementById("modal");

const openModal = (html) => {
  modal.innerHTML = html;
  modalBack.classList.add("open");
};
const closeModal = () => {
  modalBack.classList.remove("open");
  modal.innerHTML = "";
};
modalBack.addEventListener("click", (e) => {
  if (e.target === modalBack) closeModal();
});
// Row / image removal for any form (modal *or* the settings page). Bound once.
document.addEventListener("click", (e) => {
  if (e.target.matches("[data-rmrow]")) e.target.closest(".kv-row, .list-row")?.remove();
  if (e.target.matches("[data-rmimg]")) e.target.closest(".item")?.remove();
});

/* --------------------- single-image field (logo/banner) ---------------- */
// Markup + preview wiring shared by brand logo and the settings logo/banner.
const imageField = (id, label, url) => `
  <div class="field"><label>${label}</label>
    <input type="file" id="${id}" accept="image/*">
    <div class="thumb-row" data-single="${id}">
      ${url ? `<div class="item" data-url="${esc(url)}"><img src="${esc(url)}" alt=""><button type="button" data-rmimg>×</button></div>` : ""}
    </div>
  </div>`;

function bindImageField(id) {
  const input = document.getElementById(id);
  const row = document.querySelector(`[data-single="${id}"]`);
  input.addEventListener("change", () => {
    const file = input.files[0];
    if (!file) return;
    row.innerHTML = `<div class="item"><img alt=""><button type="button" data-rmimg>×</button></div>`;
    const item = row.firstElementChild;
    item.querySelector("img").src = URL.createObjectURL(file);
    item._file = file;
    input.value = "";
  });
}

// Returns the File to upload, the kept URL, or null when the image was removed.
function readImageField(id) {
  const item = document.querySelector(`[data-single="${id}"] .item`);
  if (!item) return { file: null, url: null };
  return { file: item._file || null, url: item.dataset.url || null };
}

document.getElementById("logout").addEventListener("click", async (e) => {
  e.preventDefault();
  demoSignOut();
  await signOut(auth).catch(() => {});
  location.replace("../pages/admin-login.html");
});

/* ------------------------------- router -------------------------------- */
const ROUTES = { dashboard, brands, cars, customers, chats, settings };
function route() {
  const key = (location.hash.replace("#", "") || "dashboard").split("?")[0];
  document
    .querySelectorAll("#admin-nav a")
    .forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + key));
  (ROUTES[key] || dashboard)();
}

const head = (title, actions = "") =>
  `<div class="admin-head"><h1 style="font-size:1.5rem">${title}</h1><div class="row-actions">${actions}</div></div>`;

/* ----------------------------- auth guard ------------------------------ */
// Must run after ROUTES is initialised — demo mode routes synchronously.
const startRouting = () => {
  window.addEventListener("hashchange", route);
  route();
};

if (isDemoAdmin()) {
  startRouting();
} else {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      location.replace("../pages/admin-login.html");
      return;
    }
    if (!(await store.isAdmin(user.uid))) {
      await signOut(auth);
      location.replace("../pages/admin-login.html");
      return;
    }
    startRouting();
  });
}

/* ------------------------------ dashboard ------------------------------ */
async function dashboard() {
  view.innerHTML = head("Dashboard") + `<p class="muted">Loading…</p>`;
  const [b, c, i, ch] = await Promise.all([
    store.listBrands(),
    store.listCars({ publishedOnly: false }),
    store.listInquiries(),
    store.listChats(),
  ]);
  const stat = (n, l) => `<div class="card stat"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const recent = [
    ...i.slice(0, 5).map((x) => [x.createdAtMs, `Enquiry from ${x.name || "visitor"}${x.carName ? ` about ${x.carName}` : ""}`]),
    ...ch.slice(0, 5).map((x) => [x.createdAtMs, `AI chat: ${(x.question || "").slice(0, 60)}`]),
  ]
    .sort((a, z) => (z[0] || 0) - (a[0] || 0))
    .slice(0, 8);

  view.innerHTML =
    head("Dashboard") +
    `<div class="stats">
      ${stat(b.length, "Brands")}
      ${stat(c.length, "Cars")}
      ${stat(c.filter((x) => x.status === "published").length, "Published")}
      ${stat(c.filter((x) => x.status !== "published").length, "Drafts")}
      ${stat(i.length, "Inquiries")}
      ${stat(ch.length, "AI chats")}
    </div>
    <div class="divider"></div>
    <h2>Recent activity</h2>
    ${
      recent.length
        ? `<table class="table"><tbody>${recent
            .map(
              ([t, text]) =>
                `<tr><td>${esc(text)}</td><td class="muted small">${t ? new Date(t).toLocaleString() : ""}</td></tr>`
            )
            .join("")}</tbody></table>`
        : `<div class="empty">No activity yet.</div>`
    }`;
}

/* -------------------------------- brands ------------------------------- */
async function brands() {
  view.innerHTML = head(
    "Brands",
    `<button class="btn btn-primary btn-sm" id="add">Add brand</button>`
  );
  document.getElementById("add").addEventListener("click", () => brandForm());
  const list = await store.listBrands();
  const box = document.createElement("div");
  box.innerHTML = list.length
    ? `<table class="table"><thead><tr><th>Logo</th><th>Name</th><th>Country</th><th>Featured</th><th></th></tr></thead>
       <tbody>${list
         .map(
          (b) => `<tr>
          <td>${b.logoUrl ? `<img src="${esc(b.logoUrl)}" alt="" style="height:26px">` : "—"}</td>
          <td>${esc(b.name || "")}</td><td>${esc(b.country || "—")}</td>
          <td>${b.featured ? `<span class="badge">Featured</span>` : "—"}</td>
          <td><div class="row-actions">
            <button class="btn btn-sm" data-edit="${esc(b.id)}">Edit</button>
            <button class="btn btn-sm btn-ghost" data-del="${esc(b.id)}">Delete</button>
          </div></td></tr>`
         )
         .join("")}</tbody></table>`
    : `<div class="empty">No brands yet. Add your first brand.</div>`;
  view.appendChild(box);
  box.querySelectorAll("[data-edit]").forEach((btn) =>
    btn.addEventListener("click", () => brandForm(list.find((b) => b.id === btn.dataset.edit)))
  );
  box.querySelectorAll("[data-del]").forEach((btn) =>
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this brand?")) return;
      await store.deleteBrand(btn.dataset.del);
      toast("Brand deleted");
      brands();
    })
  );
}

function brandForm(brand = null) {
  openModal(`
    <h2>${brand ? "Edit" : "Add"} brand</h2>
    <form id="bf">
      <div class="grid-2">
        <div class="field"><label>Brand name</label><input id="name" required value="${esc(brand?.name || "")}"></div>
        <div class="field"><label>Country</label><input id="country" value="${esc(brand?.country || "")}"></div>
      </div>
      <div class="field"><label>Description</label><textarea id="description">${esc(brand?.description || "")}</textarea></div>
      ${imageField("logo", `Logo <span class="muted small">(brand-logos)</span>`, brand?.logoUrl)}
      <div class="field checkbox"><input type="checkbox" id="featured" ${brand?.featured ? "checked" : ""}><label for="featured" style="margin:0">Featured brand</label></div>
      <div class="row-actions"><button class="btn btn-primary" type="submit" id="save">Save</button>
      <button class="btn btn-ghost" type="button" id="cancel">Cancel</button></div>
      <p class="small" id="st"></p>
    </form>`);
  document.getElementById("cancel").addEventListener("click", closeModal);
  bindImageField("logo");
  document.getElementById("bf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = document.getElementById("st");
    document.getElementById("save").disabled = true;
    try {
      st.textContent = "Saving…";
      const data = {
        name: document.getElementById("name").value.trim(),
        country: document.getElementById("country").value.trim(),
        description: document.getElementById("description").value.trim(),
        featured: document.getElementById("featured").checked,
      };
      const logo = readImageField("logo");
      if (logo.file) {
        st.textContent = "Uploading logo…";
        const up = await store.uploadFile("brand-logos", logo.file);
        data.logoUrl = up.url;
        data.logoPath = up.path;
      } else {
        data.logoUrl = logo.url; // null when the admin removed it
      }
      await store.saveBrand(data, brand?.id);
      closeModal();
      toast("Brand saved");
      brands();
    } catch (err) {
      console.error(err);
      st.textContent = "Save failed: " + err.message;
      document.getElementById("save").disabled = false;
    }
  });
}

/* --------------------------------- cars -------------------------------- */
async function cars() {
  view.innerHTML = head(
    "Cars",
    `<button class="btn btn-primary btn-sm" id="add">Add car</button>`
  );
  document.getElementById("add").addEventListener("click", () => carForm());
  const [list, brandList] = await Promise.all([
    store.listCars({ publishedOnly: false }),
    store.listBrands(),
  ]);
  const box = document.createElement("div");
  box.innerHTML = list.length
    ? `<table class="table"><thead><tr><th>Car</th><th>Price</th><th>Year</th><th>Status</th><th></th></tr></thead>
      <tbody>${list
        .map(
          (c) => `<tr>
        <td>${esc(carTitle(c))} ${c.featured ? `<span class="badge">Featured</span>` : ""}</td>
        <td>${money(c.price)}</td><td>${esc(c.year || "—")}</td>
        <td><span class="badge">${c.status === "published" ? "Published" : "Draft"}</span></td>
        <td><div class="row-actions">
          <button class="btn btn-sm" data-edit="${esc(c.id)}">Edit</button>
          <button class="btn btn-sm" data-pub="${esc(c.id)}">${c.status === "published" ? "Unpublish" : "Publish"}</button>
          <button class="btn btn-sm btn-ghost" data-del="${esc(c.id)}">Delete</button>
        </div></td></tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="empty">No cars yet. Add your first car.</div>`;
  view.appendChild(box);
  box.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => carForm(list.find((c) => c.id === b.dataset.edit), brandList))
  );
  box.querySelectorAll("[data-pub]").forEach((b) =>
    b.addEventListener("click", async () => {
      const car = list.find((c) => c.id === b.dataset.pub);
      await store.saveCar({ status: car.status === "published" ? "draft" : "published" }, car.id);
      toast("Status updated");
      cars();
    })
  );
  box.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this car?")) return;
      await store.deleteCar(b.dataset.del);
      toast("Car deleted");
      cars();
    })
  );
}

const SIMPLE_FIELDS = [
  ["model", "Model", "text"],
  ["variant", "Variant", "text"],
  ["year", "Year", "number"],
  ["price", "Price", "number"],
  ["fuelType", "Fuel type", "text"],
  ["transmission", "Transmission", "text"],
  ["engine", "Engine", "text"],
  ["mileage", "Mileage", "text"],
  ["horsepower", "Horsepower", "text"],
  ["torque", "Torque", "text"],
  ["seats", "Seats", "number"],
  ["bootSpace", "Boot space", "text"],
  ["groundClearance", "Ground clearance", "text"],
];

// A full URL, or a site-relative path so images committed under
// public/app/uploads/ can be used without Firebase Storage.
const IMAGE_REF = /^(https?:\/\/|\/)/i;

const IMAGE_GROUPS = [
  ["mainImage", "Main image", "car-images", false],
  ["thumbnail", "Thumbnail", "thumbnails", false],
  ["gallery", "Gallery", "car-gallery", true],
  ["interior", "Interior images", "car-interior", true],
  ["exterior", "Exterior images", "car-exterior", true],
];

async function carForm(car = null, brandList = null) {
  const brandsAvailable = brandList || (await store.listBrands());
  const specs = Object.entries(car?.specifications || {});
  const features = car?.features || [];

  openModal(`
    <h2>${car ? "Edit" : "Add"} car</h2>
    <form id="cf">
      <div class="field"><label>Brand</label>
        <select id="brandId" required>
          <option value="">Select brand</option>
          ${brandsAvailable
            .map(
              // Seeded cars store a slug ("koenigsegg") rather than the brand
              // doc id, so fall back to the same name match the catalog uses.
              (b) =>
                `<option value="${esc(b.id)}" ${car && matchesBrand(car, b) ? "selected" : ""}>${esc(b.name || b.id)}</option>`
            )
            .join("")}
        </select>
        ${brandsAvailable.length ? "" : `<p class="small">Add a brand first.</p>`}
      </div>
      <div class="grid-2">
        ${SIMPLE_FIELDS.map(
          ([k, l, t]) =>
            `<div class="field"><label>${l}</label><input id="${k}" type="${t}" value="${esc(car?.[k] ?? "")}"></div>`
        ).join("")}
      </div>
      <div class="field"><label>Description</label><textarea id="description">${esc(car?.description || "")}</textarea></div>

      <div class="divider"></div>
      <h3>Specifications (unlimited)</h3>
      <div id="specs">${specs.map(([k, v]) => kvRow(k, v)).join("")}</div>
      <button class="btn btn-sm" type="button" id="add-spec">Add specification</button>

      <div class="divider"></div>
      <h3>Features (unlimited)</h3>
      <div id="features">${features.map((f) => listRow(f)).join("")}</div>
      <button class="btn btn-sm" type="button" id="add-feature">Add feature</button>

      <div class="divider"></div>
      <h3>Images</h3>
      ${IMAGE_GROUPS.map(
        ([key, label, folder, multi]) => `
        <div class="field">
          <label>${label} <span class="muted small">(${folder})</span></label>
          <input type="file" accept="image/*" data-img="${key}" ${multi ? "multiple" : ""}>
          <textarea data-imgurl="${key}" rows="2" placeholder="Or paste image URL${multi ? "s (one per line)" : ""} — works without Storage"></textarea>
          <div class="thumb-row" data-existing="${key}">
            ${[]
              .concat(car?.[key] || [])
              .filter(Boolean)
              .map(
                (url) =>
                  `<div class="item" data-url="${esc(url)}"><img src="${esc(url)}" alt=""><button type="button" data-rmimg>×</button></div>`
              )
              .join("")}
          </div>
          <div class="thumb-row" data-pending="${key}"></div>
        </div>`
      ).join("")}

      <div class="divider"></div>
      <h3>3D model (GLB / GLTF)</h3>
      <div class="field">
        <input type="file" id="model-file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json">
        ${car?.modelUrl ? `<p class="small">Current model uploaded. <button type="button" class="btn btn-sm btn-ghost" id="rm-model">Remove</button></p>` : ""}
      </div>

      <div class="divider"></div>
      <div class="grid-2">
        <div class="field"><label>Availability</label>
          <select id="availability">
            <option value="in-stock" ${(car?.availability || "in-stock") === "in-stock" ? "selected" : ""}>In stock</option>
            <option value="reserved" ${car?.availability === "reserved" ? "selected" : ""}>Reserved</option>
            <option value="sold" ${car?.availability === "sold" ? "selected" : ""}>Sold</option>
          </select>
        </div>
        <div class="field"><label>Status</label>
          <select id="status">
            <option value="published" ${car?.status === "published" ? "selected" : ""}>Published</option>
            <option value="draft" ${car?.status !== "published" ? "selected" : ""}>Draft</option>
          </select>
        </div>
        <div class="field checkbox" style="align-self:end"><input type="checkbox" id="featured" ${car?.featured ? "checked" : ""}><label for="featured" style="margin:0">Featured car</label></div>
      </div>
      <div class="row-actions"><button class="btn btn-primary" type="submit" id="save">Save car</button>
      <button class="btn btn-ghost" type="button" id="cancel">Cancel</button></div>
      <p class="small" id="st"></p>
    </form>`);

  // Live thumbnails for freshly picked files. The File rides on the element
  // itself, so the shared [data-rmimg] handler also un-queues the upload.
  for (const [key, , , multi] of IMAGE_GROUPS) {
    const input = document.querySelector(`[data-img="${key}"]`);
    const pending = document.querySelector(`[data-pending="${key}"]`);
    input.addEventListener("change", () => {
      if (!multi) pending.innerHTML = "";
      for (const file of input.files) {
        const item = document.createElement("div");
        item.className = "item";
        item.innerHTML = `<img alt=""><button type="button" data-rmimg>×</button>`;
        item.querySelector("img").src = URL.createObjectURL(file);
        item._file = file;
        pending.appendChild(item);
      }
      input.value = ""; // so re-picking the same file still fires change
    });

    // Pasted URLs become real thumbnails once the field loses focus.
    const urlBox = document.querySelector(`[data-imgurl="${key}"]`);
    const existing = document.querySelector(`[data-existing="${key}"]`);
    urlBox.addEventListener("change", () => {
      const urls = urlBox.value
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => IMAGE_REF.test(s));
      if (!urls.length) return;
      if (!multi) existing.innerHTML = "";
      for (const url of multi ? urls : urls.slice(-1)) {
        existing.insertAdjacentHTML(
          "beforeend",
          `<div class="item" data-url="${esc(url)}"><img src="${esc(url)}" alt=""><button type="button" data-rmimg>×</button></div>`
        );
      }
      urlBox.value = "";
    });
  }

  let removeModel = false;
  document.getElementById("rm-model")?.addEventListener("click", (e) => {
    removeModel = true;
    e.target.textContent = "Will be removed on save";
    e.target.disabled = true;
  });
  document.getElementById("cancel").addEventListener("click", closeModal);
  document.getElementById("add-spec").addEventListener("click", () => {
    document.getElementById("specs").insertAdjacentHTML("beforeend", kvRow("", ""));
  });
  document.getElementById("add-feature").addEventListener("click", () => {
    document.getElementById("features").insertAdjacentHTML("beforeend", listRow(""));
  });
  document.getElementById("cf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = document.getElementById("st");
    const saveBtn = document.getElementById("save");
    saveBtn.disabled = true;
    try {
      st.textContent = "Saving…";
      const brandId = document.getElementById("brandId").value;
      const brand = brandsAvailable.find((b) => b.id === brandId);
      const data = { brandId, brandName: brand?.name || "" };
      SIMPLE_FIELDS.forEach(([k, , t]) => {
        const raw = document.getElementById(k).value.trim();
        data[k] = raw === "" ? null : t === "number" ? Number(raw) : raw;
      });
      data.description = document.getElementById("description").value.trim();
      data.status = document.getElementById("status").value;
      data.availability = document.getElementById("availability").value;
      data.featured = document.getElementById("featured").checked;

      data.specifications = {};
      document.querySelectorAll("#specs .kv-row").forEach((r) => {
        const k = r.querySelector("[data-k]").value.trim();
        const v = r.querySelector("[data-v]").value.trim();
        if (k) data.specifications[k] = v;
      });
      data.features = [...document.querySelectorAll("#features [data-f]")]
        .map((i) => i.value.trim())
        .filter(Boolean);

      for (const [key, label, folder, multi] of IMAGE_GROUPS) {
        const kept = [...document.querySelectorAll(`[data-existing="${key}"] .item`)].map(
          (i) => i.dataset.url
        );
        const queued = [...document.querySelectorAll(`[data-pending="${key}"] .item`)];
        const uploaded = [];
        for (const item of queued) {
          st.textContent = `Uploading ${label}…`;
          uploaded.push((await store.uploadFile(folder, item._file)).url);
        }
        const pasted = (document.querySelector(`[data-imgurl="${key}"]`)?.value || "")
          .split(/[\n,]+/)
          .map((s) => s.trim())
          .filter((s) => IMAGE_REF.test(s));
        const all = [...kept, ...uploaded, ...pasted];
        data[key] = multi ? all : all[all.length - 1] || null;
      }

      // NB: not "model" — that id belongs to the car's Model text field.
      const modelFile = document.getElementById("model-file").files[0];
      if (modelFile) {
        st.textContent = "Uploading 3D model…";
        const up = await store.uploadFile("3d-models", modelFile);
        data.modelUrl = up.url;
        data.modelPath = up.path;
      } else if (removeModel) {
        data.modelUrl = null;
        data.modelPath = null;
      }

      st.textContent = "Saving car…";
      await store.saveCar(data, car?.id);
      closeModal();
      toast("Car saved");
      cars();
    } catch (err) {
      console.error(err);
      st.textContent = "Save failed: " + err.message;
      saveBtn.disabled = false;
    }
  });
}

const kvRow = (k, v) => `<div class="kv-row">
  <input data-k placeholder="Specification name" value="${esc(k)}">
  <input data-v placeholder="Value" value="${esc(v)}">
  <button class="btn btn-sm btn-ghost" type="button" data-rmrow>Remove</button></div>`;

const listRow = (f) => `<div class="list-row">
  <input data-f placeholder="Feature" value="${esc(f)}">
  <button class="btn btn-sm btn-ghost" type="button" data-rmrow>Remove</button></div>`;

/* ------------------------------ customers ------------------------------ */
async function customers() {
  view.innerHTML =
    head("Customer inquiries") +
    `<div class="field"><input id="q" placeholder="Search name, email, phone or car…"></div><div id="out"></div>`;
  const all = await store.listInquiries();
  const out = document.getElementById("out");

  function draw() {
    const q = document.getElementById("q").value.trim().toLowerCase();
    const list = all.filter((i) =>
      [i.name, i.email, i.phone, i.carName, i.message].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
    out.innerHTML = list.length
      ? `<table class="table"><thead><tr><th>Name</th><th>Contact</th><th>Car</th><th>Message</th><th>Status</th><th></th></tr></thead>
        <tbody>${list
          .map(
            (i) => `<tr>
          <td>${esc(i.name || "")}<div class="muted small">${i.createdAtMs ? new Date(i.createdAtMs).toLocaleString() : ""}</div></td>
          <td class="small">${esc(i.email || "")}<br>${esc(i.phone || "")}</td>
          <td class="small">${esc(i.carName || "—")}</td>
          <td class="small">${esc(i.message || "")}</td>
          <td><select data-status="${esc(i.id)}">
            ${["new", "contacted", "closed"]
              .map((s) => `<option value="${s}" ${i.status === s ? "selected" : ""}>${s}</option>`)
              .join("")}
          </select></td>
          <td><button class="btn btn-sm btn-ghost" data-del="${esc(i.id)}">Delete</button></td></tr>`
          )
          .join("")}</tbody></table>`
      : `<div class="empty">No inquiries found.</div>`;

    out.querySelectorAll("[data-status]").forEach((s) =>
      s.addEventListener("change", async () => {
        await store.updateInquiry(s.dataset.status, { status: s.value });
        toast("Status updated");
      })
    );
    out.querySelectorAll("[data-del]").forEach((b) =>
      b.addEventListener("click", async () => {
        if (!confirm("Delete this inquiry?")) return;
        await store.deleteInquiry(b.dataset.del);
        toast("Deleted");
        customers();
      })
    );
  }
  document.getElementById("q").addEventListener("input", draw);
  draw();
}

/* -------------------------------- chats -------------------------------- */
async function chats() {
  view.innerHTML = head("AI chats", `<button class="btn btn-sm" id="export">Export JSON</button>`);
  const list = await store.listChats();
  document.getElementById("export").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `ai-chats-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  const box = document.createElement("div");
  box.innerHTML = list.length
    ? `<table class="table"><thead><tr><th>When</th><th>Question</th><th>Answer</th><th></th></tr></thead>
      <tbody>${list
        .map(
          (c) => `<tr>
        <td class="small muted">${c.createdAtMs ? new Date(c.createdAtMs).toLocaleString() : ""}</td>
        <td class="small">${esc(c.question || "")}</td>
        <td class="small">${esc(c.answer || "")}</td>
        <td><button class="btn btn-sm btn-ghost" data-del="${esc(c.id)}">Delete</button></td></tr>`
        )
        .join("")}</tbody></table>`
    : `<div class="empty">No conversations yet.</div>`;
  view.appendChild(box);
  box.querySelectorAll("[data-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("Delete this conversation?")) return;
      await store.deleteChat(b.dataset.del);
      toast("Deleted");
      chats();
    })
  );
}

/* ------------------------------- settings ------------------------------ */
async function settings() {
  const s = await store.getSettings();
  const soc = s.socialLinks || {};
  view.innerHTML =
    head("Settings") +
    `<form class="card card-pad" id="sf" style="max-width:720px">
      <div class="grid-2">
        <div class="field"><label>Website name</label><input id="siteName" value="${esc(s.siteName || "")}"></div>
        <div class="field"><label>Contact email</label><input id="contactEmail" value="${esc(s.contactEmail || "")}"></div>
        <div class="field"><label>Contact phone</label><input id="contactPhone" value="${esc(s.contactPhone || "")}"></div>
        <div class="field"><label>Address</label><input id="contactAddress" value="${esc(s.contactAddress || "")}"></div>
        <div class="field"><label>Hero title</label><input id="heroTitle" value="${esc(s.heroTitle || "")}"></div>
        <div class="field"><label>Hero subtitle</label><input id="heroSubtitle" value="${esc(s.heroSubtitle || "")}"></div>
        <div class="field"><label>Instagram</label><input id="s-instagram" value="${esc(soc.instagram || "")}"></div>
        <div class="field"><label>Facebook</label><input id="s-facebook" value="${esc(soc.facebook || "")}"></div>
        <div class="field"><label>YouTube</label><input id="s-youtube" value="${esc(soc.youtube || "")}"></div>
        <div class="field"><label>LinkedIn</label><input id="s-linkedin" value="${esc(soc.linkedin || "")}"></div>
      </div>
      <div class="field"><label>Footer text</label><textarea id="footerText">${esc(s.footerText || "")}</textarea></div>
      ${imageField("logo", "Logo", s.logoUrl)}
      ${imageField("banner", "Homepage banner", s.bannerUrl)}
      <button class="btn btn-primary" type="submit" id="save">Save settings</button>
      <p class="small" id="st"></p>
    </form>`;

  bindImageField("logo");
  bindImageField("banner");
  document.getElementById("sf").addEventListener("submit", async (e) => {
    e.preventDefault();
    const st = document.getElementById("st");
    document.getElementById("save").disabled = true;
    try {
      st.textContent = "Saving…";
      const val = (id) => document.getElementById(id).value.trim();
      const data = {
        siteName: val("siteName"),
        contactEmail: val("contactEmail"),
        contactPhone: val("contactPhone"),
        contactAddress: val("contactAddress"),
        heroTitle: val("heroTitle"),
        heroSubtitle: val("heroSubtitle"),
        footerText: val("footerText"),
        socialLinks: {
          instagram: val("s-instagram"),
          facebook: val("s-facebook"),
          youtube: val("s-youtube"),
          linkedin: val("s-linkedin"),
        },
      };
      const logo = readImageField("logo");
      data.logoUrl = logo.file
        ? (await store.uploadFile("brand-logos", logo.file)).url
        : logo.url;
      const banner = readImageField("banner");
      data.bannerUrl = banner.file
        ? (await store.uploadFile("car-images", banner.file)).url
        : banner.url;
      await store.saveSettings(data);
      st.textContent = "Saved.";
      toast("Settings saved");
    } catch (err) {
      console.error(err);
      st.textContent = "Save failed: " + err.message;
    } finally {
      document.getElementById("save").disabled = false;
    }
  });
}