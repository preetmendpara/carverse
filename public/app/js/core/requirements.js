// Buyer requirements: validation, the "We understood…" chips, and chip removal.
// Shared by the browser (chips) and the /api/match Worker (validation), so both
// read a requirements object the same way. Pure; see docs/RANKING-SPEC.md §1.

export const TRANSMISSION_VALUES = ["automatic", "manual"];
export const FUEL_VALUES = ["petrol", "diesel", "cng", "hybrid", "electric"];
export const BODY_VALUES = ["hatchback", "sedan", "compact_suv", "suv", "muv", "coupe", "pickup", "convertible"];
export const USAGE_VALUES = ["city", "highway", "rough_roads", "family"];
export const PRIORITY_VALUES = ["fuel_economy", "safety", "comfort", "performance", "low_price", "reliability"];
const STRENGTHS = ["required", "preferred"];

// Requirements Gemini may infer (not stated outright), by chip id. Budgets,
// seat counts and must-have features are never inferable: they are only ever
// taken from what the buyer actually said.
export const INFERABLE = [
  "transmission",
  "fuel",
  "bodyTypes",
  ...USAGE_VALUES.map((u) => `usage:${u}`),
  ...PRIORITY_VALUES.map((p) => `priorities:${p}`),
];

const MIN_BUDGET = 100000; // ₹1 lakh
const MAX_BUDGET = 100000000; // ₹10 crore

const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const enumList = (v, allowed, dropped) => {
  const out = [];
  for (const x of Array.isArray(v) ? v : []) {
    if (allowed.includes(x)) { if (!out.includes(x)) out.push(x); }
    else dropped.push(String(x));
  }
  return out;
};
const strList = (v, max, len) =>
  [...new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim().slice(0, len)).filter(Boolean))].slice(0, max);

function choice(v, allowed, dropped) {
  if (v == null) return null;
  if (typeof v !== "object" || !allowed.includes(v.value)) {
    if (v && v.value != null) dropped.push(String(v.value));
    return null;
  }
  return { value: v.value, strength: STRENGTHS.includes(v.strength) ? v.strength : "required" };
}

/**
 * Validates and normalises a requirements object (from Gemini or from the
 * chips). Returns { requirements, warnings, clarify } where `clarify` is a
 * question to ask the buyer instead of ranking, or null.
 */
export function validateRequirements(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const warnings = [];
  const dropped = [];
  let clarify = null;

  let budgetMaxInr = num(r.budgetMaxInr);
  let budgetMinInr = num(r.budgetMinInr);
  for (const [name, v] of [["maximum", budgetMaxInr], ["minimum", budgetMinInr]])
    if (v !== null && (v < MIN_BUDGET || v > MAX_BUDGET))
      clarify = `Did you mean a ${name} budget of ₹${v.toLocaleString("en-IN")}? Please state it in lakh or crore, for example "under 12 lakh".`;
  if (budgetMaxInr !== null && budgetMinInr !== null && budgetMinInr > budgetMaxInr) {
    [budgetMinInr, budgetMaxInr] = [budgetMaxInr, budgetMinInr];
    warnings.push("Your minimum budget was above your maximum, so they were swapped.");
  }

  let seatsMin = num(r.seatsMin);
  if (seatsMin !== null && (seatsMin < 1 || seatsMin > 9 || !Number.isInteger(seatsMin))) {
    clarify = clarify || `Did you mean at least ${seatsMin} seats? Cars have between 2 and 9.`;
    seatsMin = null;
  }

  let bodyTypes = null;
  if (r.bodyTypes && typeof r.bodyTypes === "object") {
    const values = enumList(r.bodyTypes.values, BODY_VALUES, dropped);
    if (values.length) bodyTypes = { values, strength: STRENGTHS.includes(r.bodyTypes.strength) ? r.bodyTypes.strength : "required" };
  }

  const requirements = {
    budgetMaxInr,
    budgetMinInr,
    transmission: choice(r.transmission, TRANSMISSION_VALUES, dropped),
    fuel: choice(r.fuel, FUEL_VALUES, dropped),
    seatsMin,
    bodyTypes,
    usage: enumList(r.usage, USAGE_VALUES, dropped),
    priorities: enumList(r.priorities, PRIORITY_VALUES, dropped),
    mustHaveFeatures: strList(r.mustHaveFeatures, 5, 40),
    inferred: [],
    unparsed: strList(r.unparsed, 5, 80),
  };

  // Inferred requirements are kept visible but can never become a hard
  // constraint: an inferred gearbox, fuel or body type is only "preferred".
  const claimed = new Set(enumList(r.inferred, INFERABLE, dropped));
  for (const key of ["transmission", "fuel", "bodyTypes"])
    if (claimed.has(key) && requirements[key]) requirements[key] = { ...requirements[key], strength: "preferred" };
  requirements.inferred = [...claimed].filter((id) => {
    const [key, value] = id.split(":");
    return value === undefined ? requirements[key] != null : requirements[key].includes(value);
  });

  if (dropped.length) warnings.push(`Ignored values CarVerse does not recognise: ${[...new Set(dropped)].join(", ")}.`);
  if (requirements.priorities.includes("reliability"))
    warnings.push('"Reliability" can\'t be assessed from CarVerse data, so it isn\'t scored.');
  if (requirements.unparsed.length)
    warnings.push(`Not used for matching: ${requirements.unparsed.join("; ")}.`);

  return { requirements, warnings, clarify };
}

