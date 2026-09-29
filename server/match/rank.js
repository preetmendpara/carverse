// Deterministic matching: validated requirements + cars -> ranked results.
// Implements docs/RANKING-SPEC.md exactly; the section numbers below refer to
// it. No AI, no I/O. If this file and the spec disagree, this file is wrong.
import { effective } from "../../public/app/js/core/car-fields.js";
import { suitability } from "../../public/app/js/core/car-tags.js";

const lakh = (n) => `₹${(n / 1e5).toFixed(n % 1e5 ? 1 : 0)} lakh`;
const money = (n) => (n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} crore` : lakh(n));
const FUEL = { petrol: "Petrol", diesel: "Diesel", cng: "CNG", hybrid: "Hybrid", electric: "Electric" };
const BODY = { hatchback: "hatchback", sedan: "sedan", compact_suv: "compact SUV", suv: "SUV", muv: "MUV", coupe: "coupe", pickup: "pickup", convertible: "convertible" };
const title = (c) => [c.brandName, c.model, c.variant].filter(Boolean).join(" ");

/* §2 Hard constraints. Each returns null (not applicable), or
   { name, pass, reason } where reason explains a failure in plain words. */
function hardConstraints(req, car, e) {
  const price = Number(car.price) || 0;
  const out = [];
  const add = (name, pass, reason, passText) => out.push({ name, pass, reason: pass ? null : reason, passText: pass ? passText : null });

  // H1 is always applied; a sold car is never a result or a near miss.
  add("H1_not_sold", String(car.availability || "").toLowerCase() !== "sold", "Sold", null);

  if (req.budgetMaxInr != null) {
    const over = price - req.budgetMaxInr;
    add("H2_budget_max", price > 0 && price <= req.budgetMaxInr,
      price > 0 ? `${money(price)} — ${money(over)} above your ${money(req.budgetMaxInr)} budget` : "Price not listed — a budget was set",
      `${money(price)} — within your ${money(req.budgetMaxInr)} budget`);
  }
  if (req.budgetMinInr != null)
    add("H3_budget_min", price >= req.budgetMinInr, `${money(price)} — below your ${money(req.budgetMinInr)} minimum`, `${money(price)} — at or above your ${money(req.budgetMinInr)} minimum`);

  if (req.transmission?.strength === "required") {
    const want = req.transmission.value;
    const known = e.transmissionStatus === "ok";
    add("H4_transmission", known && e.transmissionNorm === want,
      known ? `${cap(e.transmissionNorm)} transmission — ${want} was required` : `Transmission not confirmed in the listing — ${want} was required`,
      `${cap(want)} transmission, as required`);
  }
  if (req.fuel?.strength === "required") {
    const want = req.fuel.value;
    const known = e.fuelStatus === "ok";
    add("H5_fuel", known && e.fuelTypes.includes(want),
      known ? `${FUEL[e.fuelTypes[0]]} — ${FUEL[want] || want} was required` : `Fuel type not confirmed in the listing — ${FUEL[want] || want} was required`,
      `${FUEL[want] || want}, as required`);
  }
  if (req.seatsMin != null)
    add("H6_seats", e.seats !== null && e.seats >= req.seatsMin,
      e.seats === null ? `Seats not recorded — at least ${req.seatsMin} were required` : `${e.seats} seats — at least ${req.seatsMin} were required`,
      `${e.seats} seats, at least ${req.seatsMin} required`);
  if (req.bodyTypes?.strength === "required") {
    const known = e.bodyType !== null;
    add("H7_body_type", known && req.bodyTypes.values.includes(e.bodyType),
      known ? `${cap(BODY[e.bodyType])} — ${req.bodyTypes.values.map((b) => BODY[b]).join(" or ")} was required` : `Body type not recorded — ${req.bodyTypes.values.map((b) => BODY[b]).join(" or ")} was required`,
      `${cap(BODY[e.bodyType] || "")}, as required`);
  }
  if (req.mustHaveFeatures?.length) {
    const feats = (car.features || []).map((f) => String(f).toLowerCase());
    const missing = req.mustHaveFeatures.filter((m) => !feats.some((f) => f.includes(String(m).toLowerCase())));
    add("H8_features", missing.length === 0, `${missing.join(", ")} not listed — required`, `Lists ${req.mustHaveFeatures.join(", ")}`);
  }
  return out;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/* §4 Soft score helpers. */
const minMax = (values) => {
  const known = values.filter((v) => v !== null);
  const lo = Math.min(...known), hi = Math.max(...known);
  return (v) => (v === null ? null : hi === lo ? 1 : (v - lo) / (hi - lo));
};

function softCriteria(req, passing) {
  // Ranks among the passing cars only (§4 "min-max rank").
  const effs = passing.map((c) => effective(c));
  const kmplRank = minMax(effs.map((e) => e.fuelEconomyKmpl));
  const powerRank = minMax(effs.map((e) => e.powerHp));
  const priceRank = minMax(passing.map((c) => Number(c.price) || 0));

  const list = [];
  if (req.budgetMaxInr != null)
    // Every car here already passed H2, so it is within budget: score 1. Using
    // more of the budget is never a reason to rank higher (spec §4, amended).
    list.push({ criterion: "Budget fit", weight: 20, of: (c) => ({ score: 1, confidence: 1, evidence: `${money(Number(c.price))} of ${money(req.budgetMaxInr)}` }) });

  const usage = { city: "city_suitability", highway: "highway_suitability", rough_roads: "rough_road_suitability", family: "family_practicality" };
  const usageLabel = { city: "City use", highway: "Highway use", rough_roads: "Rough roads", family: "Family use" };
  for (const u of req.usage || [])
    if (usage[u]) list.push({ criterion: usageLabel[u], weight: 15, tag: usage[u], of: (c, s) => fromTag(s[usage[u]]) });

  for (const p of req.priorities || []) {
    if (p === "fuel_economy")
      list.push({ criterion: "Fuel economy", weight: 10, of: (c) => {
        const v = effective(c).fuelEconomyKmpl;
        return v === null ? { score: 0, confidence: 0, evidence: "Fuel economy not listed" } : { score: kmplRank(v), confidence: 1, evidence: `${v} kmpl` };
      } });
    if (p === "comfort") list.push({ criterion: "Comfort (space)", weight: 10, tag: "family_practicality", of: (c, s) => fromTag(s.family_practicality) });
    if (p === "performance")
      list.push({ criterion: "Performance", weight: 10, of: (c) => {
        const v = effective(c).powerHp;
        return v === null ? { score: 0, confidence: 0, evidence: "Power not listed" } : { score: powerRank(v), confidence: 1, evidence: `${v} hp` };
      } });
    if (p === "low_price")
      // Cheapest passing car scores 1. When every passing car costs the same (or
      // there is only one), all score 1: nothing is cheaper (spec §4, amended).
      list.push({ criterion: "Low price", weight: 10, of: (c) => {
        const same = new Set(passing.map((x) => Number(x.price) || 0)).size <= 1;
        return { score: same ? 1 : 1 - priceRank(Number(c.price) || 0), confidence: 1, evidence: money(Number(c.price)) };
      } });
    if (p === "safety")
      list.push({ criterion: "Safety equipment", weight: 10, of: (c) => {
        const e = effective(c);
        const parts = [e.airbags !== null ? e.airbags >= 6 : null, e.ncapStars !== null ? e.ncapStars >= 4 : null];
        const known = parts.filter((x) => x !== null);
        return {
          score: known.length ? known.filter(Boolean).length / known.length : 0,
          confidence: known.length / 2,
          evidence: known.length ? [e.airbags !== null && `${e.airbags} airbags`, e.ncapStars !== null && `${e.ncapStars}-star NCAP`].filter(Boolean).join(", ") : "Airbags and NCAP rating not listed",
        };
      } });
    // "reliability" is deliberately not scored: CarVerse holds no reliability data.
  }

  const preferred = [
    ["transmission", "Preferred transmission", (e, v) => (e.transmissionStatus === "ok" ? e.transmissionNorm === v : null)],
    ["fuel", "Preferred fuel", (e, v) => (e.fuelStatus === "ok" ? e.fuelTypes.includes(v) : null)],
  ];
  for (const [key, criterion, test] of preferred)
    if (req[key]?.strength === "preferred")
      list.push({ criterion, weight: 10, of: (c) => {
        const r = test(effective(c), req[key].value);
        return r === null ? { score: 0, confidence: 0, evidence: "Not listed" } : { score: r ? 1 : 0, confidence: 1, evidence: r ? "Matches" : "Does not match" };
      } });
  if (req.bodyTypes?.strength === "preferred")
    list.push({ criterion: "Preferred body type", weight: 10, of: (c) => {
      const b = effective(c).bodyType;
      return b === null ? { score: 0, confidence: 0, evidence: "Body type not listed" } : { score: req.bodyTypes.values.includes(b) ? 1 : 0, confidence: 1, evidence: BODY[b] };
    } });
  return list;
}

const fromTag = (t) => ({ score: t.score, confidence: t.confidence, evidence: t.evidence.join("; ") || "No supporting specifications", level: t.level, notListed: t.notListed });
const round3 = (n) => Math.round(n * 1000) / 1000;

/** §2–§8. Pure: requirements (already validated) + raw cars -> ranking. */
export function rank(req, cars) {
  const evaluated = cars.map((car) => {
    const e = effective(car);
    const hard = hardConstraints(req, car, e);
    return { car, e, hard, failed: hard.filter((h) => !h.pass) };
  });

  // §2 Only cars that passed EVERY hard constraint are ever scored or returned.
  const passing = evaluated.filter((x) => x.failed.length === 0);
  const criteria = softCriteria(req, passing.map((x) => x.car));
  const totalWeight = criteria.reduce((n, c) => n + c.weight, 0);

  const scored = passing.map(({ car, e, hard }) => {
    const tags = suitability(car);
    const breakdown = criteria.map((cr) => {
      const r = cr.of(car, tags);
      return { criterion: cr.criterion, weight: cr.weight, score: round3(r.score), confidence: round3(r.confidence), evidence: r.evidence, ...(r.level ? { level: r.level } : {}) };
    });
    const score = totalWeight
      ? Math.round((100 * breakdown.reduce((n, b) => n + b.weight * b.score * b.confidence, 0)) / totalWeight)
      : 100;
    return { car, e, hard, tags, breakdown, score };
  });

  // §5 Order and tie-breaking, then at most 3.
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (Number(a.car.price) || 0) - (Number(b.car.price) || 0) ||
      (Number(b.car.year) || 0) - (Number(a.car.year) || 0) ||
      String(a.car.id).localeCompare(String(b.car.id))
  );

  const results = scored.slice(0, 3).map(({ car, e, hard, tags, breakdown, score }) => ({
    carId: car.id,
    title: title(car),
    price: Number(car.price) || null,
    year: car.year ?? null,
    image: car.mainImage || (car.gallery || [])[0] || car.thumbnail || null,
    score,
    hardConstraints: Object.fromEntries(hard.filter((h) => h.name !== "H1_not_sold").map((h) => [h.name, "pass"])),
    breakdown,
    suitability: tags,
    explanation: explain(hard, breakdown, tags),
    missingData: missingData(e, breakdown),
  }));

  // §6 Near misses: not sold, exactly one failed constraint, budget misses within 20%.
  const near = evaluated
    .filter((x) => x.failed.length === 1 && x.failed[0].name !== "H1_not_sold")
    .filter((x) => x.failed[0].name !== "H2_budget_max" || (Number(x.car.price) || 0) <= req.budgetMaxInr * 1.2)
    .sort((a, b) => {
      const ab = a.failed[0].name === "H2_budget_max", bb = b.failed[0].name === "H2_budget_max";
      if (ab !== bb) return ab ? -1 : 1;
      return (Number(a.car.price) || 0) - (Number(b.car.price) || 0);
    })
    .slice(0, 3)
    .map(({ car, failed }) => ({ carId: car.id, title: title(car), price: Number(car.price) || null, failed: [failed[0].reason] }));

  return { results, nearMisses: near, meta: { candidatesBefore: cars.length, candidatesAfter: passing.length } };
}

/* §7 Explanations come only from templates over the actual ranking. */
function explain(hard, breakdown, tags) {
  const lines = hard.filter((h) => h.name !== "H1_not_sold" && h.passText).map((h) => h.passText);
  for (const b of breakdown) {
    if (b.criterion === "Budget fit") continue; // already stated by the budget line
    if (b.score < 0.67 || b.confidence < 0.5) continue; // a weak criterion is never described as a strength
    if (b.level) lines.push(`${b.criterion}: ${b.level} (estimate). Based on: ${b.evidence}`);
    else lines.push(`${b.criterion}: ${b.evidence}`);
  }
  return lines;
}

function missingData(e, breakdown) {
  const out = new Set();
  if (e.odometerKm === null) out.add("kilometres driven");
  for (const [k, label] of [["fuelEconomyKmpl", "fuel economy"], ["powerHp", "power"], ["bootLitres", "boot capacity"], ["bodyType", "body type"], ["groundClearanceMm", "ground clearance"]])
    if (e[k] === null) out.add(label);
  if (breakdown.some((b) => b.criterion === "Safety equipment" && b.confidence < 1)) out.add("safety ratings");
  return [...out];
}
