import { renderLayout, esc } from "../../components/layout.js";
import { renderCars, carCover } from "../../components/car-card.js";
import { listCars, listBrands } from "../core/store.js";
import { mountChatbot } from "../features/chatbot.js";
import { revealGrid, refreshMotionFx } from "../features/motion-fx.js";
import { brandLogo, fallbackBrands } from "../data/brand-logos.js";
import { fallbackCars } from "../data/fallback-cars.js";

(async function init() {
  const settings = await renderLayout({ base: "", active: "Home" });
  mountChatbot();

  if (settings.heroTitle) document.getElementById("hero-title").textContent = settings.heroTitle;
  if (settings.heroSubtitle) document.getElementById("hero-sub").textContent = settings.heroSubtitle;
  // Word strip running behind the hero car.
  const strip = document.getElementById("stage-strip");
  if (strip) {
    const words = ["Certified", "360° Walkaround", "Verified Specs", "AI Assistant", "Inspected"];
    strip.innerHTML = [...words, ...words]
      .map((w) => `<span>${esc(w)}</span><span class="dot">•</span>`)
      .join("");
  }

  document.getElementById("hero-search").addEventListener("submit", (e) => {
    e.preventDefault();
    const q = document.getElementById("hero-q").value.trim();
    location.href = `pages/cars.html${q ? "?q=" + encodeURIComponent(q) : ""}`;
  });

  ["featured", "latest", "brands"].forEach((id) => {
    document.getElementById(id).innerHTML = `<p class="muted small">Loading…</p>`;
  });

  const [dbCars, dbBrands] = await Promise.all([listCars(), listBrands()]);
  const cars = dbCars.length ? dbCars : fallbackCars();
  const brands = dbBrands.length ? dbBrands : fallbackBrands();

  // Hero stage: the live inventory count sits behind the car, and the car is
  // the configured banner if there is one, otherwise the first featured photo.
  const stageType = document.getElementById("stage-type");
  if (stageType) stageType.textContent = String(cars.length || 120);

  const stageCar = document.getElementById("hero-banner");
  const heroImage = settings.bannerUrl || carCover(cars.find((c) => c.featured) || cars[0] || {});
  if (stageCar && heroImage) {
    stageCar.innerHTML = `<img src="${esc(heroImage)}" alt="" fetchpriority="high">`;
  }

  const featured = cars.filter((c) => c.featured);
  renderCars(document.getElementById("featured"), featured.length ? featured : [], "");
  renderCars(document.getElementById("latest"), cars.slice(0, 6), "");

  const brandBox = document.getElementById("brands");
  const popular = brands.filter((b) => b.featured);
  const show = popular.length ? popular : brands;
  brandBox.innerHTML = show.length
    ? show
        .map(
          (b) => `<a class="card brand-card" href="pages/cars.html?brand=${encodeURIComponent(b.id)}">
        ${brandLogo(b) ? `<img src="${esc(brandLogo(b))}" alt="${esc(b.name)} logo" loading="lazy">` : `<div class="logo-ph">${esc((b.name || "?")[0])}</div>`}
        <div>${esc(b.name || "")}</div>
        <div class="small muted">${esc(b.country || "")}</div>
      </a>`
        )
        .join("")
    : `<div class="empty">No brands available.</div>`;
  revealGrid(brandBox, ".brand-card");
  refreshMotionFx(brandBox);

  // Scrolling marque of brand names — pure marketing texture, duplicated so the
  // CSS translateX(-50%) loop is seamless.
  const track = document.getElementById("brand-marquee");
  if (track) {
    const names = (brands.length ? brands.map((b) => b.name).filter(Boolean) : []);
    const words = names.length ? names : ["Premium", "Certified", "3D Walkaround", "AI Assistant", "Verified Specs"];
    track.innerHTML = [...words, ...words].map((n) => `<span>${esc(n)}</span>`).join("");
  }
})();