// Gemini's only job in photo-to-listing: say what is VISIBLE in the admin's
// photos, with a status and confidence per field and the photo numbers that
// show it. server/listing/validate.js then checks every value in plain code;
// nothing is saved or published until the admin reviews it in the car form.
import { BODY_VALUES } from "../../public/app/js/core/requirements.js";

export const STATUSES = ["observed", "uncertain", "not_visible"];
export const SEVERITIES = ["minor", "moderate", "major", "unclear"];

const field = (valueSchema) => ({
  type: "OBJECT",
  properties: {
    value: { ...valueSchema, nullable: true },
    status: { type: "STRING", enum: STATUSES },
    confidence: { type: "NUMBER" },
    evidence: { type: "STRING" },
    photos: { type: "ARRAY", items: { type: "INTEGER" } },
  },
  required: ["value", "status", "confidence", "evidence", "photos"],
});

export const LISTING_SCHEMA = {
  type: "OBJECT",
  properties: {
    sameCarInAllPhotos: { type: "BOOLEAN" },
    make: field({ type: "STRING" }),
    model: field({ type: "STRING" }),
    variant: field({ type: "STRING" }),
    bodyType: field({ type: "STRING", enum: BODY_VALUES }),
    colour: field({ type: "STRING" }),
    odometerKm: field({ type: "INTEGER" }),
    damage: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          area: { type: "STRING" },
          description: { type: "STRING" },
          severity: { type: "STRING", enum: SEVERITIES },
          confidence: { type: "NUMBER" },
          photos: { type: "ARRAY", items: { type: "INTEGER" } },
        },
        required: ["area", "description", "severity", "confidence", "photos"],
      },
    },
    features: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          status: { type: "STRING", enum: ["observed", "uncertain"] },
          confidence: { type: "NUMBER" },
          photos: { type: "ARRAY", items: { type: "INTEGER" } },
        },
        required: ["name", "status", "confidence", "photos"],
      },
    },
    description: { type: "STRING" },
    imageNotes: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["sameCarInAllPhotos", "make", "model", "variant", "bodyType", "colour", "odometerKm", "damage", "features", "description", "imageNotes"],
};

export const LISTING_PROMPT = `You help a used-car dealer draft a listing from photos of ONE car. Photos are numbered 1..N in the order given.

Report only what the photos show. Never use general knowledge about the model to fill a gap.

For each field give value, status, confidence (0 to 1), evidence (what in which photo shows it) and photos (the photo numbers):
- status "observed": clearly readable or visible (a badge, a legible odometer, the paint in good light).
- status "uncertain": a reasonable reading but not certain (styling suggests the model but no badge is readable; colour affected by lighting).
- status "not_visible": the photos do not show it. Then value must be null and confidence 0.
- make / model: from badges, or unmistakable design. Without a readable badge, use "uncertain".
- variant: ONLY from a readable variant badge or label. Otherwise null and "not_visible".
- bodyType: one of hatchback, sedan, compact_suv, suv, muv, coupe, pickup, convertible, judged from the body shape.
- colour: a plain colour name as it appears (e.g. "white", "dark grey").
- odometerKm: ONLY if the odometer reading on the instrument cluster is legible in a photo; the number in km. Otherwise null and "not_visible". Never estimate from wear.
- damage: only visible scratches, dents, cracks, rust, paint mismatch, broken parts. Empty list if none is visible. Do not say the car is undamaged.
- features: only equipment visible in the photos (e.g. sunroof, alloy wheels, touchscreen, reversing camera lens, LED headlamps). "uncertain" if partly visible.
- description: a 2-4 sentence draft using ONLY values you marked "observed". No price, no kilometres unless observed, no service history, ownership, accident history, condition grades or claims you cannot see. No marketing superlatives.
- sameCarInAllPhotos: false if any photo seems to show a different car.
- imageNotes: short notes on photo problems (blurry, dark, not a car, a different car).`;
