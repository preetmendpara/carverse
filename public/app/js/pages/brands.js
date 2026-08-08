import { renderLayout, esc } from "../../components/layout.js";
import { mountChatbot } from "../features/chatbot.js";
import { brandLogo } from "../data/brand-logos.js";
import {
  loadCatalog,
  priceRanges,
  inPriceRange,
  availabilityOf,
  matchesBrand,
  AVAILABILITY,
} from "../core/catalog.js";

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

  const el = {
    q: document.getElementById("f-q"),
    brand: document.getElementById("f-brand"),
    price: document.getElementById("f-price"),
    avail: document.getElementById("f-avail"),
    count: document.getElementById("count"),
  };
  brands.forEach((b) => el.brand.add(new Option(b.name || b.id, b.id)));
  priceRanges(cars).forEach((r) => el.price.add(new Option(r.label, r.value)));
  const availPresent = new Set(cars.map(availabilityOf));
  AVAILABILITY.filter(([k]) => availPresent.has(k)).forEach(([k, l]) =>
    el.avail.add(new Option(l, k))
  );

  function apply() {
    const q = el.q.value.trim().toLowerCase();
    const carQuery = new URLSearchParams();
    if (el.price.value) carQuery.set("price", el.price.value);
    if (el.avail.value) carQuery.set("availability", el.avail.value);

    const rows = brands
      .filter((b) => {
        if (el.brand.value && b.id !== el.brand.value) return false;
        if (q && !`${b.name || ""} ${b.country || ""}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((b) => {
        const matched = cars.filter(
          (c) =>
            matchesBrand(c, b) &&
            inPriceRange(c, el.price.value) &&
            (!el.avail.value || availabilityOf(c) === el.avail.value)
        );
        return { brand: b, n: matched.length };
      })
      .filter((r) => (el.price.value || el.avail.value ? r.n > 0 : true));

    el.count.textContent = `${rows.length} brand${rows.length === 1 ? "" : "s"}`;
    if (!rows.length) {
      grid.innerHTML = `<div class="empty">No brands match these filters.</div>`;
      return;
    }
    grid.innerHTML = rows
      .map(({ brand: b, n }) => {
        const logo = brandLogo(b);
        const qs = new URLSearchParams(carQuery);
        qs.set("brand", b.id);
        return `<a class="card brand-card" href="cars.html?${qs.toString()}">
        ${logo ? `<img src="${esc(logo)}" alt="${esc(b.name)} logo" loading="lazy">` : `<div class="logo-ph">${esc((b.name || "?")[0])}</div>`}
        <div>${esc(b.name || "")}</div>
        <div class="small muted">${esc(b.country || "")}</div>
        <div class="small muted">${n ? `${n} car${n === 1 ? "" : "s"}` : "View collection"}</div>
      </a>`;
      })
      .join("");
  }

  ["q", "brand", "price", "avail"].forEach((k) => {
    el[k].addEventListener("input", apply);
    el[k].addEventListener("change", apply);
  });
  apply();
})();
