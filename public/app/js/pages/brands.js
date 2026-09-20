import { renderLayout, esc } from "../components/layout.js";
import { mountChatbot } from "../features/chatbot.js";
import { brandLogo } from "../data/brand-logos.js";
import { loadCatalog, matchesBrand } from "../core/catalog.js";

(async function init() {
  await renderLayout({ base: "../", active: "Brands" });
  mountChatbot();
  const grid = document.getElementById("grid");
  grid.innerHTML = `<p class="muted small">Loading brands…</p>`;
  const { cars, brands } = await loadCatalog();

  if (!brands.length) {
    grid.innerHTML = `<div class="empty">No brands available.</div>`;
    return;
  }

  const rows = brands.map((b) => ({ brand: b, n: cars.filter((c) => matchesBrand(c, b)).length }));
  document.getElementById("count").textContent = `${rows.length} brand${rows.length === 1 ? "" : "s"}`;
  grid.innerHTML = rows
    .map(({ brand: b, n }) => {
      const logo = brandLogo(b);
      return `<a class="card brand-card" href="cars.html?brand=${encodeURIComponent(b.id)}">
      ${logo ? `<img src="${esc(logo)}" alt="${esc(b.name)} logo" loading="lazy">` : `<div class="logo-ph">${esc((b.name || "?")[0])}</div>`}
      <div>${esc(b.name || "")}</div>
      <div class="small muted">${esc(b.country || "")}</div>
      <div class="small muted">${n ? `${n} car${n === 1 ? "" : "s"}` : "View collection"}</div>
    </a>`;
    })
    .join("");
})();
