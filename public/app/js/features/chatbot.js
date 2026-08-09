// Gemini-powered assistant. Car knowledge always comes from Firestore.
import { GEMINI_API_KEY, GEMINI_MODEL } from "../config/config.js";
import { saveChat, visitorId } from "../core/store.js";
import { loadCatalog, availabilityLabel, availabilityOf } from "../core/catalog.js";
import { esc } from "../components/layout.js";

let context = null;
const history = [];

async function buildContext() {
  if (context) return context;
  const { cars, brands } = await loadCatalog();
  const lines = cars.map((c) => {
    const specs = c.specifications
      ? Object.entries(c.specifications).map(([k, v]) => `${k}: ${v}`).join(", ")
      : "";
    return [
      `- ${[c.brandName, c.model, c.variant].filter(Boolean).join(" ")}`,
      `year: ${c.year ?? "n/a"}`,
      `price: ${c.price ?? "n/a"}`,
      `availability: ${availabilityLabel(availabilityOf(c))}`,
      `fuel: ${c.fuelType ?? "n/a"}`,
      `transmission: ${c.transmission ?? "n/a"}`,
      `engine: ${c.engine ?? "n/a"}`,
      `mileage: ${c.mileage ?? "n/a"}`,
      `horsepower: ${c.horsepower ?? "n/a"}`,
      `torque: ${c.torque ?? "n/a"}`,
      `seats: ${c.seats ?? "n/a"}`,
      `boot: ${c.bootSpace ?? "n/a"}`,
      `ground clearance: ${c.groundClearance ?? "n/a"}`,
      `features: ${(c.features || []).join("; ") || "n/a"}`,
      specs ? `specs: ${specs}` : "",
      c.description ? `description: ${c.description}` : "",
    ]
      .filter(Boolean)
      .join(" | ");
  });
  context = {
    inventory: lines.join("\n") || "(inventory is empty)",
    brands: brands.map((b) => b.name).join(", ") || "(no brands)",
    total: cars.length,
  };
  return context;
}

function systemPrompt(ctx) {
  return `You are the AI sales assistant of a car marketplace website.
Answer ONLY using the live inventory data below (${ctx.total} listing(s) currently in the catalog)
— never invent cars, brands, prices or specs.
If the answer is not in the data, say the inventory does not include it.
When the user asks for a recommendation, pick 1-3 specific listings from the data, name them exactly
as written, and give the price, year and availability plus a one-line reason for each.
Prices are in Indian Rupees. Prefer listings marked "In stock" and mention when a match is Sold or Reserved.
Respect budget, brand, fuel, transmission and body-type constraints stated by the user.
You may give general buying, finance, mileage, fuel, safety and maintenance advice, but any
car-specific claim must come from the data. Keep answers short, factual and plain-text.

BRANDS: ${ctx.brands}

INVENTORY:
${ctx.inventory}`;
}

export async function askGemini(message) {
  const ctx = await buildContext();
  if (!GEMINI_API_KEY || GEMINI_API_KEY.startsWith("YOUR_")) {
    return "The AI assistant is not configured yet. Add your Gemini API key in firebase/config.js.";
  }
  history.push({ role: "user", parts: [{ text: message }] });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt(ctx) }] },
        contents: history.slice(-12),
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text();
    console.error("Gemini error", res.status, body);
    throw new Error(`Assistant unavailable (${res.status}).`);
  }
  const data = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("").trim() ||
    "Sorry, I could not generate an answer.";
  history.push({ role: "model", parts: [{ text }] });
  return text;
}

export function mountChatbot({ seed = "" } = {}) {
  if (document.getElementById("chat-fab")) return;
  const fab = document.createElement("button");
  fab.id = "chat-fab";
  fab.textContent = "AI Chat";
  const panel = document.createElement("div");
  panel.id = "chat-panel";
  panel.innerHTML = `
    <div class="chat-head"><span>AI Car Assistant</span><button class="btn btn-sm btn-ghost" id="chat-close">Close</button></div>
    <div class="chat-log" id="chat-log"></div>
    <form class="chat-form" id="chat-form">
      <input id="chat-input" placeholder="Ask about any car…" autocomplete="off" required>
      <button class="btn btn-primary btn-sm" type="submit">Send</button>
    </form>`;
  document.body.append(fab, panel);

  const log = panel.querySelector("#chat-log");
  const add = (role, text) => {
    const d = document.createElement("div");
    d.className = `msg ${role}`;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  add("bot", "Hi! Ask me to recommend, compare or explain any car in our inventory.");
  if (seed) add("bot", seed);

  fab.addEventListener("click", () => panel.classList.toggle("open"));
  panel.querySelector("#chat-close").addEventListener("click", () => panel.classList.remove("open"));
  panel.querySelector("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = panel.querySelector("#chat-input");
    const msg = input.value.trim();
    if (!msg) return;
    input.value = "";
    add("user", msg);
    const pending = add("bot", "Thinking…");
    try {
      const answer = await askGemini(msg);
      pending.textContent = answer;
      saveChat({ visitorId: visitorId(), question: msg, answer, page: location.pathname }).catch(() => {});
    } catch (err) {
      pending.textContent = err.message || "Assistant unavailable.";
    }
  });
  return { open: () => panel.classList.add("open") };
}

export const escapeHtml = esc;