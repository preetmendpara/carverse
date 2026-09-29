#!/usr/bin/env node
// Seeds the carModels reference collection from scripts/data/car-models.json.
//
// NOT APPROVED YET. This script cannot write anything: the write step will be
// added only once seeding is approved. Until then it reports which entries
// still need checking against an authoritative spec sheet.
//
//   node scripts/seed-car-models.mjs
//
// When it is enabled, it must refuse any entry that is not `verified: true`,
// and create documents only (never overwrite an existing carModels document).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { planModels } from "./migrate-phase0.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const json = JSON.parse(await readFile(path.join(ROOT, "scripts/data/car-models.json"), "utf8"));
const verified = new Set(json.models.filter((m) => m.verified === true).map((m) => `${m.brand} ${m.model}`));
const docs = planModels(json);

console.log(`carModels draft entries: ${docs.length}`);
console.log(`verified: ${verified.size}   unverified: ${docs.length - verified.size}\n`);
for (const d of docs) console.log(`  ${verified.has(`${d.data.brand} ${d.data.model}`) ? "verified  " : "UNVERIFIED"}  ${d.id}`);

if (process.argv.includes("--apply")) {
  console.error("\nSeeding carModels is not approved yet, so this script has no write step. Nothing was written.");
  process.exitCode = 1;
} else {
  console.log("\nReport only. Nothing was written.");
}
