// The matchLogs document, built in one place. Its fields must be exactly the
// ones server/rules/firestore.rules allows (hasAll + hasOnly), with the same
// types; scripts/test-rank.mjs checks the two stay in step.
export const MATCH_LOG_TTL_DAYS = 90;

/** Pure. Returns the log document for a free-text query that went through Gemini. */
export function buildMatchLog({ uid, query, requirements, results, model, now = new Date() }) {
  return {
    uid: String(uid),
    query: String(query).slice(0, 500),
    requirements,
    resultIds: results.slice(0, 3).map((r) => String(r.carId)),
    // RESERVED, unused in Phase 1: always null. Logs are immutable once created
    // (firestore.rules: `allow update: if false`), so a click cannot be recorded
    // here. Tracking clicks would need a separate, deliberate design (e.g. an
    // append-only clicks collection), not an update to this document.
    clickedId: null,
    model: String(model || "unknown"),
    createdAt: now,
    expireAt: new Date(now.getTime() + MATCH_LOG_TTL_DAYS * 24 * 3600_000),
  };
}
