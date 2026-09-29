#!/usr/bin/env node
// Evaluates the AI Car Finder on scripts/fixtures/match-queries.json.
//
//   node scripts/eval-match.mjs          ranking only: expected requirements -> pipeline
//                                        (no AI; isolates rank.js from extraction)
//   node scripts/eval-match.mjs --live   end to end: real Gemini extraction (key from
//                                        .dev.vars) -> the same pipeline
//
// Metrics:
//   outcome accuracy   results / clarify / empty as expected
//   Hit@3              share of queries with a relevant car in the top 3
//   Precision@3        relevant cars among those shown (top 3 or fewer)
//   no-match accuracy  queries with no relevant car return no result
//   extraction         (live) per-field agreement with the hand-written requirements,
//                      plus "spurious" fields the buyer never asked for
import { readFile } from "node:fs/promises";
import { matchResponse } from "../server/match/pipeline.js";
import { EXTRACTION_PROMPT, EXTRACTION_SCHEMA } from "../server/match/extract.js";
import { generateJson } from "../server/lib/gemini.js";

const live = process.argv.includes("--live");
const { cars: raw } = JSON.parse(await readFile(new URL("./fixtures/cars-2026-09-27.json", import.meta.url), "utf8"));
const cars = raw.map((c) => ({ ...c, status: "published" }));
const { queries } = JSON.parse(await readFile(new URL("./fixtures/match-queries.json", import.meta.url), "utf8"));

let env = {};
if (live) {
  const vars = await readFile(new URL("../.dev.vars", import.meta.url), "utf8").catch(() => "");
  const key = vars.match(/GEMINI_API_KEY="?([^"\r\n]+)/)?.[1];
  if (!key) throw new Error("--live needs GEMINI_API_KEY in .dev.vars");
  env = { GEMINI_API_KEY: key }; // held in memory only, never printed
}

const FIELDS = ["budgetMaxInr", "budgetMinInr", "transmission", "fuel", "seatsMin", "bodyTypes", "usage", "priorities"];
const norm = (k, v) => {
  if (v == null || (Array.isArray(v) && !v.length)) return null;
  if (k === "bodyTypes") return JSON.stringify({ values: [...v.values].sort(), strength: v.strength });
  if (Array.isArray(v)) return JSON.stringify([...v].sort());
  return JSON.stringify(v);
};
const outcomeOf = (res) => (res.status === 200 ? "results" : res.body.error === "empty" ? "empty" : res.body.error === "clarify" ? "clarify" : res.body.error || "error");

const rows = [];
const spuriousDetail = [];
const totals = { outcome: 0, hitN: 0, hit: 0, precN: 0, prec: 0, noMatchN: 0, noMatch: 0, fieldN: 0, field: 0, spurious: 0, inferredExtra: 0, aiFail: 0 };

for (const q of queries) {
  let extracted = q.expectedRequirements;
  let intent = "recommend";
  if (live) {
    try {
      const out = await generateJson(env, { system: EXTRACTION_PROMPT, user: q.query, schema: EXTRACTION_SCHEMA });
      extracted = out.data;
      intent = out.data.intent;
    } catch {
      totals.aiFail++;
      rows.push({ id: q.id, query: q.query, expect: q.expect, outcome: "AI unavailable", shown: "—", hit: null, prec: null, fieldScore: "", note: "Gemini refused or timed out (quota/overload); not scored" });
      await new Promise((r) => setTimeout(r, 1500));
      continue;
    }
    await new Promise((r) => setTimeout(r, 1500)); // stay under per-minute limits
  }

  const res = intent === "recommend" ? matchResponse({ raw: extracted, query: q.query, cars }) : { status: 422, body: { error: `intent:${intent}` } };
  const outcome = outcomeOf(res);
  if (outcome === q.expect) totals.outcome++;

  const shown = res.status === 200 ? res.body.results.map((r) => r.carId) : [];
  const rel = new Set(q.relevantCarIds);
  let hit = null, prec = null;
  if (q.expect === "results" && rel.size) {
    totals.hitN++;
    hit = shown.some((id) => rel.has(id));
    if (hit) totals.hit++;
    if (shown.length) {
      totals.precN++;
      prec = shown.filter((id) => rel.has(id)).length / shown.length;
      totals.prec += prec;
    }
  }
  if (q.expect === "results" && !rel.size) {
    totals.noMatchN++;
    if (!shown.length) totals.noMatch++;
  }

  let fieldScore = "";
  if (live && q.expect === "results") {
    const got = res.body.requirements || {};
    let ok = 0, n = 0;
    for (const k of FIELDS) {
      const want = norm(k, q.expectedRequirements[k]);
      const have = norm(k, got[k]);
      if (want !== null) { n++; if (want === have) ok++; }
      else if (have !== null) {
        // A field the label doesn't have. If Gemini marked every value of it as
        // inferred, the buyer sees it flagged and it can only prefer, never
        // exclude: allowed. Unmarked, it would be passed off as something said.
        const values = Array.isArray(got[k]) ? got[k].map((x) => `${k}:${x}`) : [k];
        const marked = values.every((id) => (got.inferred || []).includes(id));
        if (marked) totals.inferredExtra++;
        else totals.spurious++;
        spuriousDetail.push(`#${q.id} "${q.query}": ${k} = ${have} (${marked ? "marked inferred" : "UNMARKED"})`);
      }
    }
    totals.fieldN += n;
    totals.field += ok;
    fieldScore = `${ok}/${n}`;
  }
  const title = (id) => cars.find((c) => c.id === id)?.model || id;
  rows.push({ id: q.id, query: q.query, expect: q.expect, outcome, shown: shown.map(title).join(", ") || "—", hit, prec, fieldScore, note: q.note || "" });
}

const pct = (a, b) => (b ? `${Math.round((100 * a) / b)}%` : "n/a");
console.log(`\nAI Car Finder evaluation (${live ? "LIVE: Gemini extraction + rank.js" : "ranking only: hand-written requirements + rank.js"})\n`);
for (const r of rows)
  console.log(
    `#${String(r.id).padStart(2)} ${r.outcome === r.expect ? "✓" : "✗"} ${r.query.slice(0, 58).padEnd(58)} -> ${String(r.outcome).padEnd(8)} ${r.shown}` +
      `${r.hit === null ? "" : `  hit@3=${r.hit ? "yes" : "NO"}`}${r.prec === null ? "" : ` p@3=${r.prec.toFixed(2)}`}${r.fieldScore ? ` fields=${r.fieldScore}` : ""}${r.note ? `  [${r.note}]` : ""}`
  );
console.log(`
Outcome accuracy   ${totals.outcome}/${queries.length - totals.aiFail} (${pct(totals.outcome, queries.length - totals.aiFail)})
Hit@3              ${totals.hit}/${totals.hitN} (${pct(totals.hit, totals.hitN)})
Precision@3        ${totals.precN ? (totals.prec / totals.precN).toFixed(2) : "n/a"} (mean over ${totals.precN} queries with results)
No-match accuracy  ${totals.noMatch}/${totals.noMatchN}${live ? `
Extraction fields  ${totals.field}/${totals.fieldN} (${pct(totals.field, totals.fieldN)}) agree with the hand-written requirements
Unmarked extras    ${totals.spurious} (a field the buyer never asked for, NOT flagged as inferred: an error)
Marked inferences  ${totals.inferredExtra} (not in the label, but flagged as inferred and shown to the buyer as such)
AI unavailable     ${totals.aiFail}` : ""}`);
if (live && spuriousDetail.length) console.log(`Spurious detail:\n  ${spuriousDetail.join("\n  ")}`);
