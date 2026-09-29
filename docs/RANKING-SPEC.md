# CarVerse matching: ranking specification

This document is the source of truth for how `/api/match` turns a buyer's
extracted requirements into ranked cars. `server/match/rank.js` and
`public/app/js/core/car-tags.js` implement exactly this, and
`scripts/test-rank.mjs` checks them against it. If the code and this document
disagree, the code is wrong.

No step here uses AI. Gemini only turns the buyer's sentence into the
requirements object (section 1). Everything after that is plain code.

## 0. Car data: one interpretation, shared with the website

Ranking never reads raw Firestore fields such as `fuelType` or
`transmission`. It reads the **effective record** produced by
`effectiveFields(car)` in `public/app/js/core/car-fields.js`, the same
function the website uses for cards, detail pages, compare, filters and search.

- The Worker imports that file directly
  (`import { effectiveFields } from "../../public/app/js/core/car-fields.js"`);
  `wrangler deploy` bundles it. There is no second copy of the rules.
- `car-fields.js` must stay free of imports and browser APIs so both sides can
  load it. `scripts/test-normalize.mjs` fails if that changes.
- Each field has a status. `fuelStatus` / `transmissionStatus` of `conflict` or
  `missing` means **unknown**, and unknown fails a hard constraint (section 2),
  exactly as the website's filters exclude such a car from a specific fuel or
  transmission.
- Numbers in the effective record are numbers, and missing values are `null`,
  never guessed. Placeholder odometers, unverified `carModels` data and legacy
  "km" mileage are never used.

## 1. Input: the requirements object

Produced by Gemini with a fixed JSON schema, then validated in code.

| Field | Type | Example |
|---|---|---|
| `budgetMaxInr` | number or null | `1200000` |
| `budgetMinInr` | number or null | `null` |
| `transmission` | `{value: "automatic"\|"manual", strength}` or null | `{value: "automatic", strength: "required"}` |
| `fuel` | `{value: "petrol"\|"diesel"\|"cng"\|"hybrid"\|"electric", strength}` or null | `null` |
| `seatsMin` | number or null | `null` |
| `bodyTypes` | `{values: [...], strength}` or null | `null` |
| `usage` | subset of `city`, `highway`, `rough_roads`, `family` | `["city", "highway"]` |
| `priorities` | subset of `fuel_economy`, `safety`, `comfort`, `performance`, `low_price`, `reliability` | `["reliability", "comfort"]` |
| `mustHaveFeatures` | list of strings | `[]` |

