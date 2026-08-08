import { renderLayout } from "../../components/layout.js";
import { renderCars } from "../../components/car-card.js";
import { listWishlist, getCar } from "../core/store.js";
import { mountChatbot } from "../features/chatbot.js";

(async function init() {
  await renderLayout({ base: "../", active: "Wishlist" });
  mountChatbot();
  const grid = document.getElementById("grid");
  const rows = await listWishlist();
  const cars = (await Promise.all(rows.map((r) => getCar(r.carId)))).filter(
    (c) => c && c.status === "published"
  );
  if (!cars.length) {
    grid.innerHTML = `<div class="empty">Your wishlist is empty. Browse the <a href="cars.html" style="text-decoration:underline">Cars</a> page to save one.</div>`;
    return;
  }
  renderCars(grid, cars, "../");
})();