import { renderLayout, esc, money, toast } from "../components/layout.js";
import { carTitle } from "../components/car-card.js";
import { listCompare, removeCompare, getCar } from "../core/store.js";
import { mountChatbot } from "../features/chatbot.js";

(async function init() {
  await renderLayout({ base: "../", active: "Compare" });
  mountChatbot();
  const out = document.getElementById("out");

  async function render() {
    const rows = await listCompare();
    const cars = (await Promise.all(rows.map((r) => getCar(r.carId)))).map((c, i) =>
      c ? { ...c, _cmpId: rows[i].id } : null
    ).filter(Boolean);

    if (!cars.length) {
      out.innerHTML = `<div class="empty">No cars selected for comparison. Add cars from the <a href="cars.html" style="text-decoration:underline">Cars</a> page.</div>`;
      return;
    }

    const specKeys = [...new Set(cars.flatMap((c) => Object.keys(c.specifications || {})))];
    const fields = [
      ["Price", (c) => money(c.price)],
      ["Year", (c) => c.year],
      ["Mileage", (c) => c.mileage],
      ["Engine", (c) => c.engine],
      ["Transmission", (c) => c.transmission],
      ["Fuel type", (c) => c.fuelType],
      ["Horsepower", (c) => c.horsepower],
      ["Torque", (c) => c.torque],
      ["Seats", (c) => c.seats],
      ["Boot space", (c) => c.bootSpace],
      ["Ground clearance", (c) => c.groundClearance],
      ...specKeys.map((k) => [k, (c) => (c.specifications || {})[k]]),
      ["Features", (c) => (c.features || []).join(", ")],
    ];

    out.innerHTML = `<div class="table-scroll"><table class="compare-table">
      <thead><tr><th></th>${cars
        .map(
          (c) => `<th>
            <a href="car-details.html?id=${encodeURIComponent(c.id)}">${esc(carTitle(c))}</a>
            <div><button class="btn btn-sm btn-ghost" data-rm="${esc(c._cmpId)}" style="margin-top:8px">Remove</button></div>
          </th>`
        )
        .join("")}</tr></thead>
      <tbody>${fields
        .map(
          ([label, fn]) =>
            `<tr><td class="muted">${esc(label)}</td>${cars
              .map((c) => `<td>${esc(fn(c) ?? "—") || "—"}</td>`)
              .join("")}</tr>`
        )
        .join("")}</tbody>
    </table></div>`;

    out.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", async () => {
        await removeCompare(b.dataset.rm);
        toast("Removed");
        render();
      })
    );
  }

  document.getElementById("clear").addEventListener("click", async () => {
    const rows = await listCompare();
    await Promise.all(rows.map((r) => removeCompare(r.id)));
    render();
  });
  render();
})();