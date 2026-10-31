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
      budgetText(price, req.budgetMaxInr));
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
  if (req.brands?.length) {
    const brand = String(car.brandName || "").trim();
    const ok = req.brands.some((b) => b.toLowerCase() === brand.toLowerCase());
    add("H9_brand", ok, `${brand || "Brand not listed"} — ${req.brands.join(" or ")} was required`, `${brand}, as required`);
  }
  if (req.models?.length) {
    const name = `${car.brandName || ""} ${car.model || ""}`.trim();
    const ok = req.models.some((m) => m.toLowerCase() === name.toLowerCase());
    add("H10_model", ok, `${name || "Model not listed"} — ${req.models.join(" or ")} was required`, `${name}, as required`);
  }
  if (req.variants?.length) {
    const v = String(car.variant || "").trim();
    const ok = req.variants.some((x) => x.toLowerCase() === v.toLowerCase());
    add("H11_variant", ok, `${v ? `${v} variant` : "Variant not listed"} — ${req.variants.join(" or ")} was required`, `${v} variant, as required`);
  }
  if (req.mustHaveFeatures?.length) {
    const feats = (car.features || []).map((f) => String(f).toLowerCase());
    const missing = req.mustHaveFeatures.filter((m) => !feats.some((f) => f.includes(String(m).toLowerCase())));
    add("H8_features", missing.length === 0, `${missing.join(", ")} not listed — required`, `Lists ${req.mustHaveFeatures.join(", ")}`);
  }
  return out;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** "₹78 lakh of your ₹80 lakh budget — ₹2 lakh left (98% used)". */
function budgetText(price, max) {
  const used = Math.round((100 * price) / max);
  const left = max - price;
  return `${money(price)} of your ${money(max)} budget — ${left > 0 ? `${money(left)} left` : "exactly on budget"} (${used}% used)`;
}

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
  const cheapest = (req.priorities || []).includes("low_price");
  if (req.budgetMaxInr != null && !cheapest)
    // Every car here already passed H2 (price <= budget). The closer a car is to
    // the budget ceiling, the better it uses what the buyer said they can spend:
    // score = price / budget (spec §4, amended 2026-10). When the buyer asks for
    // the cheapest car, "Low price" ranks instead and this is not added.
    list.push({ criterion: "Budget fit", weight: 20, budget: true, of: (c) => {
      const p = Number(c.price) || 0;
      return { score: Math.min(1, p / req.budgetMaxInr), confidence: 1, evidence: budgetText(p, req.budgetMaxInr) };
    } });

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
  // With other soft criteria, budget closeness only separates otherwise
  // comparable cars: it never outweighs the buyer's stated needs. It stays in
  // the breakdown (weight 0) and decides ties, closest to the ceiling first.
  const budget = list.find((x) => x.budget);
  if (budget && list.length > 1) {
    budget.weight = 0;
    const of = budget.of;
    budget.of = (c) => ({ ...of(c), evidence: `${of(c).evidence}; used only to break ties` });
  }
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
  // Ties: with a budget (and no "cheapest" request) the car closer to the
  // budget ceiling first; otherwise the cheaper car first.
  const pricierFirst = req.budgetMaxInr != null && !(req.priorities || []).includes("low_price");
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (pricierFirst ? -1 : 1) * ((Number(a.car.price) || 0) - (Number(b.car.price) || 0)) ||
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
  // A different brand/model/variant than the one named is never a near miss
  // (it is not "almost" what was asked for). When a brand or model was named,
  // that car's own budget miss is shown however far over, so the buyer sees
  // why the car they asked for did not match.
  const named = Boolean(req.brands?.length || req.models?.length);
  const NAME_CHECKS = new Set(["H9_brand", "H10_model", "H11_variant"]);
  const near = evaluated
    .filter((x) => x.failed.length === 1 && x.failed[0].name !== "H1_not_sold" && !NAME_CHECKS.has(x.failed[0].name))
    .filter((x) => x.failed[0].name !== "H2_budget_max" || named || (Number(x.car.price) || 0) <= req.budgetMaxInr * 1.2)
    .sort((a, b) => {
      const ab = a.failed[0].name === "H2_budget_max", bb = b.failed[0].name === "H2_budget_max";
      if (ab !== bb) return ab ? -1 : 1;
      return (Number(a.car.price) || 0) - (Number(b.car.price) || 0);
    })
    .slice(0, 3)
    .map(({ car, failed }) => ({ carId: car.id, title: title(car), price: Number(car.price) || null, failed: [failed[0].reason] }));

  // Every car that met all hard requirements, in rank order (the Cars grid
  // shows exactly these; the top 3 above get full explanations).
  const matchedIds = scored.map((x) => x.car.id);
  return { results, nearMisses: near, matchedIds, meta: { candidatesBefore: cars.length, candidatesAfter: passing.length } };
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