/* ------------------------ budget unit check ---------------------------- */
// Deterministic, on the buyer's own words: a budget counts only if the
// sentence states its unit. "under 12" could mean 12 lakh, 12 thousand or
// 12 crore, so it is asked about, never assumed. This runs after Gemini and
// does not trust it; the extraction prompt says the same as a second layer.
const NUM = String.raw`(\d+(?:\.\d+)?)`;
const AMOUNT_RULES = [
  [new RegExp(`${NUM}\\s*(?:lakhs?|lacs?|lk|l)(?![a-z])`, "gi"), 1e5], // 12 lakh, 12L, 12.5 lac
  [new RegExp(`${NUM}\\s*(?:crores?|cr)(?![a-z])`, "gi"), 1e7], //         1 crore, 1.2cr
  [new RegExp(`${NUM}\\s*(?:thousand|k)(?![a-z])`, "gi"), 1e3], //         800k, 50 thousand
];
/** Every rupee amount the buyer wrote WITH a unit, in rupees. Bare numbers are not included. */
// "twelve lakh", "twenty-five lakh": number words count as a stated amount.
const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const WORD_NUMBER = new RegExp(`\\b(?:(${Object.keys(TENS).join("|")})(?:[\\s-]+(${ONES.slice(1, 10).join("|")}))?|(${ONES.join("|")}))\\b`, "gi");
export const numberWordsToDigits = (text) =>
  String(text || "").replace(WORD_NUMBER, (_, tens, unit, ones) =>
    String(ones ? ONES.indexOf(ones.toLowerCase()) : TENS[tens.toLowerCase()] + (unit ? ONES.indexOf(unit.toLowerCase()) : 0)));

export function statedAmounts(query) {
  const text = numberWordsToDigits(query);
  const out = [];
  for (const [re, mult] of AMOUNT_RULES) for (const m of text.matchAll(re)) out.push(Math.round(Number(m[1]) * mult));
  // A range shares one unit: "8 to 12 lakh", "8-12L", "between 8 and 12 lakh"
  // -> the 8 is 8 lakh too.
  for (const [re, mult] of AMOUNT_RULES) {
    const range = new RegExp(`${NUM}\\s*(?:-|–|to|and)\\s*${re.source}`, "gi");
    for (const m of text.matchAll(range)) out.push(Math.round(Number(m[1]) * mult));
  }
  // Full amounts: 12,00,000 (Indian grouping), 1,200,000, or 1200000 (six or more digits).
  for (const m of text.matchAll(/(?<![\d.])(\d{1,3}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3}){2,}|\d{6,})(?![\d.])/g))
    out.push(Number(m[1].replace(/,/g, "")));
  return out;
}
export const hasExplicitBudgetUnit = (query) => statedAmounts(query).length > 0;

/**
 * The question to ask when an extracted budget is not an amount the buyer
 * wrote with its unit (e.g. "under 12"); null when every budget is backed by
 * the buyer's own words, or there is no budget. Compares numbers, so a unit
 * elsewhere in the sentence ("1.2L engine") cannot vouch for a bare "12".
 */
export function budgetUnitQuestion(query, requirements) {
  const budgets = [requirements?.budgetMaxInr, requirements?.budgetMinInr].filter((v) => v != null);
  if (!budgets.length) return null;
  const stated = statedAmounts(query);
  if (budgets.every((b) => stated.some((s) => Math.abs(s - b) <= b * 0.005))) return null;
  return askForUnit(query);
}

