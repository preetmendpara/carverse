# CarVerse AI features

Every AI feature follows one rule: **Gemini reads, plain code decides.**
Gemini is called only from the Worker (`server/lib/gemini.js`, key in the
Worker secret `GEMINI_API_KEY`). It returns JSON against a fixed schema; the
application validates that JSON and does all filtering, ranking and scoring.
No AI output is published or acted on without code checks, and the admin
features write nothing until an admin reviews the result.

| Feature | Route | Who | Gemini does | Code does | Writes |
|---|---|---|---|---|---|
| AI Car Finder | `POST /api/match` | signed-in buyer | requirements from the sentence | validation, hard filters, ranking, explanations (`server/match/rank.js`, `docs/RANKING-SPEC.md`) | `matchLogs` (buyer's own token) |
| Assistant chat | `POST /api/chat` | signed-in buyer | intent + the same requirements | routes to the Finder pipeline, or answers about ONE car record | `matchLogs` for recommendations |
| AI Compare | `POST /api/compare-ai` | signed-in buyer | explains which shortlisted car fits the question, citing fact ids | facts, key differences, missing data (`server/compare/context.js`); checks citations and the winner | nothing |
| Photo-to-listing | `POST /api/photo-listing` | admin | what is visible in 5-10 photos | `server/listing/validate.js` | nothing (admin saves the car) |

## AI Compare

The Compare page has one mode: the buyer's shortlist (2-4 cars, selected as
before) plus a question such as "Which is better for my parents?". The old
side-by-side table is gone; a table of key differences is still shown under
the answer.

- The browser sends only `{ carIds, question }`. The Worker loads those cars
  from the catalogue, so a request cannot supply its own "facts".
- `buildCompareContext` turns each car into facts from `effectiveFields`
  (price, year, body type, fuel, transmission, economy, km, power, seats, boot,
  ground clearance, airbags, NCAP, owners, listed features), each with an id
  such as `B.bootLitres`. Missing facts and listing conflicts are listed per
  car. Key differences (and which car leads on each) are computed in code.
- Only those cars' facts go to Gemini, never the catalogue. Gemini returns a
  verdict per car, reasoning, the fact ids it relied on, a summary, and a
  winner or null.
- `validateComparison` drops any cited id that is not a real fact of that
  car. A verdict with no supporting fact becomes `insufficient_data`. A
  winner is kept only when exactly one car is `best_fit` with cited facts and
  Gemini named that car; otherwise the answer says there is no clear winner.
- The page labels the answer as a recommendation from listing data, shows the
  facts behind each judgement, and says "Not provided in the listing." for
  missing data. Nothing is stored.

Response: `{ question, winner|null, winnerReason, summary, assessments[{ref,
carId, car, verdict, reasoning, evidence[], missingData[]}], evidence[],
missingData[], keyDifferences[], disclaimer, model }`. A question that is not
about choosing between the cars gets 422 `not_a_comparison`.

## Photo-to-listing

Admin car form → "AI photo-to-listing". Photos are shrunk in the browser
(longest edge 1600 px, JPEG) and sent to the Worker, which checks count (5-10),
type (JPEG/PNG/WebP) and size, then asks Gemini (`gemini-3.8-flash` first).

Per field (`make`, `model`, `variant`, `bodyType`, `colour`, `odometerKm`)
Gemini returns `value`, `status` (`observed` / `uncertain` / `not_visible`),
`confidence`, `evidence` and the photo numbers. Plus visible `features`,
visible `damage`, a draft `description` and photo warnings.

Rules applied in code (`validate.js`), whatever Gemini said:

- `not_visible` or no value → value `null`, confidence 0.
- `observed` needs confidence ≥ 0.7, evidence and a valid photo number;
  otherwise it becomes `uncertain` (confidence capped below 0.7).
- `bodyType` must be one of the schema values.
- `odometerKm` only when `observed` (a legible odometer) and ≤ 1,000,000;
  otherwise dropped with a warning. It is never estimated.
- Damage and features need a valid photo number. "No damage found" is shown as
  "none identified in these photos", never as "undamaged".

Review and save:

- Only `observed` values with confidence ≥ 0.8 start ticked. The admin ticks or
  unticks, then presses "Fill the form". Nothing is filled before that.
- Filling sets the car's status to **Draft**. Publishing is a separate, manual
  choice.
- On save, a value the admin applied and left unchanged gets provenance
  `ai-photo` (shown as "From photos (AI), reviewed by admin"). A value the admin
  edited is the admin's (`admin`). The whole reading, including statuses,
  confidences, evidence and damage, is stored in `cars/{id}.aiListing` together
  with which values were kept.
- An unknown brand is never created: the admin is told to add it first.

## Firestore

No rule changes. `cars` is already admin-writable; the new field `aiListing`
and the provenance value `ai-photo` are optional, so existing documents and
pages are unaffected. AI Compare writes nothing.
