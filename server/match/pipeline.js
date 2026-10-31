// The one matching pipeline: validated requirements -> rank() -> response.
// Used by BOTH the Car Finder (/api/match) and the chatbot's "recommend" path,
// so the two can never rank differently. Pure: no network, no AI, no clock.
import { rank } from "./rank.js";
import { nameSearch, modelMentions } from "../../public/app/js/core/name-search.js";

const CHEAPEST = /\b(cheapest|cheaper|lowest[- ]price[ds]?|least expensive|most affordable|maximum savings|budget[- ]friendly)\b/i;

// Words that describe a kind of car, never a model name.
const GENERIC = /^(any|a|the|some)?\s*(car|cars|suv|suvs|sedan|hatchback|muv|mpv|coupe|pickup|convertible|family car|city car|vehicle|automatic|manual|diesel|petrol|electric|ev|hybrid|cng)s?$/i;

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
  // Specific models / variants named anywhere in the words ("Fortuner under 50
  // lakh", "BMW X1 automatic"). A model the buyer named that CarVerse does not
  // stock (Gemini's carRef, with no catalogue model found) is still required,
  // so the answer is an honest no-match, never other models.
  const m = modelMentions(cars, query);
  const ref = typeof r.carRef === "string" ? r.carRef.trim() : "";
  const refIsBrandOnly = ref && cars.some((c) => String(c.brandName || "").toLowerCase() === ref.toLowerCase());
  if (m.models.length) r.models = m.models;
  else if (ref && !refIsBrandOnly && !GENERIC.test(ref)) r.models = [ref.slice(0, 60)];
  if (m.variants.length) r.variants = m.variants;
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
