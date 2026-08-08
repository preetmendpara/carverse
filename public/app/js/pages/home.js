import { renderLayout, esc } from "../../components/layout.js";
import { renderCars } from "../../components/car-card.js";
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
  // Word strip running behind the hero car. Clicking the strip itself toggles
  // it; clicks anywhere else on the page leave it running.
  const strip = document.getElementById("stage-strip");
  if (strip) {
    const words = ["Certified", "360° Walkaround", "Verified Specs", "AI Assistant", "Inspected"];
    strip.innerHTML = [...words, ...words]
      .map((w) => `<span>${esc(w)}</span><span class="dot">•</span>`)
      .join("");

    const box = document.getElementById("stage-strip-box");
    box?.addEventListener("click", () => box.classList.toggle("is-paused"));
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

  // Only an image chosen for this slot goes on the stage. Falling back to a
  // listing photo drops a full showroom scene — crowd, ceiling, signage —
  // behind the strip.
  const stageCar = document.getElementById("hero-banner");
  if (stageCar && settings.bannerUrl) {
    stageCar.innerHTML = `<img src="${esc(settings.bannerUrl)}" alt="" fetchpriority="high">`;
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
        ${
          brandLogo(b)
            ? `<img src="${esc(brandLogo(b))}" alt="${esc(b.name)} logo" loading="lazy" decoding="async" width="120" height="40">`
            : `<div class="logo-ph">${esc((b.name || "?")[0])}</div>`
        }
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