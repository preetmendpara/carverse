// AI Car Finder UI. The Worker (/api/match) does the work: Gemini turns the
// sentence into requirements, plain code ranks the cars. This file only shows
// the result and lets the buyer correct what was understood. Removing a chip
// re-ranks through the same endpoint without asking the AI again.
//
// This is the Cars page's ONLY search input. Brand and model names are matched
// in plain code first (catalog.js nameSearch): a name-only query ("BMW",
// "Toyota Fortuner", "any model") just filters the grid, with no AI call and
// no sign-in. Anything else goes to the AI Finder; names in it ("BMW under 50
// lakh") limit the ranked results to those cars. Ranking itself is unchanged.
import { esc, money } from "../components/layout.js";
import { idToken, requireUser } from "../core/user-auth.js";
import { removeChip } from "../core/requirements.js";
import { SUITABILITY_NOTE } from "../core/car-tags.js";
import { nameSearch } from "../core/catalog.js";

/**
 * cars: the catalogue on the page. onNames(ids|null): the grid shows only these
 * car ids (null = all cars).
 */
export function mountFinder({ base = "../", cars = [], onNames = () => {}, initialQuery = "" } = {}) {
  const form = document.getElementById("finder-form");
  if (!form) return;
  const input = document.getElementById("finder-q");
  const go = document.getElementById("finder-go");
  const out = document.getElementById("finder-out");
  let current = null; // the last requirements the Worker returned
  let lastPayload = null; // for "Try again"
  let names = null; // { ids, label } from a name in the AI query, or null

  async function run(payload) {
    if (!(await requireUser(base))) return;
    lastPayload = payload;
    go.disabled = true;
    out.setAttribute("aria-busy", "true");
    out.innerHTML = `<p class="small muted finder-loading">${payload.query ? "Reading your request and checking every car…" : "Updating the matches…"}</p>`;
    try {
      const res = await fetch("/api/match", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${await idToken()}` },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30000),
      });
      const data = await res.json().catch(() => ({}));
      if (data.requirements) current = data.requirements;
      if (!res.ok) return renderMessage(data, res.status >= 500 || res.status === 429);
      render(data);
    } catch (err) {
      // Never show guessed results after a failure: only the error and a retry.
      renderMessage({ message: err.name === "TimeoutError" ? "That took too long." : "Couldn't reach the Car Finder. Check your connection." }, true);
    } finally {
      go.disabled = false;
      out.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    search(input.value.trim());
  });

  function search(query) {
    const n = nameSearch(cars, query);
    if (!query || n.nameOnly) {
      // Names only (or "any model"): filter the grid in code, no AI.
      names = null;
      current = null;
      onNames(n.ids);
      out.innerHTML = n.ids
        ? `<p class="small">Showing ${n.ids.size} car${n.ids.size === 1 ? "" : "s"} matching ${esc(n.label)} below. <button type="button" class="btn btn-sm btn-ghost" data-clear>Show all</button></p>`
        : query
          ? `<p class="small muted">Showing every car below. Describe a budget, body type or need to get ranked matches.</p>`
          : "";
      return;
    }
    names = n.ids ? { ids: n.ids, label: n.label } : null;
    onNames(null);
    run({ query });
  }
  // A search handed over in the URL (?q=…), e.g. from the home page. Names run
  // at once; an AI request waits for the buyer to press the button, so opening
  // the page never forces a sign-in.
  if (initialQuery) {
    input.value = initialQuery;
    if (nameSearch(cars, initialQuery).nameOnly) search(initialQuery);
  }

  out.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-remove]");
    if (chip && current) run({ requirements: removeChip(current, chip.dataset.remove) });
    if (e.target.closest("[data-retry]") && lastPayload) run(lastPayload);
    if (e.target.closest("[data-clear]")) {
      out.innerHTML = "";
      current = null;
      names = null;
      onNames(null);
      input.value = "";
      input.focus();
    }
  });

  // Inferred chips (read into the request, not said outright) look different
  // and say so, so the buyer can tell them apart and remove them.
  const chipsHtml = (understood = []) =>
    understood.length
      ? `<div class="finder-understood"><span class="small muted">We understood:</span>
         <div class="chips">${understood
           .map(
             (c) =>
               `<button type="button" class="chip finder-chip${c.inferred ? " is-inferred" : ""}" data-remove="${esc(c.id)}" aria-label="Remove ${esc(c.text)}${c.inferred ? " (inferred)" : ""}">${esc(c.text)}${c.inferred ? ` <em>inferred</em>` : ""} <span aria-hidden="true">×</span></button>`
           )
           .join("")}</div>
         ${understood.some((c) => c.inferred) ? `<span class="small muted">"Inferred" items were read into your request, not said outright. Inferred items only ever prefer, never exclude, a car.</span>` : ""}</div>`
      : "";

  function renderMessage(data, retry = false) {
    out.innerHTML = `${chipsHtml(data.understood)}<p class="small" role="alert">${esc(data.message || "Something went wrong.")}</p>${
      retry ? `<button type="button" class="btn btn-sm" data-retry>Try again</button>` : ""
    }`;
  }

  function render(data) {
    // A brand or model named in the request limits the ranked list to it.
    if (names) {
      data = { ...data, results: data.results.filter((r) => names.ids.has(r.carId)), nearMisses: data.nearMisses.filter((n) => names.ids.has(n.carId)) };
    }
    const warnings = [...(data.validation?.warnings || []), ...(names ? [`Showing only ${names.label}.`] : [])];
    out.innerHTML = `
      ${chipsHtml(data.understood)}
      ${warnings.map((w) => `<p class="small muted">${esc(w)}</p>`).join("")}
      <div class="finder-head">
        <h3>${data.results.length ? `${data.results.length} matching car${data.results.length === 1 ? "" : "s"}` : "No car matches everything you asked for"}</h3>
        <span class="small muted">${esc(`${data.meta.candidatesAfter} of ${data.meta.candidatesBefore} cars meet your requirements`)}</span>
      </div>
      <div class="finder-results">${data.results.map(resultCard).join("")}</div>
      ${
        data.nearMisses.length
          ? `<div class="finder-near"><h4>Closest alternatives <span class="small muted">(not matches: each misses one requirement)</span></h4><ul>${data.nearMisses
              .map(
                (n) =>
                  `<li><a href="${base}pages/car-details.html?id=${encodeURIComponent(n.carId)}">${esc(n.title)}</a><br><span class="muted">✕ ${esc(n.failed[0])}</span></li>`
              )
              .join("")}</ul></div>`
          : ""
      }
      <p class="small muted">${esc(SUITABILITY_NOTE)} Tap a requirement above to remove it. <button type="button" class="btn btn-sm btn-ghost" data-clear>Clear</button></p>`;
  }

  function resultCard(r) {
    const breakdown = r.breakdown.length
      ? `<details class="finder-why"><summary class="small">Score breakdown</summary>
          <table class="spec-table">
            <tr><th>Criterion</th><th>Weight</th><th>Score</th><th>Evidence</th></tr>
            ${r.breakdown
              .map(
                (b) =>
                  `<tr><td>${esc(b.criterion)}</td><td>${esc(b.weight)}</td><td>${esc(Math.round(b.score * 100))}%${b.confidence < 1 ? ` <span class="muted">(data ${esc(Math.round(b.confidence * 100))}%)</span>` : ""}</td><td>${esc(b.evidence)}</td></tr>`
              )
              .join("")}
          </table></details>`
      : "";
    return `
      <article class="card finder-card">
        ${r.image ? `<a href="${base}pages/car-details.html?id=${encodeURIComponent(r.carId)}"><img src="${esc(r.image)}" alt="${esc(r.title)}" loading="lazy" width="640" height="400"></a>` : ""}
        <div class="card-pad">
          <div class="finder-card-head">
            <a class="car-name" href="${base}pages/car-details.html?id=${encodeURIComponent(r.carId)}">${esc(r.title)}</a>
            <span class="finder-score" title="Match score out of 100">${esc(r.score)}<span class="muted">/100</span></span>
          </div>
          <div class="car-price">${esc(money(r.price))}</div>
          <ul class="finder-reasons">${r.explanation.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
          ${r.missingData.length ? `<p class="small muted">⚠ Not provided in the listing: ${esc(r.missingData.join(", "))}</p>` : ""}
          ${breakdown}
        </div>
      </article>`;
  }
}
