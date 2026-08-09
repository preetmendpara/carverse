import { renderLayout, esc, money, toast } from "../components/layout.js";
import { carTitle, carCover } from "../components/car-card.js";
import { getCar, toggleWishlist, toggleCompare, listWishlist, listCompare } from "../core/store.js";
import { mountChatbot } from "../features/chatbot.js";
import { fallbackCarById } from "../data/fallback-cars.js";
import { loadCatalog, availabilityOf, availabilityLabel } from "../core/catalog.js";

(async function init() {
  await renderLayout({ base: "../", active: "Cars" });
  const chat = mountChatbot();
  const box = document.getElementById("detail");
  const id = new URLSearchParams(location.search).get("id");
  if (!id) {
    box.innerHTML = `<div class="empty">No car selected.</div>`;
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

  const specRows = Object.entries({
    Brand: car.brandName,
    Model: car.model,
    Variant: car.variant,
    Year: car.year,
    "Fuel type": car.fuelType,
    Transmission: car.transmission,
    Engine: car.engine,
    Mileage: car.mileage,
    Horsepower: car.horsepower,
    Torque: car.torque,
    Seats: car.seats,
    "Boot space": car.bootSpace,
    "Ground clearance": car.groundClearance,
    ...(car.specifications || {}),
  })
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
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
            <div class="viewer-bar"><button class="btn btn-sm" id="fs">Fullscreen</button></div>
            <div class="viewer-hint">Drag to rotate · scroll to zoom · right-drag to pan</div>
          </div>
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
            <a class="btn btn-block" href="contact.html?car=${encodeURIComponent(car.id)}">Enquire now</a>
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
      const on = await toggleWishlist(car);
      setState(wishBtn, on, "In wishlist — remove", "Add to wishlist");
      toast(on ? "Added to wishlist" : "Removed from wishlist");
    } catch (e) { toast(e.message); }
  });
  cmpBtn.addEventListener("click", async () => {
    try {
      const on = await toggleCompare(car);
      setState(cmpBtn, on, "In compare — remove", "Add to compare");
      toast(on ? "Added to compare" : "Removed from compare");
    } catch (e) { toast(e.message); }
  });
  document.getElementById("ask").addEventListener("click", () => {
    chat?.open();
    const input = document.getElementById("chat-input");
    input.value = `Tell me about the ${carTitle(car)}`;
    input.focus();
  });

  // 3D viewer only when a model URL exists in Firestore.
  if (car.modelUrl) {
    const section = document.getElementById("viewer-section");
    section.style.display = "block";
    const canvas = document.getElementById("viewer-canvas");
    canvas.addEventListener("model-error", () => (section.style.display = "none"));
    const { initViewer } = await import("../features/viewer3d.js");
    initViewer(canvas, car.modelUrl);
    document.getElementById("fs").addEventListener("click", () => {
      const wrap = document.getElementById("viewer-wrap");
      if (document.fullscreenElement) document.exitFullscreen();
      else wrap.requestFullscreen?.();
    });
  }
})();