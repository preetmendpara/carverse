// AI Personalized Compare. The buyer's shortlist (2-4 cars, picked on the Cars
// and car pages as before) plus their question goes to the Worker
// (/api/compare-ai). The Worker loads those cars from the catalogue, builds
// the facts in code, and Gemini explains which car fits, citing those facts.
// This page only shows the answer; it never sees an API key.
import { renderLayout, esc, money, toast } from "../components/layout.js";
import { carTitle } from "../components/car-card.js";
import { listCompare, removeCompare, getCar } from "../core/store.js";
import { idToken, requireUser } from "../core/user-auth.js";
import { mountChatbot } from "../features/chatbot.js";

const EXAMPLES = [
  "Which is better for my parents?",
  "Which is better for city driving?",
  "Which is better for highway use?",
  "Which gives better value?",
  "Which is more practical for a family?",
];
const VERDICT = {
  best_fit: "Best fit",
  good_fit: "Good fit",
  partial_fit: "Partial fit",
  poor_fit: "Poor fit",
  insufficient_data: "Not enough listing data",
};

(async function init() {
  await renderLayout({ base: "../", active: "Compare" });
  mountChatbot();
  const out = document.getElementById("out");
  let cars = [];
  let lastQuestion = "";

  async function load() {
    const rows = await listCompare();
    cars = (await Promise.all(rows.map((r) => getCar(r.carId))))
      .map((c, i) => (c ? { ...c, _cmpId: rows[i].id } : null))
      .filter(Boolean);
    render();
  }

  function render() {
    document.getElementById("clear").hidden = !cars.length;
    if (!cars.length) {
      out.innerHTML = `<div class="empty">No cars selected for comparison. Add 2 to 4 cars from the <a href="cars.html" style="text-decoration:underline">Cars</a> page.</div>`;
      return;
    }
    const ready = cars.length >= 2 && cars.length <= 4;
    out.innerHTML = `
      <div class="cmp-picks">${cars
        .map(
          (c) => `<div class="card card-pad cmp-pick">
            <a class="car-name" href="car-details.html?id=${encodeURIComponent(c.id)}">${esc(carTitle(c))}</a>
            <div class="car-price">${esc(money(c.price))}</div>
            <button class="btn btn-sm btn-ghost" data-rm="${esc(c._cmpId)}">Remove</button>
          </div>`
        )
        .join("")}</div>
      ${
        ready
          ? `<form id="cmp-form" class="finder-form" style="margin-top:16px">
              <label for="cmp-q">Ask AI which car is better for your needs</label>
              <div class="finder-row">
                <input id="cmp-q" maxlength="300" placeholder="Ask AI which car is better for your needs..." value="${esc(lastQuestion)}" required>
                <button class="btn btn-primary" id="cmp-go" type="submit">Compare</button>
              </div>
              <div class="chips" style="margin-top:8px">${EXAMPLES.map((q) => `<button type="button" class="chip" data-example="${esc(q)}">${esc(q)}</button>`).join("")}</div>
              <p class="small muted">Only these ${cars.length} cars' listing details are used. The answer is a recommendation from the listing data, not an objective fact.</p>
            </form>`
          : `<p class="small" style="margin-top:16px">Add at least one more car to compare (2 to 4 cars).</p>`
      }
      <div id="cmp-out" aria-live="polite"></div>`;

    out.querySelectorAll("[data-rm]").forEach((b) =>
      b.addEventListener("click", async () => {
        await removeCompare(b.dataset.rm);
        toast("Removed");
        load();
      })
    );
    out.querySelectorAll("[data-example]").forEach((b) =>
      b.addEventListener("click", () => {
        document.getElementById("cmp-q").value = b.dataset.example;
        document.getElementById("cmp-form").requestSubmit();
      })
    );
    document.getElementById("cmp-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const q = document.getElementById("cmp-q").value.trim();
      if (q) ask(q);
    });
  }

  async function ask(question) {
    if (!(await requireUser("../"))) return;
    lastQuestion = question;
    const box = document.getElementById("cmp-out");
    const go = document.getElementById("cmp-go");
    go.disabled = true;
    box.setAttribute("aria-busy", "true");
    box.innerHTML = `<p class="small muted">Comparing ${cars.length} cars for your question…</p>`;
    try {
      const res = await fetch("/api/compare-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify({ carIds: cars.map((c) => c.id), question }),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) return showError(data.message || "Something went wrong.", res.status >= 500 || res.status === 429);
      box.innerHTML = resultHtml(data);
    } catch (err) {
      showError(err.name === "TimeoutError" ? "That took too long." : "Couldn't reach AI Compare. Check your connection.", true);
    } finally {
      go.disabled = false;
      box.removeAttribute("aria-busy");
    }
  }

  function showError(message, retry) {
    const box = document.getElementById("cmp-out");
    box.innerHTML = `<p class="small" role="alert">${esc(message)}</p>${retry ? `<button type="button" class="btn btn-sm" id="cmp-retry">Try again</button>` : ""}`;
    document.getElementById("cmp-retry")?.addEventListener("click", () => ask(lastQuestion));
  }

  const facts = (list) =>
    list.length ? `<ul class="small cmp-facts">${list.map((f) => `<li>${esc(f.label)}: <b>${esc(f.value)}</b></li>`).join("")}</ul>` : "";

  function resultHtml(d) {
    const head = d.winner
      ? `<h3>Recommended for this question: ${esc(d.winner.car)}</h3><p>${esc(d.winnerReason)}</p>`
      : `<h3>No clear winner from the listing data</h3><p>${esc(d.winnerReason)}</p>`;
    const cards = d.assessments
      .map(
        (a) => `<div class="card card-pad cmp-assess${d.winner?.ref === a.ref ? " is-winner" : ""}">
          <div class="finder-card-head"><a class="car-name" href="car-details.html?id=${encodeURIComponent(a.carId)}">${esc(a.car)}</a>
          <span class="badge">${esc(VERDICT[a.verdict] || a.verdict)}</span></div>
          <p class="small">${esc(a.reasoning)}</p>
          ${a.evidence.length ? `<div class="small muted">Listing facts behind this:</div>${facts(a.evidence)}` : `<p class="small muted">No listing facts support a judgement for this question.</p>`}
          ${a.missingData.length ? `<p class="small muted">⚠ Not provided in the listing: ${esc(a.missingData.join(", "))}</p>` : ""}
        </div>`
      )
      .join("");
    const diffs = d.keyDifferences.length
      ? `<table class="compare-table small"><thead><tr><th>Listing fact</th>${d.assessments.map((a) => `<th>${esc(a.car)}</th>`).join("")}</tr></thead><tbody>${d.keyDifferences
          .map(
            (k) => `<tr><td class="muted">${esc(k.fact)}${k.leader ? `<div class="small">${esc(k.leader.note)}: ${esc(k.leader.car)}</div>` : ""}</td>${d.assessments
              .map((a) => `<td>${esc(k.values.find((v) => v.ref === a.ref)?.value || "Not provided in the listing.")}</td>`)
              .join("")}</tr>`
          )
          .join("")}</tbody></table>`
      : `<p class="small muted">These listings do not differ on any recorded fact.</p>`;
    return `
      <div class="cmp-result">
        <p class="small muted">You asked: “${esc(d.question)}”</p>
        ${head}
        ${d.summary ? `<p>${esc(d.summary)}</p>` : ""}
        ${d.evidence.length ? `<div class="small muted">Based on:</div><ul class="small cmp-facts">${d.evidence.map((e) => `<li>${esc(e.car)} — ${esc(e.label)}: <b>${esc(e.value)}</b></li>`).join("")}</ul>` : ""}
        <div class="cmp-grid">${cards}</div>
        <h4>Key differences <span class="small muted">(worked out from the listings, not by AI)</span></h4>
        <div class="table-scroll">${diffs}</div>
        <p class="small muted">${esc(d.disclaimer)}</p>
      </div>`;
  }

  document.getElementById("clear").addEventListener("click", async () => {
    const rows = await listCompare();
    await Promise.all(rows.map((r) => removeCompare(r.id)));
    load();
  });
  load();
})();
