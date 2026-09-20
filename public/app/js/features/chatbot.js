// Gemini-powered assistant. Car knowledge always comes from Firestore.
import { GEMINI_MODEL } from "../config/config.js";
import { saveChat, visitorId } from "../core/store.js";
import { loadCatalog, availabilityLabel, availabilityOf } from "../core/catalog.js";
import { esc } from "../components/layout.js";
import { currentUser, goToLogin, idToken } from "../core/user-auth.js";

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
SCOPE (this rule overrides everything below): you only handle questions about cars, car brands,
this website's listings, and car buying, ownership, finance, insurance or maintenance.
For anything else (coding, maths, homework, politics, general knowledge, jokes, other products, etc.)
do NOT answer it and do NOT say "the inventory does not include" it. Reply in 2 short sentences:
first name what they asked for and say you can't help with it, then say you only answer car-related
questions and invite a car question. Examples:
"give me python code" -> "Sorry, I can't give Python code. I'm CarVerse's car assistant and only answer car-related questions, like prices, specs, comparisons or which car suits you."
"who won the cricket world cup" -> "Sorry, I can't answer cricket questions. I'm CarVerse's car assistant and only answer car-related questions, like prices, specs, comparisons or which car suits you."
Greetings and thanks are fine: reply briefly and offer car help.
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

// Flash-lite answers in ~1s and is rarely overloaded; the configured model is the fallback.
// Retries cover overloads (429/5xx) and timeouts.
const MODELS = [...new Set(["gemini-flash-lite-latest", GEMINI_MODEL])];
const RETRY = new Set([429, 500, 502, 503, 504]);

async function callGemini(ctx) {
  const body = (model) =>
    JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt(ctx) }] },
      contents: history.slice(-12),
      // Thinking made replies take 10-30s; lookup-and-answer doesn't need it.
      // Lite models reject thinkingBudget, and already think very little.
      generationConfig: {
        maxOutputTokens: 600,
        ...(model.includes("lite") ? {} : { thinkingConfig: { thinkingBudget: 0 } }),
      },
    });
  let last = null;
  for (const [i, model] of [...MODELS, ...MODELS].entries()) {
    if (i) await new Promise((r) => setTimeout(r, 800 * i));
    try {
      // The key lives on the Worker, so the browser never sees it.
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ model, body: JSON.parse(body(model)) }),
        signal: AbortSignal.timeout(20000),
      });
      if (res.ok) return res.json();
      last = res.status;
      console.error("Gemini error", model, res.status, await res.text());
      if (!RETRY.has(res.status)) break;
    } catch (err) {
      last = err.name === "TimeoutError" ? "timeout" : "network";
      console.error("Gemini request failed", model, err);
    }
  }
  throw new Error(
    last === 429 || last === 503 || last === "timeout"
      ? "The assistant is busy right now. Please try again in a moment."
      : "Assistant unavailable right now. Please try again."
  );
}

export async function askGemini(message) {
  const ctx = await buildContext();
  history.push({ role: "user", parts: [{ text: message }] });
  let data;
  try {
    data = await callGemini(ctx);
  } catch (err) {
    history.pop(); // a failed turn must not poison the next request
    throw err;
  }
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
  // The assistant costs money per question, so it is for signed-in customers.
  const base = location.pathname.includes("/pages/") || location.pathname.includes("/admin/") ? "../" : "";
  currentUser().then((user) => {
    if (user) return;
    panel.querySelector("#chat-input").disabled = true;
    panel.querySelector("#chat-form button").disabled = true;
    const p = add("bot", "Sign in to chat with the assistant.");
    p.innerHTML = `Sign in to chat with the assistant. <a href="${base}pages/login.html" style="text-decoration:underline">Sign in or create an account</a>`;
  });
  if (seed) add("bot", seed);

  fab.addEventListener("click", () => panel.classList.toggle("open"));
  panel.querySelector("#chat-close").addEventListener("click", () => panel.classList.remove("open"));
  panel.querySelector("#chat-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = panel.querySelector("#chat-input");
    const msg = input.value.trim();
    if (!msg) return;
    if (!(await currentUser())) return goToLogin(base);
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