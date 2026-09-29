import { renderLayout, esc } from "../components/layout.js";
import { renderCars } from "../components/car-card.js";
import { mountChatbot } from "../features/chatbot.js";
import { mountFinder } from "../features/car-finder.js";
import { FUELS, TRANSMISSIONS, matchesFuel, matchesTransmission } from "../core/car-fields.js";
import {
  loadCatalog,
  priceRanges,
  inPriceRange,
  searchCar,
  availabilityOf,
  AVAILABILITY,
} from "../core/catalog.js";

(async function init() {
  await renderLayout({ base: "../", active: "Cars" });
  mountChatbot();
  mountFinder({ base: "../" });

  const params = new URLSearchParams(location.search);
  document.getElementById("grid").innerHTML = `<p class="muted small">Loading inventory…</p>`;
  const { cars, brands } = await loadCatalog();

  const el = {
    q: document.getElementById("f-q"),
    brand: document.getElementById("f-brand"),
    fuel: document.getElementById("f-fuel"),
    trans: document.getElementById("f-trans"),
    price: document.getElementById("f-price"),
    avail: document.getElementById("f-avail"),
    sort: document.getElementById("f-sort"),
    grid: document.getElementById("grid"),
    count: document.getElementById("count"),
  };

  el.q.value = params.get("q") || "";
  brands.forEach((b) => el.brand.add(new Option(b.name || b.id, b.id)));
  if (params.get("brand")) el.brand.value = params.get("brand");

  // Options come from the effective values, in the fixed list order, and only
  // where at least one car consistently has them. A car whose fuel or gearbox
  // is conflicting or missing is shown under "All" only.
  const has = (list, test) => list.filter(([k]) => cars.some((c) => test(c, k)));
  has(FUELS, matchesFuel).forEach(([v, l]) => el.fuel.add(new Option(l, v)));
  has(TRANSMISSIONS, matchesTransmission).forEach(([v, l]) => el.trans.add(new Option(l, v)));
  priceRanges(cars).forEach((r) => el.price.add(new Option(r.label, r.value)));
  const availPresent = new Set(cars.map(availabilityOf));
  AVAILABILITY.filter(([k]) => availPresent.has(k)).forEach(([k, l]) =>
    el.avail.add(new Option(l, k))
  );
  if (params.get("price")) el.price.value = params.get("price");
  if (params.get("availability")) el.avail.value = params.get("availability");

  function apply() {
    const q = el.q.value.trim().toLowerCase();
    const brand = brands.find((b) => b.id === el.brand.value);
    let list = cars.filter((c) => {
      if (!searchCar(c, q)) return false;
      if (el.brand.value) {
        const sameId = c.brandId === el.brand.value;
        const sameName =
          brand &&
          String(c.brandName || c.brand || "").trim().toLowerCase() ===
            String(brand.name || "").trim().toLowerCase();
        if (!sameId && !sameName) return false;
      }
      if (!matchesFuel(c, el.fuel.value)) return false;
      if (!matchesTransmission(c, el.trans.value)) return false;
      if (!inPriceRange(c, el.price.value)) return false;
      if (el.avail.value && availabilityOf(c) !== el.avail.value) return false;
      return true;
    });
    const num = (v) => Number(v) || 0;
    if (el.sort.value === "price-asc") list.sort((a, b) => num(a.price) - num(b.price));
    if (el.sort.value === "price-desc") list.sort((a, b) => num(b.price) - num(a.price));
    if (el.sort.value === "year-desc") list.sort((a, b) => num(b.year) - num(a.year));
    el.count.textContent = `${list.length} car${list.length === 1 ? "" : "s"}`;
    if (!list.length) {
      el.grid.innerHTML = `<div class="empty">No cars match these filters.</div>`;
      return;
    }
    renderCars(el.grid, list, "../");
  }

  ["q", "brand", "fuel", "trans", "price", "avail", "sort"].forEach((k) => {
    el[k].addEventListener("input", apply);
    el[k].addEventListener("change", apply);
  });
  apply();
  void esc;
})();