/**
 * The same question when Gemini followed its instructions and left a unitless
 * budget out, noting it in `unparsed`, so the buyer is asked rather than told
 * nothing matched.
 */
export function droppedBudgetQuestion(query, requirements) {
  const budgets = [requirements?.budgetMaxInr, requirements?.budgetMinInr].filter((v) => v != null);
  if (budgets.length || !(requirements?.unparsed || []).some((u) => /budget/i.test(u))) return null;
  return askForUnit(query);
}

function askForUnit(query) {
  const n = String(query || "").match(/\d+(?:\.\d+)?/)?.[0];
  return n
    ? `What does "${n}" mean? Please give the budget with its unit, for example "${n} lakh" or "₹${n},00,000".`
    : "Please give your budget with its unit, for example \"12 lakh\" or \"₹12,00,000\".";
}

/* ------------------------------- chips --------------------------------- */
const lakh = (n) => (n >= 1e7 ? `₹${(n / 1e7).toFixed(n % 1e7 ? 2 : 0)} crore` : `₹${+(n / 1e5).toFixed(1)} lakh`);
const cap = (s) => s[0].toUpperCase() + s.slice(1);
const LABEL = {
  usage: { city: "City driving", highway: "Highway driving", rough_roads: "Rough roads", family: "Family use" },
  priorities: { fuel_economy: "Fuel economy", safety: "Safety", comfort: "Comfort", performance: "Performance", low_price: "Lowest price", reliability: "Reliability (not scored)" },
  body: { hatchback: "Hatchback", sedan: "Sedan", compact_suv: "Compact SUV", suv: "SUV", muv: "MUV", coupe: "Coupe", pickup: "Pickup", convertible: "Convertible" },
  fuel: { petrol: "Petrol", diesel: "Diesel", cng: "CNG", hybrid: "Hybrid", electric: "Electric" },
};
const strengthText = (s) => (s === "preferred" ? "preferred" : "required");

/** The "We understood…" chips. Each has an id that removeChip() understands. */
export function understoodChips(req) {
  const chips = [];
  if (req.budgetMaxInr != null) chips.push({ id: "budgetMaxInr", text: `Up to ${lakh(req.budgetMaxInr)}` });
  if (req.budgetMinInr != null) chips.push({ id: "budgetMinInr", text: `From ${lakh(req.budgetMinInr)}` });
  if (req.transmission) chips.push({ id: "transmission", text: `${cap(req.transmission.value)} (${strengthText(req.transmission.strength)})` });
  if (req.fuel) chips.push({ id: "fuel", text: `${LABEL.fuel[req.fuel.value]} (${strengthText(req.fuel.strength)})` });
  if (req.seatsMin != null) chips.push({ id: "seatsMin", text: `At least ${req.seatsMin} seats` });
  if (req.bodyTypes) chips.push({ id: "bodyTypes", text: `${req.bodyTypes.values.map((b) => LABEL.body[b]).join(" or ")} (${strengthText(req.bodyTypes.strength)})` });
  for (const u of req.usage || []) chips.push({ id: `usage:${u}`, text: LABEL.usage[u] });
  for (const p of req.priorities || []) chips.push({ id: `priorities:${p}`, text: `Priority: ${LABEL.priorities[p]}` });
  for (const f of req.mustHaveFeatures || []) chips.push({ id: `mustHaveFeatures:${f}`, text: `Must have: ${f}` });
  // Inferred chips are marked, so the buyer can tell what they said from what
  // was read into it, and remove the latter.
  const inferred = new Set(req.inferred || []);
  return chips.map((c) => ({ ...c, inferred: inferred.has(c.id) }));
}

/** A copy of the requirements without the chip's requirement. */
export function removeChip(req, id) {
  const next = JSON.parse(JSON.stringify(req));
  const [key, value] = id.split(/:(.*)/s);
  if (value !== undefined && Array.isArray(next[key])) next[key] = next[key].filter((x) => x !== value);
  else if (key in next) next[key] = null;
  if (Array.isArray(next.inferred)) next.inferred = next.inferred.filter((x) => x !== id);
  return next;
}

/** True when the buyer stated nothing the ranking can use. */
export const isEmpty = (req) =>
  req.budgetMaxInr == null && req.budgetMinInr == null && !req.transmission && !req.fuel && req.seatsMin == null && !req.bodyTypes &&
  !(req.usage || []).length && !(req.priorities || []).length && !(req.mustHaveFeatures || []).length;
