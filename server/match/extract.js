// Gemini's only jobs in matching and chat: say what the message is (intent) and
// turn a car request into the requirements object (docs/RANKING-SPEC.md §1).
// It never sees the catalogue and never ranks, names or recommends a car.
// The Car Finder and the chatbot use this same schema and prompt.
import { TRANSMISSION_VALUES, FUEL_VALUES, BODY_VALUES, USAGE_VALUES, PRIORITY_VALUES, INFERABLE } from "../../public/app/js/core/requirements.js";

export const INTENTS = ["recommend", "specific_car", "general", "off_topic"];

const choice = (values) => ({
  type: "OBJECT",
  nullable: true,
  properties: { value: { type: "STRING", enum: values }, strength: { type: "STRING", enum: ["required", "preferred"] } },
  required: ["value", "strength"],
});

export const EXTRACTION_SCHEMA = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING", enum: INTENTS },
    carRef: { type: "STRING", nullable: true },
    budgetMaxInr: { type: "NUMBER", nullable: true },
    budgetMinInr: { type: "NUMBER", nullable: true },
    transmission: choice(TRANSMISSION_VALUES),
    fuel: choice(FUEL_VALUES),
    seatsMin: { type: "INTEGER", nullable: true },
    bodyTypes: {
      type: "OBJECT",
      nullable: true,
      properties: { values: { type: "ARRAY", items: { type: "STRING", enum: BODY_VALUES } }, strength: { type: "STRING", enum: ["required", "preferred"] } },
      required: ["values", "strength"],
    },
    usage: { type: "ARRAY", items: { type: "STRING", enum: USAGE_VALUES } },
    priorities: { type: "ARRAY", items: { type: "STRING", enum: PRIORITY_VALUES } },
    mustHaveFeatures: { type: "ARRAY", items: { type: "STRING" } },
    inferred: { type: "ARRAY", items: { type: "STRING", enum: INFERABLE } },
    unparsed: { type: "ARRAY", items: { type: "STRING" } },
  },
  required: ["intent", "carRef", "budgetMaxInr", "budgetMinInr", "transmission", "fuel", "seatsMin", "bodyTypes", "usage", "priorities", "mustHaveFeatures", "inferred", "unparsed"],
};

export const EXTRACTION_PROMPT = `You read one message sent to an Indian used-car marketplace and return JSON.
You do NOT recommend, name, rank or describe cars. You only classify the message and record what the buyer asked for.

intent:
- "recommend": the buyer wants help finding or choosing a car to buy (budget, needs, "which car should I buy").
- "specific_car": a question about one particular car model, e.g. "tell me about the Maruti Swift", "does the Tata Nexon have a sunroof".
- "general": a general car question not about choosing from stock, e.g. "how often should I service a car", "what is a CVT".
- "off_topic": anything not about cars (coding, maths, news, jokes).
carRef: for "specific_car", the car exactly as the buyer named it (e.g. "Maruti Swift"); otherwise null.

Requirements (fill only for "recommend"; otherwise leave them null or empty):
- Budgets are Indian Rupees as plain numbers. 1 lakh = 100000. 1 crore = 10000000. Number words count ("twelve lakh" = 1200000).
  "under 12 lakh" -> budgetMaxInr 1200000. "8 to 12 lakh" -> budgetMinInr 800000, budgetMaxInr 1200000.
  A number without a unit ("under 12", "budget 15") is NOT a budget: use null and put "budget without a unit" in unparsed.
  Never guess or infer a budget.
- transmission / fuel / bodyTypes: plain statements ("an automatic", "diesel") are "required";
  hedged ones ("preferably", "ideally", "if possible", "open to") are "preferred".
  "SUV" -> suv and compact_suv. "small SUV" / "compact SUV" -> compact_suv. "MPV" / "people carrier" -> muv.
- seatsMin: only if a seat count or "N-seater" is stated.
- usage: city, highway, rough_roads (bad roads, off-road, village roads), family (carrying family members or kids).
- priorities: fuel_economy (mileage, low running cost), safety, comfort, performance, low_price (cheapest), reliability.
- mustHaveFeatures: features the buyer says the car MUST have, e.g. "sunroof". Short words.
- inferred: you MAY add a usage or priority the buyer clearly implies but did not state, and you MAY add a
  transmission or fuel preference only if strongly implied. Every such item MUST be listed in "inferred" by its id:
  "usage:city", "priorities:comfort", "transmission", "fuel", "bodyTypes". Anything stated outright is NOT inferred.
  Example: "a car for my parents" -> priorities ["comfort"], inferred ["priorities:comfort"].
- unparsed: anything else asked for that no field can hold, in a few words ("good resale value", "red colour").
- Never record age, gender, family members or other personal details. Never add anything not stated or clearly implied.`;
