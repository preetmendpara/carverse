// Chat UI. The chatbot is an interface onto the marketplace logic on the
// Worker (/api/chat): recommendations come from the same matcher and rank.js
// as the Car Finder; questions about a car see only that car's record. This
// file sends the message and shows the answer. It holds no catalogue, builds
// no prompt, and never ranks anything.
import { saveChat, visitorId } from "../core/store.js";
import { esc, money } from "../components/layout.js";
import { currentUser, goToLogin, idToken } from "../core/user-auth.js";

/** Sends one message. carId: the car whose page the chat was opened on, if any. */
export async function askAssistant(message, { carId = null } = {}) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
    body: JSON.stringify({ message, ...(carId ? { carId } : {}) }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "The assistant is unavailable right now. Please try again.");
  return data;
}

export function mountChatbot({ seed = "", carId = null } = {}) {
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
      <input id="chat-input" placeholder="Ask about any car…" autocomplete="off" required maxlength="500">
      <button class="btn btn-primary btn-sm" type="submit">Send</button>
    </form>`;
  document.body.append(fab, panel);

  const base = location.pathname.includes("/pages/") || location.pathname.includes("/admin/") ? "../" : "";
  const log = panel.querySelector("#chat-log");
  const add = (role, text) => {
    const d = document.createElement("div");
    d.className = `msg ${role}`;
    d.textContent = text;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
    return d;
  };
  add("bot", "Hi! Tell me what you need and I'll find matching cars, or ask about a car you're looking at.");
  // The assistant costs money per question, so it is for signed-in customers.
  currentUser().then((user) => {
    if (user) return;
    panel.querySelector("#chat-input").disabled = true;
    panel.querySelector("#chat-form button").disabled = true;
    const p = add("bot", "");
    p.innerHTML = `Sign in to chat with the assistant. <a href="${base}pages/login.html" style="text-decoration:underline">Sign in or create an account</a>`;
  });
  if (seed) add("bot", seed);

  // Recommendations: the matcher's own results and reasons, never AI-written text.
  const resultsHtml = (data) => {
    const items = (data.results || [])
      .map(
        (r) => `<li><a href="${base}pages/car-details.html?id=${encodeURIComponent(r.carId)}">${esc(r.title)}</a> — ${esc(money(r.price))}
          <ul>${r.explanation.map((l) => `<li>${esc(l)}</li>`).join("")}</ul></li>`
      )
      .join("");
    const near = (data.nearMisses || [])
      .map((n) => `<li><a href="${base}pages/car-details.html?id=${encodeURIComponent(n.carId)}">${esc(n.title)}</a> <span class="muted">✕ ${esc(n.failed[0])}</span></li>`)
      .join("");
    return `${items ? `<ol class="chat-results">${items}</ol>` : ""}${near ? `<p class="small muted" style="margin:8px 0 2px">Closest alternatives (not matches):</p><ul class="chat-results">${near}</ul>` : ""}`;
  };

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
      const data = await askAssistant(msg, { carId });
      pending.textContent = data.reply || "";
      if (data.intent === "recommend") pending.insertAdjacentHTML("beforeend", resultsHtml(data));
      saveChat({ visitorId: visitorId(), question: msg, answer: data.reply || "", page: location.pathname }).catch(() => {});
    } catch (err) {
      pending.textContent = err.name === "TimeoutError" ? "That took too long. Please try again." : err.message;
    }
    log.scrollTop = log.scrollHeight;
  });
  return { open: () => panel.classList.add("open") };
}
