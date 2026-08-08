/* =====================================================================
   Motion FX — Framer Motion (vanilla `motion` build by the Framer team)
   Loaded from CDN, degrades to a plain static site if unavailable.
   Inspiration: big-boy-toyz style cinematic luxury reveals, kept B/W.
   ===================================================================== */
import { motionLevel } from "./motion.js";

const CDN = "https://cdn.jsdelivr.net/npm/motion@11.18.1/+esm";
let libPromise = null;

function lib() {
  if (!libPromise) libPromise = import(/* @vite-ignore */ CDN).catch(() => null);
  return libPromise;
}

const EASE = [0.22, 1, 0.36, 1];

/** Reveal any [data-reveal] element once as it scrolls into view. */
export async function revealAll(root = document) {
  const level = motionLevel();
  if (level === "off") return;
  const nodes = [...root.querySelectorAll("[data-reveal]:not([data-revealed])")];
  if (!nodes.length) return;
  const m = await lib();
  if (!m) return;
  const { animate, inView } = m;

  nodes.forEach((el) => {
    el.setAttribute("data-revealed", "");
    el.classList.add("fx-armed");
    inView(
      el,
      () => {
        const y = level === "light" ? 0 : Number(el.dataset.revealY || 22);
        animate(
          el,
          { opacity: [0, 1], transform: [`translateY(${y}px)`, "translateY(0px)"] },
          { duration: level === "light" ? 0.28 : 0.55, delay: Number(el.dataset.revealDelay || 0), ease: EASE }
        ).finished.then(() => el.classList.remove("fx-armed"));
      },
      { amount: 0.15 }
    );
  });
}

/** Staggered entrance for a freshly rendered grid of cards. */
export async function revealGrid(container, selector = ":scope > *") {
  if (!container || motionLevel() === "off") return;
  const items = [...container.querySelectorAll(selector)];
  if (!items.length) return;
  const m = await lib();
  if (!m) return;
  const { animate, inView, stagger } = m;
  const light = motionLevel() === "light";
  items.forEach((el) => el.classList.add("fx-armed"));
  inView(
    container,
    () => {
      animate(
        items,
        { opacity: [0, 1], transform: light ? ["scale(1)", "scale(1)"] : ["translateY(26px) scale(.985)", "translateY(0px) scale(1)"] },
        { duration: light ? 0.26 : 0.5, delay: stagger(light ? 0.02 : 0.06), ease: EASE }
      ).finished.then(() => items.forEach((el) => el.classList.remove("fx-armed")));
    },
    { amount: 0.05 }
  );
}

/** Hero headline / sub / search: sequenced entrance on first paint. */
export async function heroIntro() {
  const hero = document.querySelector("[data-hero]");
  if (!hero || motionLevel() === "off") return;
  const m = await lib();
  if (!m) return;
  const { animate, stagger } = m;
  const parts = [...hero.querySelectorAll("[data-hero-item]")];
  if (!parts.length) return;
  parts.forEach((el) => el.classList.add("fx-armed"));
  animate(
    parts,
    { opacity: [0, 1], transform: ["translateY(28px)", "translateY(0px)"] },
    { duration: 0.6, delay: stagger(0.08), ease: EASE }
  ).finished.then(() => parts.forEach((el) => el.classList.remove("fx-armed")));
}

/** Sticky header condenses on scroll. */
export function headerScroll() {
  const header = document.getElementById("site-header");
  if (!header) return;
  const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 12);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

/** Count-up for [data-count] stat numbers. */
export async function countUp(root = document) {
  const nodes = [...root.querySelectorAll("[data-count]:not([data-counted])")];
  if (!nodes.length) return;
  if (motionLevel() === "off") {
    nodes.forEach((el) => (el.textContent = el.dataset.count));
    return;
  }
  const m = await lib();
  if (!m) return nodes.forEach((el) => (el.textContent = el.dataset.count));
  const { animate, inView } = m;
  nodes.forEach((el) => {
    el.setAttribute("data-counted", "");
    const to = Number(el.dataset.count) || 0;
    const suffix = el.dataset.countSuffix || "";
    inView(
      el,
      () => {
        animate(0, to, {
          duration: 1.1,
          ease: "easeOut",
          onUpdate: (v) => (el.textContent = Math.round(v).toLocaleString("en-IN") + suffix),
        });
      },
      { amount: 0.4 }
    );
  });
}

/** Subtle parallax lift on the hero media. */
export async function parallax() {
  const el = document.querySelector("[data-parallax]");
  if (!el || motionLevel() !== "full") return;
  const m = await lib();
  if (!m?.scroll) return;
  m.scroll(m.animate(el, { transform: ["translateY(0px)", "translateY(-48px)"] }, { ease: "linear" }), {
    target: el,
    offset: ["start end", "end start"],
  });
}

