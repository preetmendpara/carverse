// Motion policy: decides how much animation this device/session can afford.
// Levels: "full" (all effects) | "light" (short fades only) | "off" (none).
const KEY = "motion-level";

export const systemReduced = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Static capability sniff — cheap, runs once before anything animates.
function lowEndDevice() {
  const n = typeof navigator === "undefined" ? {} : navigator;
  if ((n.hardwareConcurrency || 8) <= 4) return true;
  if ((n.deviceMemory || 8) <= 4) return true;
  const c = n.connection || {};
  if (c.saveData) return true;
  if (/2g|slow-2g|3g/.test(c.effectiveType || "")) return true;
  if (window.innerWidth <= 640 && (n.hardwareConcurrency || 8) <= 6) return true;
  return false;
}

let level = null;

export function motionLevel() {
  if (level) return level;
  if (systemReduced()) return (level = "off");
  // A downgrade decided earlier in the session sticks, so pages stop re-testing.
  try {
    const cached = sessionStorage.getItem(KEY);
    if (cached === "light" || cached === "off") return (level = cached);
  } catch { /* storage blocked */ }
  return (level = lowEndDevice() ? "light" : "full");
}

export function setMotionLevel(next) {
  if (next === level) return level;
  level = next;
  try {
    if (next !== "full") sessionStorage.setItem(KEY, next);
  } catch { /* storage blocked */ }
  document.documentElement.classList.toggle("reduced-motion", next === "off");
  document.documentElement.classList.toggle("light-motion", next === "light");
  window.dispatchEvent(new CustomEvent("motionlevelchange", { detail: { level: next } }));
  return next;
}

export const isFull = () => motionLevel() === "full";
export const isOff = () => motionLevel() === "off";

/**
 * Samples real frame rate for a short window and downgrades once if the device
 * can't keep up. Cheap: one rAF loop, ~1.2s, then it stops for good.
 */
export function watchFrameRate(onDowngrade) {
  if (motionLevel() === "off") return;
  let frames = 0;
  let start = performance.now();
  let slowChecks = 0;
  const tick = (now) => {
    frames++;
    const elapsed = now - start;
    if (elapsed >= 600) {
      const fps = (frames * 1000) / elapsed;
      frames = 0;
      start = now;
      if (fps < 40) slowChecks++;
      else slowChecks = 0;
      if (slowChecks >= 2) {
        const next = motionLevel() === "light" ? "off" : "light";
        setMotionLevel(next);
        onDowngrade?.(next);
        return; // stop sampling — the decision is made
      }
      if (now > 4000) return; // budget spent, device is fine
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
