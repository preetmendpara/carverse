// Brand / model name search for the Cars page's single search input (the AI
// Car Finder). Pure: no imports, no AI, so it runs in the browser and in tests.
//
// A query is a NAME query when, after filler words ("find", "show me", "any",
// "cars"...), every word left is part of some car's brand, model or variant
// name. Then the matching cars are those whose name contains all those words,
// case-insensitively and as whole words or prefixes of them:
//   "Range Rover" -> Range Rover Vogue      "M4"      -> BMW M4 Competition
//   "Defender"    -> Defender 110           "toyota"  -> every Toyota
//   "any model"   -> every car (no words left)
// Anything with a non-name word ("city driving", "good family car",
// "automatic SUV under 15 lakh") is NOT a name query and goes to the AI
// Finder. Inside such a request only a full brand name ("BMW under 50 lakh")
// narrows the AI's results; a lone model word never does, so "city driving"
// is never read as Honda City.
const FILLER = new Set(
  "find show me any all a an the car cars model models please search for i want need looking list every of some available in stock".split(" ")
);
const tokens = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const padded = (s) => ` ${tokens(s).join(" ")} `;
const nameTokens = (c) => tokens([c.brandName, c.model, c.variant].filter(Boolean).join(" "));

/** Returns { nameOnly, ids: Set|null, label } for a Finder query. */
export function nameSearch(cars, query) {
  const words = tokens(query).filter((t) => !FILLER.has(t));
  const vocab = new Set(cars.flatMap(nameTokens));
  // A word counts as a name word if it is a whole name word, or (3+ letters)
  // the start of one ("innov" -> innova).
  const isName = (w) => vocab.has(w) || (w.length >= 3 && [...vocab].some((v) => v.startsWith(w)));
  const hasWord = (c, w) => nameTokens(c).some((v) => v === w || (w.length >= 3 && v.startsWith(w)));

  if (words.every(isName)) {
    if (!words.length) return { nameOnly: true, ids: null, label: "" };
    const ids = new Set(cars.filter((c) => words.every((w) => hasWord(c, w))).map((c) => c.id));
    // Name words that no single car has together ("bmw fortuner"): not a name
    // query after all; let the AI Finder answer.
    if (ids.size) return { nameOnly: true, ids, label: words.join(" ") };
  }

  // A request: only a full brand name narrows the AI's results.
  const q = padded(query);
  const brands = [...new Set(cars.map((c) => String(c.brandName || "").trim()).filter(Boolean))].filter((b) => q.includes(padded(b)));
  const ids = new Set(cars.filter((c) => brands.includes(String(c.brandName || "").trim())).map((c) => c.id));
  return { nameOnly: false, ids: ids.size ? ids : null, label: brands.join(", ") };
}
