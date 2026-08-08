// Minimal motion layer: one short CSS fade-in per page. No GSAP, no page-exit
// veil, no scroll reveals — navigation happens instantly.
import { systemReduced } from "./motion.js";

let booted = false;

export function initAnimations() {
  if (booted) return;
  booted = true;
  const root = document.documentElement;
  root.classList.remove("motion-boot");
  if (systemReduced()) {
    root.classList.add("reduced-motion");
    return;
  }
  root.classList.add("page-fade");
}