/** Press feedback on every button/CTA. */
export function pressable(root = document) {
  if (motionLevel() === "off") return;
  root.querySelectorAll(".btn:not([data-press])").forEach((el) => {
    el.setAttribute("data-press", "");
    el.addEventListener("pointerdown", () => el.classList.add("is-pressed"));
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
      el.addEventListener(ev, () => el.classList.remove("is-pressed"))
    );
  });
}

/** Magnetic pull: primary CTAs drift toward the cursor, then snap back.
 *  Only the offset is written here — the easing lives in CSS, so the buttons
 *  still behave correctly if this never runs. Skipped on touch and on any
 *  reduced-motion level, where a cursor-follow effect is pointless or unwanted.
 */
export function magnetic(root = document) {
  if (motionLevel() !== "full") return;
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

  const STRENGTH = 0.32; // fraction of the cursor's offset from centre
  const MAX = 10; // px, keeps the button inside its own hit area

  root.querySelectorAll(".btn-primary:not([data-magnetic])").forEach((el) => {
    el.setAttribute("data-magnetic", "");

    el.addEventListener("pointermove", (e) => {
      const r = el.getBoundingClientRect();
      const dx = (e.clientX - (r.left + r.width / 2)) * STRENGTH;
      const dy = (e.clientY - (r.top + r.height / 2)) * STRENGTH;
      el.classList.add("is-pulling");
      el.style.setProperty("--mx", `${Math.max(-MAX, Math.min(MAX, dx)).toFixed(1)}px`);
      el.style.setProperty("--my", `${Math.max(-MAX, Math.min(MAX, dy)).toFixed(1)}px`);
    });

    const release = () => {
      el.classList.remove("is-pulling");
      el.style.setProperty("--mx", "0px");
      el.style.setProperty("--my", "0px");
    };
    el.addEventListener("pointerleave", release);
    el.addEventListener("pointercancel", release);
  });
}

export function initMotionFx() {
  headerScroll();
  heroIntro();
  revealAll();
  countUp();
  parallax();
  pressable();
  magnetic();
  scrollWords();
}

/** Call after injecting new DOM (cards, filtered results, etc.). */
export function refreshMotionFx(container) {
  revealAll(container || document);
  countUp(container || document);
  pressable(container || document);
  magnetic(container || document);
  scrollWords(container || document);
}

/* =====================================================================
   Scroll words — scroll-driven, word-by-word text illumination.
   Each [data-scroll-words] block is split into words; scroll progress
   through the block's sticky pin lights them up sequentially.
   ===================================================================== */
export function scrollWords(root = document) {
  const blocks = [...root.querySelectorAll("[data-scroll-words]:not([data-sw-ready])")];
  if (!blocks.length) return;

  blocks.forEach((el) => {
    el.setAttribute("data-sw-ready", "");
    const words = (el.textContent || "").trim().split(/\s+/).filter(Boolean);
    el.classList.add("scroll-words");
    el.innerHTML = words.map((w) => `<span class="sw-word">${w}</span>`).join(" ");
  });

  if (motionLevel() === "off") {
    blocks.forEach((el) => el.querySelectorAll(".sw-word").forEach((w) => w.classList.add("is-lit")));
    return;
  }

  const paint = (el, p) => {
    const words = el.querySelectorAll(".sw-word");
    // Normalised easing window: words start lighting at 8% and finish by 85%
    // of the pinned travel, so timing feels identical on every screen size.
    const t = Math.min(1, Math.max(0, (p - 0.08) / (0.85 - 0.08)));
    const lit = Math.ceil(t * words.length);
    words.forEach((w, i) => w.classList.toggle("is-lit", i < lit));
  };

  // One code path, driven by the scroll event itself. The library's `scroll()`
  // was the only path ever taken, leaving this branch dead and untested — and
  // painting straight from the event keeps the effect verifiable.
  // Progress is measured against the sticky pin travel, so it stays correct
  // at every viewport size.
  const stages = blocks.map((el) => ({ el, target: el.closest("[data-scroll-stage]") || el }));

  const onScroll = () => {
    stages.forEach(({ el, target }) => {
      const r = target.getBoundingClientRect();
      const sticky = target.querySelector(".scroll-sticky");
      const stickyH = sticky ? sticky.getBoundingClientRect().height : window.innerHeight;
      const travel = Math.max(1, r.height - stickyH);
      paint(el, -r.top / travel);
    });
  };
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  window.addEventListener("orientationchange", onScroll, { passive: true });
}
