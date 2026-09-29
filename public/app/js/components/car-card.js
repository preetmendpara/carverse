import { esc, money, toast } from "./layout.js";
import { requireUser } from "../core/user-auth.js";
import { toggleWishlist, toggleCompare } from "../core/store.js";
import { revealGrid, refreshMotionFx } from "../features/motion-fx.js";
import { fuelText, transmissionText, fuelEconomyText } from "../core/car-fields.js";

export const carTitle = (c) => [c.brandName, c.model, c.variant].filter(Boolean).join(" ");
export const carCover = (c) => c.mainImage || (c.gallery && c.gallery[0]) || c.thumbnail || "";

export function carCard(car, base = "") {
  const img = carCover(car);
  // A chip is left out rather than shown with a guessed or conflicting value.
  const chips = [car.year, fuelText(car), transmissionText(car), fuelEconomyText(car)]
    .filter(Boolean)
    .map((v) => `<span class="chip">${esc(v)}</span>`)
    .join("");
  return `
  <article class="card car-card" data-car="${esc(car.id)}">
    <a class="car-thumb" href="${base}pages/car-details.html?id=${encodeURIComponent(car.id)}">
      ${
        img
          ? // width/height give the browser the 16:10 ratio before the file
            // arrives, so the grid does not jolt as thumbnails load.
            `<img src="${esc(img)}" alt="${esc(carTitle(car))}" loading="lazy" decoding="async" width="640" height="400">`
          : `<div class="ph">NO IMAGE</div>`
      }
    </a>
    <div class="car-body">
      <div class="car-brand">${esc(car.brandName || "")}</div>
      <div class="car-name">${esc([car.model, car.variant].filter(Boolean).join(" "))}</div>
      <div class="car-price">${money(car.price)}</div>
      <div class="chips">${chips}</div>
      <div class="car-actions">
        <a class="btn btn-sm btn-primary" href="${base}pages/car-details.html?id=${encodeURIComponent(car.id)}">Details</a>
        <button class="btn btn-sm" data-act="wish">Wishlist</button>
        <button class="btn btn-sm" data-act="cmp">Compare</button>
      </div>
    </div>
  </article>`;
}

export function renderCars(target, cars, base = "") {
  if (!cars.length) {
    target.innerHTML = `<div class="empty">No cars available.</div>`;
    return;
  }
  target.innerHTML = cars.map((c) => carCard(c, base)).join("");
  revealGrid(target, ".car-card");
  refreshMotionFx(target);
  target.querySelectorAll("[data-car]").forEach((el) => {
    const car = cars.find((c) => c.id === el.dataset.car);
    el.querySelector('[data-act="wish"]').addEventListener("click", async () => {
      try {
        if (!(await requireUser(base))) return;
        const added = await toggleWishlist(car);
        toast(added ? "Added to wishlist" : "Removed from wishlist");
      } catch (e) {
        toast(e.message || "Could not update wishlist");
      }
    });
    el.querySelector('[data-act="cmp"]').addEventListener("click", async () => {
      try {
        if (!(await requireUser(base))) return;
        const added = await toggleCompare(car);
        toast(added ? "Added to compare" : "Removed from compare");
      } catch (e) {
        toast(e.message || "Could not update compare");
      }
    });
  });
}