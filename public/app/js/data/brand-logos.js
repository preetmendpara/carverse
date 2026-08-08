/**
 * Curated luxury brand list (inspired by the Big Boy Toyz line-up) plus logo
 * resolution. Monochrome marks come from the Simple Icons CDN so they match the
 * black & white theme; brands without an icon get a generated SVG wordmark.
 */

const ICON = (slug) => `https://cdn.simpleicons.org/${slug}/ffffff`;

const wordmark = (name) => {
  const t = (name || "").toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="60" viewBox="0 0 220 60">
<text x="110" y="34" dominant-baseline="middle" text-anchor="middle" fill="#ffffff" textLength="200"
 lengthAdjust="spacingAndGlyphs" font-family="Bebas Neue, Impact, Arial Narrow, sans-serif"
 font-size="34" letter-spacing="2">${t}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

/** name, country, simple-icons slug (optional), featured */
export const BRAND_SEED = [
  { name: "Lamborghini", country: "Italy", slug: "lamborghini", featured: true },
  { name: "Ferrari", country: "Italy", slug: "ferrari", featured: true },
  { name: "Rolls-Royce", country: "United Kingdom", slug: "rollsroyce", featured: true },
  { name: "Bentley", country: "United Kingdom", slug: "bentley", featured: true },
  { name: "Porsche", country: "Germany", slug: "porsche", featured: true },
  { name: "Mercedes-Benz", country: "Germany", slug: null, featured: true },
  { name: "BMW", country: "Germany", slug: "bmw", featured: true },
  { name: "Audi", country: "Germany", slug: "audi", featured: true },
  { name: "Aston Martin", country: "United Kingdom", slug: "astonmartin", featured: false },
  { name: "McLaren", country: "United Kingdom", slug: "mclaren", featured: false },
  { name: "Bugatti", country: "France", slug: "bugatti", featured: false },
  { name: "Maserati", country: "Italy", slug: "maserati", featured: false },
  { name: "Land Rover", country: "United Kingdom", slug: null, featured: true },
  { name: "Jaguar", country: "United Kingdom", slug: null, featured: false },
  { name: "Lexus", country: "Japan", slug: null, featured: false },
  { name: "Volvo", country: "Sweden", slug: "volvo", featured: false },
  { name: "MINI", country: "United Kingdom", slug: "mini", featured: false },
  { name: "Jeep", country: "United States", slug: "jeep", featured: false },
  { name: "Cadillac", country: "United States", slug: "cadillac", featured: false },
  { name: "Chevrolet", country: "United States", slug: "chevrolet", featured: false },
  { name: "Ford", country: "United States", slug: "ford", featured: false },
  { name: "Tesla", country: "United States", slug: "tesla", featured: false },
  { name: "Toyota", country: "Japan", slug: "toyota", featured: false },
  { name: "Nissan", country: "Japan", slug: "nissan", featured: false },
  { name: "Koenigsegg", country: "Sweden", slug: "koenigsegg", featured: false },
];

const key = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map(BRAND_SEED.map((b) => [key(b.name), b]));

/** Logo URL for a brand: stored logo wins, then curated icon, then wordmark. */
export function brandLogo(brand) {
  if (brand?.logoUrl) return brand.logoUrl;
  const hit = BY_NAME.get(key(brand?.name));
  if (hit?.slug) return ICON(hit.slug);
  return brand?.name ? wordmark(brand.name) : "";
}

/** Seed payloads for writing the curated list into Firestore. */
export const brandSeedDocs = () =>
  BRAND_SEED.map((b) => ({
    name: b.name,
    country: b.country,
    featured: b.featured,
    description: `${b.name} models available at CarVerse.`,
    logoUrl: b.slug ? ICON(b.slug) : wordmark(b.name),
  }));

/** Display-only brands used until the Firestore `brands` collection is filled. */
export const fallbackBrands = () =>
  brandSeedDocs().map((b) => ({ id: key(b.name), ...b, isFallback: true }));
