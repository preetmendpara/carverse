/**
 * Shared catalog layer: one source of truth for the inventory used by the Cars
 * and Brands pages and by the AI chatbot. Reads Firestore first and only falls
 * back to the demo seed when the collections are still empty.
 */
import { listCars, listBrands } from "./store.js";
import { effectiveFields, searchText } from "./car-fields.js";

let cache = null;
let cachedAt = 0;
const TTL = 60_000;

export async function loadCatalog({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < TTL) return cache;
  const [dbCars, dbBrands] = await Promise.all([listCars(), listBrands()]);
  // The demo seed carries a photo table for every model, so importing it
  // eagerly loaded two sizeable modules on every page for a case that only
  // arises before Firestore has any data.
  let seedCars = dbCars, seedBrands = dbBrands;
  if (!dbCars.length || !dbBrands.length) {
    const [{ fallbackCars }, { fallbackBrands }] = await Promise.all([
      import("../data/fallback-cars.js"),
      import("../data/brand-logos.js"),
    ]);
    if (!dbCars.length) seedCars = fallbackCars();
    if (!dbBrands.length) seedBrands = fallbackBrands();
  }
  const cars = seedCars.map(normalizeCar);
  const brands = seedBrands;
  cache = { cars, brands, fromFirestore: dbCars.length > 0 };
  cachedAt = Date.now();
  return cache;
}

export const invalidateCatalog = () => {
  cache = null;
};

export const AVAILABILITY = [
  ["in-stock", "In stock"],
  ["reserved", "Reserved"],
  ["sold", "Sold"],
];

export function availabilityOf(car) {
  const raw = String(car?.availability || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  if (raw === "sold" || raw === "reserved" || raw === "in-stock") return raw;
  if (raw === "available" || raw === "instock") return "in-stock";
  return "in-stock";
}

export const availabilityLabel = (v) =>
  (AVAILABILITY.find(([k]) => k === v) || ["", "In stock"])[1];

// The original Firestore fields stay as they are; the single interpretation of
// them (car-fields.js) is attached as `effective`, so every page reads the same
// answer instead of re-parsing the raw fields.
function normalizeCar(c) {
  return { ...c, availability: availabilityOf(c), effective: effectiveFields(c) };
}

export const carPrice = (c) => Number(c?.price) || 0;

export const matchesBrand = (car, brand) => {
  if (!brand) return true;
  if (car.brandId && brand.id && car.brandId === brand.id) return true;
  const a = String(car.brandName || car.brand || "").trim().toLowerCase();
  const b = String(brand.name || "").trim().toLowerCase();
  return !!a && a === b;
};

const inr = (n) =>
  n >= 1e7 ? `${(n / 1e7).toFixed(n % 1e7 ? 2 : 0)} Cr` : `${Math.round(n / 1e5)} L`;

/** Price buckets derived from the live inventory, not hardcoded tiers. */
export function priceRanges(cars) {
  const prices = cars.map(carPrice).filter((p) => p > 0).sort((a, b) => a - b);
  if (prices.length < 2) return [];
  const min = prices[0];
  const max = prices[prices.length - 1];
  const steps = 4;
  const size = (max - min) / steps;
  const out = [];
  for (let i = 0; i < steps; i++) {
    const lo = Math.floor(min + size * i);
    const hi = i === steps - 1 ? Infinity : Math.floor(min + size * (i + 1));
    out.push({
      value: `${lo}-${hi === Infinity ? "" : hi}`,
      label: hi === Infinity ? `₹${inr(lo)} and above` : `₹${inr(lo)} – ₹${inr(hi)}`,
      min: lo,
      max: hi,
    });
  }
  return out;
}

export function inPriceRange(car, value) {
  if (!value) return true;
  const [lo, hi] = value.split("-");
  const p = carPrice(car);
  if (Number(lo) && p < Number(lo)) return false;
  if (hi && Number(hi) && p > Number(hi)) return false;
  return true;
}

export function searchCar(car, q) {
  if (!q) return true;
  return searchText(car, availabilityLabel(availabilityOf(car))).includes(q);
}
