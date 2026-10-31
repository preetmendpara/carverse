#!/usr/bin/env node
// Chatbot car cards: the Worker attaches display fields for the car IDs in its
// answer (chatCards); the browser renders them safely (chatCardData).
//   node scripts/test-chat-cards.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chatCardData, carHref } from "../public/app/js/core/chat-cards.js";
import { chatCards } from "../server/chat/api.js";

let passed = 0;
const check = (name, fn) => {
  fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const { cars: fixture } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
const cars = fixture.map((c) => ({ ...c, status: "published" }));
const venue = { ...cars.find((c) => c.model === "Venue"), variant: "SX", year: 2023, mainImage: "/media/car-images/v.avif" };
const wrangler = cars.find((c) => c.model === "Wrangler Rubicon");
const catalogue = [venue, ...cars.filter((c) => c.id !== venue.id)];

console.log("Server: chatCards");
check("one card per returned car ID, in order, from the catalogue record", () => {
  const out = chatCards([venue.id, "missing-id", wrangler.id], catalogue);
  assert.deepEqual(out.map((c) => c.carId), [venue.id, wrangler.id], "unknown IDs give no card");
  assert.deepEqual(Object.keys(out[0]), ["carId", "brandName", "model", "variant", "year", "price", "fuel", "transmission", "image"]);
  assert.equal(out[0].price, Number(venue.price));
  assert.equal(out[0].image, "/media/car-images/v.avif");
});
check("conflicting fuel/transmission is null, never guessed", () => {
  const w = chatCards([wrangler.id], catalogue)[0];
  assert.equal(w.fuel, null);
  assert.equal(w.transmission, null);
});
check("image falls back to gallery, then thumbnail, then none", () => {
  assert.equal(chatCards(["a"], [{ id: "a", gallery: ["/media/g.jpg"] }])[0].image, "/media/g.jpg");
  assert.equal(chatCards(["a"], [{ id: "a", thumbnail: "/media/t.jpg" }])[0].image, "/media/t.jpg");
  assert.equal(chatCards(["a"], [{ id: "a" }])[0].image, null);
});

console.log("Browser: chatCardData");
check("title, variant · year, price, fuel · transmission", () => {
  const d = chatCardData(chatCards([venue.id], catalogue)[0]);
  assert.equal(d.id, venue.id);
  assert.equal(d.title, `${venue.brandName} ${venue.model}`);
  assert.equal(d.sub, "SX · 2023");
  assert.equal(d.price, `₹ ${Number(venue.price).toLocaleString("en-IN")}`);
  assert.ok(d.specs.length > 0);
});
check("unsafe image URLs are dropped (fallback shown)", () => {
  for (const image of ["javascript:alert(1)", "data:image/png;base64,x", "//evil.com/x.jpg", "http://x/y.jpg", null])
    assert.equal(chatCardData({ carId: "a", image }).image, null, String(image));
  assert.equal(chatCardData({ carId: "a", image: "https://media.example/x.jpg" }).image, "https://media.example/x.jpg");
});
check("no ID means no card; missing price says Price on request", () => {
  assert.equal(chatCardData(null), null);
  assert.equal(chatCardData({}), null);
  assert.equal(chatCardData({ carId: "x" }).price, "Price on request");
});
check("link opens that exact car through the app's routing", () => {
  assert.equal(carHref("../", "QCdn boa/1"), "../pages/car-details.html?id=QCdn%20boa%2F1");
  assert.equal(carHref("", "abc"), "pages/car-details.html?id=abc");
});

console.log("Wiring");
const bot = await readFile(new URL("../public/app/js/features/chatbot.js", import.meta.url), "utf8");
const api = await readFile(new URL("../server/chat/api.js", import.meta.url), "utf8");
const css = await readFile(new URL("../public/app/css/style.css", import.meta.url), "utf8");
check("server sends cards for recommendations and for the specific car", () => {
  assert.ok(/cards: chatCards\(\[found\.car\.id\], cars\)/.test(api));
  assert.ok(/\[\.\.\.out\.results, \.\.\.out\.nearMisses\]\.map\(\(x\) => x\.carId\)/.test(api));
});
check("browser builds cards only from structured IDs; none for general answers", () => {
  assert.ok(/data\.intent === "specific_car" && data\.carId/.test(bot));
  assert.ok(/return \[\]; \/\/ general answers/.test(bot));
  assert.ok(/addCards\(pending, cardItems\(data\), data\.cards\)/.test(bot));
});
check("card content is set with textContent, never as HTML; no AI text parsed for links", () => {
  const cards = bot.slice(bot.indexOf("function carCard"), bot.indexOf("const cardItems"));
  assert.ok(!/innerHTML|insertAdjacentHTML/.test(cards));
  assert.ok(/e\.textContent = text/.test(bot));
  assert.ok(!/reply\.match|reply\.replace|href=.*reply/.test(bot));
});
check("panel is about 10% larger, responsive on mobile, cards cannot overflow", () => {
  assert.ok(/width: 396px; max-width: calc\(100vw - 40px\);\s*height: 528px;/.test(css));
  assert.ok(/@media \(max-width: 640px\) \{\s*#chat-panel \{ right: 10px; left: 10px; width: auto;/.test(css));
  assert.ok(/\.chat-card-body \{ min-width: 0;/.test(css) && /\.chat-card \{[^}]*min-width: 0;/.test(css));
});

console.log(`\n${passed} checks passed.`);
