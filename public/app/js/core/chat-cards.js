// What a chatbot car card shows. Pure (no DOM), so it is tested in Node.
// `card` is one entry of the Worker's `cards` list (server/chat/api.js
// chatCards): display fields taken from the catalogue record for a car ID the
// matcher or the chat returned. Nothing is read out of AI-written text, and the
// browser never holds the catalogue.

const IMAGE = /^(https:\/\/|\/(?!\/))/;
const rupees = (n) => (Number(n) > 0 ? `₹ ${Number(n).toLocaleString("en-IN")}` : "Price on request");

/** Returns { id, title, sub, price, specs, image } or null without a car ID. */
export function chatCardData(card) {
  const id = String(card?.carId || "");
  if (!id) return null;
  return {
    id,
    title: [card.brandName, card.model].filter(Boolean).join(" ") || "Car",
    sub: [card.variant, card.year].filter(Boolean).join(" · "),
    price: rupees(card.price),
    specs: [card.fuel, card.transmission].filter(Boolean).join(" · "),
    image: typeof card.image === "string" && IMAGE.test(card.image) ? card.image : null,
  };
}

/** The car's CarVerse page, from the app's own routing. */
export const carHref = (base, id) => `${base}pages/car-details.html?id=${encodeURIComponent(id)}`;
