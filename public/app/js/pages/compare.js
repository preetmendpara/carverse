import { renderLayout, esc, money, toast } from "../components/layout.js";
import { carTitle } from "../components/car-card.js";
import { listCompare, removeCompare, getCar } from "../core/store.js";
import { mountChatbot } from "../features/chatbot.js";
import * as F from "../core/car-fields.js";

(async function init() {
  await renderLayout({ base: "../", active: "Compare" });
  mountChatbot();
  const out = document.getElementById("out");

  async function render() {
    const rows = await listCompare();
    const cars = (await Promise.all(rows.map((r) => getCar(r.carId)))).map((c, i) =>
      c ? { ...c, _cmpId: rows[i].id } : null
    ).filter(Boolean);

    document.getElementById("clear").hidden = !cars.length;
    if (!cars.length) {
      out.innerHTML = `<div class="empty">No cars selected for comparison. Add cars from the <a href="cars.html" style="text-decoration:underline">Cars</a> page.</div>`;
      return;
    }

    // Only specification keys the rows below do not already cover, so the
    // placeholder odometers and conflicting duplicates stay off the table.
    const specKeys = [...new Set(cars.flatMap((c) => F.extraSpecs(c).map(([k]) => k)))];
    const fields = [
      ["Price", (c) => money(c.price)],
      ["Year", (c) => c.year],
      ["Body type", (c) => F.orNotProvided(F.bodyTypeText(c))],
      ["Fuel economy", (c) => F.orNotProvided(F.fuelEconomyText(c))],
      ["Kilometres driven", (c) => F.orNotProvided(F.kmDrivenText(c))],
      ["Engine", (c) => c.engine],
      ["Transmission", (c) => F.orNotProvided(F.transmissionText(c), F.transmissionConflict(c))],
      ["Fuel type", (c) => F.orNotProvided(F.fuelText(c), F.fuelConflict(c))],
      ["Power", (c) => F.orNotProvided(F.powerText(c))],
      ["Torque", (c) => c.torque],
      ["Seats", (c) => c.seats],
      ["Boot space", (c) => F.orNotProvided(F.bootText(c))],
      ["Ground clearance", (c) => F.orNotProvided(F.groundClearanceText(c))],
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