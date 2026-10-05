import { renderLayout, esc, money, toast } from "../components/layout.js";
import { carTitle, carCover } from "../components/car-card.js";
import { getCar, toggleWishlist, toggleCompare, listWishlist, listCompare } from "../core/store.js";
import { requireUser, cachedUser, currentUser } from "../core/user-auth.js";
import * as F from "../core/car-fields.js";
import { mountChatbot } from "../features/chatbot.js";
import { fallbackCarById } from "../data/fallback-cars.js";
import { loadCatalog, availabilityOf, availabilityLabel } from "../core/catalog.js";
import { modelView } from "../core/model-source.js";
import { embedFrame } from "../features/sketchfab-import.js";

(async function init() {
  await renderLayout({ base: "../", active: "Cars" });
  // Questions asked on this page are about this car: the Worker sees its id
  // and answers from this car's record only.
  const chat = mountChatbot({ carId: new URLSearchParams(location.search).get("id") });
  const box = document.getElementById("detail");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    box.innerHTML = `<div class="empty">No car selected. <a href="cars.html" style="text-decoration:underline">Browse all cars</a></div>`;
    return;
  }
  let car = await getCar(id);
  if (!car) {
    const catalog = await loadCatalog().catch(() => ({ cars: [] }));
    car = (catalog.cars || []).find((c) => c.id === id) || fallbackCarById(id);
  }
  if (!car || car.status !== "published") {
    box.innerHTML = `<div class="empty">This car is not available.</div>`;
    return;
  }
  document.title = `${carTitle(car)} — Specifications & 3D View`;

  const uniq = (a) => a.filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i);
  const interiorShots = uniq(car.interior || []);
  const exteriorShots = uniq([carCover(car), ...(car.exterior || []), ...(car.gallery || [])]).filter(
    (u) => !interiorShots.includes(u)
  );
  const images = [...exteriorShots, ...interiorShots];
  const thumbGroup = (label, list, offset) =>
    list.length
      ? `<div class="thumb-group"><div class="thumb-head"><div class="small thumb-label">${esc(label)} · ${list.length} ${
          list.length === 1 ? "image" : "images"
        }</div>${
          label === "Exterior" && list.length > 1
            ? `<button class="btn btn-sm btn-ghost" id="all-ext">View all exterior angles</button>`
            : ""
        }</div>
         <div class="gallery-thumbs">${list
           .map(
             (src, i) =>
               `<img src="${esc(src)}" data-i="${offset + i}" class="${offset + i === 0 ? "active" : ""}" loading="lazy" alt="${esc(
                 `${carTitle(car)} ${label.toLowerCase()} view ${i + 1}`
               )}">`
           )
           .join("")}</div>${
          label === "Exterior" && list.length > 1
            ? `<div class="ext-grid" id="ext-grid" hidden>${list
                .map(
                  (src, i) =>
                    `<figure><img src="${esc(src)}" loading="lazy" alt="${esc(
                      `${carTitle(car)} exterior angle ${i + 1}`
                    )}"><figcaption class="small">Angle ${i + 1} of ${list.length}</figcaption></figure>`
                )
                .join("")}</div>`
            : ""
        }</div>`
      : "";

  // Two kinds of row. "optional" rows are left out when empty, as before.
  // "always" rows show "Not provided" (or "Not confirmed" for a data conflict)
  // rather than a guess. Specification-map keys these rows already cover are
  // dropped by F.extraSpecs, which keeps the placeholder odometers and the
  // conflicting duplicates off the page.
  const optional = (k, v) => ["optional", k, v];
  const always = (k, text, conflict = false) => ["always", k, F.orNotProvided(text, conflict)];
  const specRows = [
    optional("Brand", car.brandName),
    optional("Model", car.model),
    optional("Variant", car.variant),
    optional("Year", car.year),
    always("Body type", F.bodyTypeText(car)),
    always("Fuel type", F.fuelText(car), F.fuelConflict(car)),
    always("Transmission", F.transmissionText(car), F.transmissionConflict(car)),
    optional("Engine", car.engine),
    always("Fuel economy", F.fuelEconomyText(car)),
    always("Kilometres driven", F.kmDrivenText(car)),
    always("Power", F.powerText(car)),
    optional("Torque", car.torque),
    optional("Seats", car.seats),
    always("Boot capacity", F.bootText(car)),
    always("Ground clearance", F.groundClearanceText(car)),
    always("Colour", F.colourText(car)),
    always("Owners", F.ownersText(car)),
    always("Airbags", F.airbagsText(car)),
    always("NCAP rating", F.ncapText(car)),
    ...F.extraSpecs(car).map(([k, v]) => optional(k, v)),
  ]
    .filter(([kind, , v]) => kind === "always" || !(v === undefined || v === null || v === ""))
    .map(([, k, v]) => {
      const missing = v === F.NOT_PROVIDED || v === F.NOT_CONFIRMED;
      return `<tr><td>${esc(k)}</td><td${missing ? ' class="muted"' : ""}>${esc(v)}</td></tr>`;
    })
    .join("");

  box.innerHTML = `
    <div class="section-head">
      <div>
        <div class="car-brand">${esc(car.brandName || "")}</div>
        <h1 style="font-size:2rem">${esc([car.model, car.variant].filter(Boolean).join(" "))}</h1>
        <div class="small">${esc(availabilityLabel(availabilityOf(car)))}${car.year ? ` · ${esc(car.year)}` : ""}</div>
      </div>
      <div class="car-price" style="font-size:1.6rem">${money(car.price)}</div>
    </div>
    <div class="detail-grid">
      <div>
        ${
          images.length
            ? `<div class="gallery-main"><img id="main-img" src="${esc(images[0])}" alt="${esc(carTitle(car))}"></div>
               <div id="thumbs">
                 ${thumbGroup("Exterior", exteriorShots, 0)}
                 ${thumbGroup("Interior", interiorShots, exteriorShots.length)}
               </div>`
            : `<div class="empty">No images available.</div>`
        }
        <div id="viewer-section" style="margin-top:24px; display:none">
          <h2>3D model</h2>
          <div id="viewer-wrap">
            <canvas id="viewer-canvas"></canvas>
            <div class="viewer-hint">Drag to rotate · scroll to zoom · right-drag to pan</div>
          </div>
          <p class="small muted" id="model-credit"></p>
        </div>
        ${car.description ? `<div style="margin-top:24px"><h2>Description</h2><p>${esc(car.description)}</p></div>` : ""}
        ${
          (car.features || []).length
            ? `<div style="margin-top:24px"><h2>Features</h2><ul class="feature-list">${car.features
                .map((f) => `<li>${esc(f)}</li>`)
                .join("")}</ul></div>`
            : ""
        }
      </div>
      <aside>
        <div class="card card-pad">
          <h2>Specifications</h2>
          ${specRows ? `<table class="spec-table">${specRows}</table>` : `<p class="small">No specifications added.</p>`}
          <div style="display:grid; gap:8px; margin-top:18px">
            <button class="btn btn-primary btn-block" id="wish">Add to wishlist</button>
            <button class="btn btn-block" id="cmp">Add to compare</button>
            <button class="btn btn-block" id="ask">Ask AI about this car</button>
            <a class="btn btn-block" id="enq" href="contact.html?car=${encodeURIComponent(car.id)}">Enquire now</a>
          </div>
        </div>
      </aside>
    </div>`;

  const thumbs = document.getElementById("thumbs");
  thumbs?.addEventListener("click", (e) => {
    const t = e.target.closest("img");
    if (!t) return;
    document.getElementById("main-img").src = t.src;
    thumbs.querySelectorAll("img").forEach((i) => i.classList.toggle("active", i === t));
  });

  const allExt = document.getElementById("all-ext");
  allExt?.addEventListener("click", () => {
    const grid = document.getElementById("ext-grid");
    const open = grid.hasAttribute("hidden");
    grid.toggleAttribute("hidden", !open);
    allExt.textContent = open ? "Hide exterior angles" : "View all exterior angles";
  });

  const wishBtn = document.getElementById("wish");
  const cmpBtn = document.getElementById("cmp");
  const setState = (btn, on, onText, offText) => {
    btn.textContent = on ? onText : offText;
    btn.classList.toggle("is-active", !!on);
  };
  // Reflect what is already saved for this visitor.
  Promise.all([listWishlist().catch(() => []), listCompare().catch(() => [])]).then(([w, c]) => {
    setState(wishBtn, w.some((x) => x.carId === car.id || x.id === car.id), "In wishlist — remove", "Add to wishlist");
    setState(cmpBtn, c.some((x) => x.carId === car.id || x.id === car.id), "In compare — remove", "Add to compare");
  });
  wishBtn.addEventListener("click", async () => {
    try {
      if (!(await requireUser("../"))) return;
      const on = await toggleWishlist(car);
      setState(wishBtn, on, "In wishlist — remove", "Add to wishlist");
      toast(on ? "Added to wishlist" : "Removed from wishlist");
    } catch (e) { toast(e.message); }
  });
  cmpBtn.addEventListener("click", async () => {
    try {
      if (!(await requireUser("../"))) return;
      const on = await toggleCompare(car);
      setState(cmpBtn, on, "In compare — remove", "Add to compare");
      toast(on ? "Added to compare" : "Removed from compare");
    } catch (e) { toast(e.message); }
  });
  document.getElementById("ask").addEventListener("click", async () => {
    if (!(await requireUser("../"))) return;
    chat?.open();
    const input = document.getElementById("chat-input");
    input.value = `Tell me about the ${carTitle(car)}`;
    input.focus();
  });

  document.getElementById("enq").addEventListener("click", async (e) => {
    if (cachedUser()) return; // already signed in: follow the link as normal
    e.preventDefault();
    if (await requireUser("../")) location.href = e.currentTarget.href;
  });

  // 3D viewer only when a model exists in Firestore, and only for members.
  // Models we host: our Three.js viewer. A Sketchfab model: the official
  // Sketchfab viewer, embedded in the same fixed-height box (never a redirect).
  const model = modelView(car);
  if (model) {
    const section = document.getElementById("viewer-section");
    section.style.display = "block";
    if (!(await currentUser())) {
      section.querySelector("#viewer-wrap").innerHTML =
        `<div class="empty">Sign in to view the 3D walkaround. <a href="login.html?next=${encodeURIComponent(location.pathname + location.search)}" style="text-decoration:underline">Sign in</a></div>`;
      return;
    }
    if (model.kind === "embed") {
      document.getElementById("viewer-wrap").innerHTML = embedFrame(model.url, carTitle(car));
      // Secondary credit under the viewer: only the source link.
      document.getElementById("model-credit").innerHTML = `3D model on Sketchfab · <a href="${esc(model.sourceUrl)}" target="_blank" rel="noopener" style="text-decoration:underline">View on Sketchfab</a>`;
      return;
    }
    const canvas = document.getElementById("viewer-canvas");
    canvas.addEventListener("model-error", () => (section.style.display = "none"));
    const { initViewer } = await import("../features/viewer3d.js");
    initViewer(canvas, model.url);
  }
})();