**Strength.** An attribute stated plainly ("an automatic car", "diesel") is
`required`. An attribute stated with hedging ("preferably", "ideally", "if
possible") is `preferred`. The buyer sees every requirement as a chip and can
switch required/preferred or remove it, so a wrong guess is visible and
correctable.

**Validation (code, before ranking).**
- `budgetMaxInr` outside ₹1,00,000 – ₹10,00,00,000 → ask the buyer to confirm, do not rank.
- `budgetMinInr > budgetMaxInr` → swap them and add a warning.
- `seatsMin` outside 1–9 → ask the buyer to confirm.
- Any enum value not in the lists above → dropped, with a warning.
- `reliability` in `priorities` → kept for display, not scored (section 4), with a warning.

## 2. Hard constraints

Pass or fail. A car that fails any hard constraint is **never** in the results,
whatever it would have scored. Hard constraints are checked before any score is
computed, and scoring only runs on cars that passed.

| # | Constraint | Applies when | Fails when |
|---|---|---|---|
| H1 | Not sold | always | `availability == "sold"` |
| H2 | Maximum budget | `budgetMaxInr` set | `price > budgetMaxInr` (no tolerance) |
| H3 | Minimum budget | `budgetMinInr` set | `price < budgetMinInr` |
| H4 | Transmission | `transmission.strength == "required"` | `transmissionNorm != value` |
| H5 | Fuel | `fuel.strength == "required"` | `value` not in `fuelTypes` |
| H6 | Seats | `seatsMin` set | `seats < seatsMin` |
| H7 | Body type | `bodyTypes.strength == "required"` | `bodyType` not in `values` |
| H8 | Must-have features | `mustHaveFeatures` not empty | any feature not found in `features` (case-insensitive substring) |

**Unknown is a fail, not a pass.** If the field a constraint needs is null on
the car (seats not recorded, transmission unclear because of a data conflict),
the car fails that constraint. Its near-miss reason names the missing data:
"Seats not recorded", "Transmission unclear in the listing".

**Worked examples (both are tests):**
- Budget ₹12,00,000, car ₹15,00,000 → fails H2 → not in results, even if every soft criterion scores 1.0.
- Automatic required, car manual → fails H4 → not in results.

## 3. Suitability estimates (`car-tags.js`)

These are **estimates from listed specifications**, not facts about the car.
The UI always shows them with the evidence they used and the line "Estimate
based on the listed specifications."

Each estimate checks a fixed set of conditions. A condition whose field is null
is **unknown**: it is neither met nor failed.

```
score      = met ÷ known          (0 when known = 0)
confidence = known ÷ total
level      = "Not enough data"   if confidence < 0.5
             "High"              if score ≥ 0.67
             "Medium"            if score ≥ 0.34
             "Low"               otherwise
```

| Estimate | Conditions (each met or not, or unknown if the field is null) |
|---|---|
| `city_suitability` | `transmissionNorm == "automatic"` · `bodyType` in {hatchback, compact_suv, sedan} · `fuelEconomyKmpl ≥ 15` |
| `highway_suitability` | `bodyType` in {sedan, compact_suv, suv, muv} · `powerHp ≥ 100` · `fuelEconomyKmpl ≥ 12` |
| `family_practicality` | `seats ≥ 5` · `bootLitres ≥ 350` or `seats ≥ 7` |
| `rough_road_suitability` | `groundClearanceMm ≥ 200` · `bodyType` in {suv, compact_suv, muv, pickup} |

Evidence lines quote the value used, for example "Automatic transmission",
"Compact SUV body type", "Listed fuel economy of 17.9 kmpl". Unknown conditions
are listed separately as "Not listed: power".

These thresholds are design choices, stated here so they can be questioned and
changed. They are not claims about accessibility, safety or driving ease.

## 4. Soft score

Only cars that passed every hard constraint are scored. Each criterion applies
only when the buyer asked for it.

```
          Σ ( wᵢ × sᵢ × cᵢ )
score = ───────────────────── × 100          over applicable criteria only
               Σ wᵢ

sᵢ ∈ [0,1]  criterion score
cᵢ ∈ [0,1]  data confidence for that criterion (1 when the data is fully present)
```

If no criterion applies, every passing car scores 100 and order falls to the
tie-breaks.

| Criterion | Applies when | wᵢ | sᵢ | cᵢ |
|---|---|---|---|---|
| Budget fit | `budgetMaxInr` set | 20 | `1` for every car within budget (see note) | 1 |
| City use | `"city"` in usage | 15 | `city_suitability.score` | its confidence |
| Highway use | `"highway"` in usage | 15 | `highway_suitability.score` | its confidence |
| Rough roads | `"rough_roads"` in usage | 15 | `rough_road_suitability.score` | its confidence |
| Family use | `"family"` in usage | 15 | `family_practicality.score` | its confidence |
| Fuel economy | priority | 10 | min-max rank of `fuelEconomyKmpl` among passing cars | 1 if known, else 0 |
| Comfort | priority | 10 | `family_practicality.score` | its confidence |
| Performance | priority | 10 | min-max rank of `powerHp` among passing cars | 1 if known, else 0 |
| Low price | priority | 10 | `1 −` min-max rank of `price` among passing cars; `1` when all passing cars cost the same (amended in Phase 1: the plain formula gave a lone candidate 0) | 1 |
| Safety | priority | 10 | `(airbags ≥ 6) + (ncapStars ≥ 4)`, ÷ known | known ÷ 2 |
| Reliability | priority | — | **not scored**: CarVerse holds no reliability data | — |
| Preferred transmission | `strength == "preferred"` | 10 | 1 if matches, else 0 | 1 if known, else 0 |
| Preferred fuel | `strength == "preferred"` | 10 | 1 if matches, else 0 | 1 if known, else 0 |
| Preferred body type | `strength == "preferred"` | 10 | 1 if matches, else 0 | 1 if known, else 0 |

**Min-max rank** among the passing cars: `(v − min) ÷ (max − min)`, and `1` when
all passing cars have the same value. Cars with an unknown value get `cᵢ = 0`.

**Why `× cᵢ`.** Missing data lowers a score instead of being assumed good, so a
car with an unrecorded boot size cannot outrank one with a measured large boot
on family use. Every result lists its missing data openly.

**Budget fit (amended in Phase 1).** The budget is a hard constraint (H2): a car
over budget is never scored. Every car within budget scores `1`, whatever
share of the budget it uses, so spending more of the budget is never a reason
to rank higher. (The first version scored cars far below budget lower, which
let an ₹80 lakh car outrank a ₹20 lakh car on "under ₹1 crore, good mileage".)

## 5. Order and tie-breaking

1. `score`, rounded to a whole number, descending
2. `price`, ascending
3. `year`, descending
4. car `id`, ascending (so the order is fully deterministic)

Return at most **3** results. Return fewer when fewer cars pass; never pad the
list with cars that failed.

## 6. Near misses

Shown separately, under "Close, but not a match", never mixed with results.

A car is a near miss when:
- it is not sold (H1 always applies), and
- it failed exactly **one** hard constraint, and
- if that constraint is H2, the price is at most 20% over `budgetMaxInr`.

At most 3, ordered by how close they are: budget misses by the amount over,
everything else by price ascending. Each shows the single reason it failed, in
plain words: "₹13.5 lakh, ₹1.5 lakh over your budget", "Manual, and you asked for
automatic", "Seats not recorded".

## 7. Explanation rules

Explanations are built from templates, never generated by an LLM, so they can
never say something the ranking didn't do.

For each result, in this order:
1. One line per **hard constraint the buyer set** that it passed, quoting the value:
   "Automatic, as you asked", "₹8.0 lakh, ₹4.0 lakh under your budget".
2. One line per **soft criterion with `sᵢ ≥ 0.67` and `cᵢ ≥ 0.5`**, quoting its
   evidence: "City suitability: High (estimate). Based on: automatic
   transmission, compact SUV body type, listed fuel economy of 17.9 kmpl".
3. A **"Not listed"** line naming the data the ranking needed but did not have:
   "Not listed: kilometres driven, boot space, power".

A criterion that scored low is not described as a strength. A suitability
estimate is always labelled "estimate". No line claims reliability, safety or
condition unless the underlying field is present.

## 8. Output per result

```
{ carId, title, price, score,
  hardConstraints: { <constraint>: "pass" },
  breakdown: [{ criterion, weight, score, confidence, evidence }],
  suitability: { city_suitability: { level, score, confidence, evidence[], notListed[] }, … },
  explanation: [ … ],
  missingData: [ … ] }
```
