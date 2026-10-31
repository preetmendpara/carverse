// The one matching pipeline: validated requirements -> rank() -> response.
// Used by BOTH the Car Finder (/api/match) and the chatbot's "recommend" path,
// so the two can never rank differently. Pure: no network, no AI, no clock.
import { rank } from "./rank.js";
import { nameSearch } from "../../public/app/js/core/name-search.js";

const CHEAPEST = /\b(cheapest|cheaper|lowest[- ]price[ds]?|least expensive|most affordable|maximum savings|budget[- ]friendly)\b/i;

/**
 * Facts read from the buyer's own words by code, added to what Gemini
 * extracted: catalogue brands they named ("Toyota under 20 lakh") and an
 * explicit "cheapest" request. Gemini never sees the catalogue, so brands
 * come from here, never from the AI.
 */
export function queryFacts(raw, query, cars) {
  if (!query) return raw;
  const r = { ...(raw || {}) };
  const n = nameSearch(cars, query);
  const brands = n.ids ? [...new Set(cars.filter((c) => n.ids.has(c.id)).map((c) => String(c.brandName || "").trim()).filter(Boolean))] : [];
  if (brands.length) r.brands = [...new Set([...(Array.isArray(r.brands) ? r.brands : []), ...brands])];
  if (CHEAPEST.test(query)) r.priorities = [...new Set([...(Array.isArray(r.priorities) ? r.priorities : []), "low_price"])];
  return r;
}
import { validateRequirements, understoodChips, isEmpty, budgetUnitQuestion, droppedBudgetQuestion } from "../../public/app/js/core/requirements.js";

/**
 * raw:   requirements from Gemini (free-text query) or from chip edits
 * query: the buyer's own words, or null for chip edits (already confirmed)
 * cars:  published cars
 * Returns { status, body }. The body never contains model names, timings,
 * logging details or anything but what the buyer needs to see.
 */
export function matchResponse({ raw, query, cars }) {
  const { requirements, warnings, clarify: invalid } = validateRequirements(queryFacts(raw, query, cars));
  // A budget from free text must state its unit, checked on the buyer's own words.
  const clarify = invalid || (query ? budgetUnitQuestion(query, requirements) || droppedBudgetQuestion(query, requirements) : null);
  if (clarify) return { status: 422, body: { error: "clarify", message: clarify, requirements, understood: understoodChips(requirements) } };
  if (isEmpty(requirements))
    return {
      status: 422,
      body: { error: "empty", message: "Tell me at least one thing you need, such as a budget, gearbox or how you'll drive.", requirements, understood: [] },
    };

  const ranked = rank(requirements, cars);
  return {
    status: 200,
    body: {
      requirements,
      understood: understoodChips(requirements),
      validation: { ok: true, warnings },
      results: ranked.results,
      nearMisses: ranked.nearMisses,
      matchedIds: ranked.matchedIds,
      meta: { candidatesBefore: ranked.meta.candidatesBefore, candidatesAfter: ranked.meta.candidatesAfter },
    },
  };
}
