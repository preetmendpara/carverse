// AI Personalized Compare: the deterministic half. Pure, no AI, no network.
//
//   buildCompareContext(cars)  -> the ONLY facts Gemini sees, each with an id
//                                 ("A.price"), plus key differences and
//                                 missing data computed here, never by the AI
//   validateComparison(raw, ctx) -> Gemini's answer checked against those
//                                 facts: unknown citations dropped, a winner
//                                 kept only when the evidence supports one
import { effectiveFields, BODY_TYPES, FUELS, TRANSMISSIONS } from "../../public/app/js/core/car-fields.js";

export const NOT_PROVIDED = "Not provided in the listing.";
export const VERDICTS = ["best_fit", "good_fit", "partial_fit", "poor_fit", "insufficient_data"];
export const DISCLAIMER =
  "This is a recommendation based on the information in these listings, not an objective fact. Inspect the car and check the details with the dealer before deciding.";

const REFS = ["A", "B", "C", "D"];
const label = (list, v) => list.find(([k]) => k === v)?.[1] || v;
const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;
const title = (c) => [c.year, c.brandName, c.model, c.variant].filter(Boolean).join(" ");

// [key, label, value(car, effective) -> number|string|null, format, better: "high"|"low"|null]
const FACTS = [
  ["price", "Price", (c) => (Number(c.price) > 0 ? Number(c.price) : null), inr, "low"],
  ["year", "Year", (c) => (Number.isInteger(Number(c.year)) && c.year ? Number(c.year) : null), String, "high"],
  ["bodyType", "Body type", (c, e) => e.bodyType, (v) => label(BODY_TYPES, v), null],
  ["fuel", "Fuel", (c, e) => (e.fuelStatus === "ok" && e.fuelTypes?.length ? e.fuelTypes.map((f) => label(FUELS, f)).join(" / ") : null), String, null],
  ["transmission", "Transmission", (c, e) => (e.transmissionStatus === "ok" ? e.transmissionNorm : null), (v) => label(TRANSMISSIONS, v), null],
  ["fuelEconomyKmpl", "Fuel economy", (c, e) => e.fuelEconomyKmpl, (v) => `${v} kmpl`, "high"],
  ["odometerKm", "Kilometres driven", (c, e) => e.odometerKm, (v) => `${Math.round(v).toLocaleString("en-IN")} km`, "low"],
  ["powerHp", "Power", (c, e) => e.powerHp, (v) => `${v} hp`, "high"],
  ["seats", "Seats", (c, e) => e.seats, String, "high"],
  ["bootLitres", "Boot space", (c, e) => e.bootLitres, (v) => `${v} litres`, "high"],
  ["groundClearanceMm", "Ground clearance", (c, e) => e.groundClearanceMm, (v) => `${v} mm`, "high"],
  ["airbags", "Airbags", (c, e) => e.airbags, String, "high"],
  ["ncapStars", "NCAP rating", (c, e) => e.ncapStars, (v) => `${v}-star`, "high"],
  ["owners", "Previous owners", (c, e) => e.owners, String, "low"],
  ["features", "Listed features", (c) => ((c.features || []).filter(Boolean).length ? c.features.filter(Boolean).slice(0, 20).join(", ") : null), String, null],
];

/** cars: 2-4 catalogue cars. Returns { cars: [{ref, carId, title, facts, missing}], keyDifferences } */
export function buildCompareContext(cars) {
  const list = cars.slice(0, 4).map((car, i) => {
    const e = effectiveFields(car);
    const facts = [];
    const missing = [];
    for (const [key, name, get, fmt] of FACTS) {
      const raw = get(car, e);
      if (raw === null || raw === undefined || raw === "") missing.push(name);
      else facts.push({ id: `${REFS[i]}.${key}`, key, label: name, value: raw, text: fmt(raw) });
    }
    // Conflicting listing data is reported as such, never resolved by the AI.
    if (e.fuelStatus === "conflict") missing.push("Fuel (the listing contradicts itself)");
    if (e.transmissionStatus === "conflict") missing.push("Transmission (the listing contradicts itself)");
    return { ref: REFS[i], carId: car.id, title: title(car), facts, missing };
  });
  return { cars: list, keyDifferences: keyDifferences(list) };
}

/** Facts where the cars differ, with which car leads, worked out in code. */
function keyDifferences(list) {
  const out = [];
  for (const [key, name, , , better] of FACTS) {
    const have = list.map((c) => ({ c, f: c.facts.find((f) => f.key === key) })).filter((x) => x.f);
    if (have.length < 2) continue;
    const distinct = new Set(have.map((x) => String(x.f.value)));
    if (distinct.size < 2) continue;
    const values = have.map((x) => ({ ref: x.c.ref, car: x.c.title, value: x.f.text }));
    let leader = null;
    if (better && have.every((x) => typeof x.f.value === "number")) {
      const best = (better === "high" ? Math.max : Math.min)(...have.map((x) => x.f.value));
      const top = have.filter((x) => x.f.value === best);
      if (top.length === 1) leader = { ref: top[0].c.ref, car: top[0].c.title, note: better === "high" ? `Highest ${name.toLowerCase()}` : `Lowest ${name.toLowerCase()}` };
    }
    out.push({ fact: name, values, leader, ...(have.length < list.length ? { note: `${NOT_PROVIDED.slice(0, -1)} for ${list.length - have.length} car(s).` } : {}) });
  }
  return out;
}

const text = (s, max) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

/**
 * raw: Gemini's answer; ctx: buildCompareContext() output.
 * Returns { relevant, winner, winnerReason, summary, assessments[], evidence[] }.
 */
export function validateComparison(raw, ctx) {
  const r = raw && typeof raw === "object" ? raw : {};
  const byId = new Map(ctx.cars.flatMap((c) => c.facts.map((f) => [f.id, { ...f, ref: c.ref, car: c.title }])));
  const cite = (ids) => [...new Set(Array.isArray(ids) ? ids : [])].filter((id) => byId.has(id));

  const assessments = ctx.cars.map((c) => {
    const a = (Array.isArray(r.assessments) ? r.assessments : []).find((x) => x?.ref === c.ref) || {};
    const evidence = cite(a.evidence).filter((id) => byId.get(id).ref === c.ref);
    let verdict = VERDICTS.includes(a.verdict) ? a.verdict : "insufficient_data";
    // A judgement with no listing fact behind it is not a judgement.
    if (verdict !== "insufficient_data" && !evidence.length) verdict = "insufficient_data";
    return {
      ref: c.ref,
      carId: c.carId,
      car: c.title,
      verdict,
      reasoning: text(a.reasoning, 600) || NOT_PROVIDED,
      evidence: evidence.map((id) => ({ id, label: byId.get(id).label, value: byId.get(id).text })),
      missingData: c.missing,
    };
  });

  // A winner only when exactly one car is the best fit and its case cites facts.
  const best = assessments.filter((a) => a.verdict === "best_fit");
  let winner = null;
  if (typeof r.winner === "string" && best.length === 1 && best[0].ref === r.winner && best[0].evidence.length) winner = best[0];

  const evidence = cite(r.evidence).map((id) => ({ id, car: byId.get(id).car, label: byId.get(id).label, value: byId.get(id).text }));
  return {
    relevant: r.relevant !== false,
    winner: winner ? { ref: winner.ref, carId: winner.carId, car: winner.car } : null,
    winnerReason: winner ? text(r.winnerReason, 400) : text(r.noWinnerReason, 400) || "The listing data does not clearly favour one car for this question.",
    summary: text(r.summary, 900),
    assessments,
    evidence,
  };
}
