// Reusable header/footer components + shared UI helpers.
import { getSettings } from "../js/core/store.js";
import { initAnimations } from "../js/features/animate.js";
import { initMotionFx } from "../js/features/motion-fx.js";

export const money = (n) =>
  n === undefined || n === null || n === "" || isNaN(Number(n))
    ? "Price on request"
    : "₹ " + Number(n).toLocaleString("en-IN");

export const esc = (s = "") =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function toast(message) {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

export function emptyState(target, text = "No cars available.") {
  target.innerHTML = `<div class="empty">${esc(text)}</div>`;
}

/* -------------------------------- theme -------------------------------- */
const THEME_KEY = "carverse-theme";

/** Saved choice wins; otherwise follow the operating system. */
export function initTheme() {
  let saved = null;
  try {
    saved = localStorage.getItem(THEME_KEY);
  } catch { /* storage blocked */ }
  const system = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  document.documentElement.dataset.theme = saved || system;
}

export function toggleTheme() {
  const root = document.documentElement;
  const next = root.dataset.theme === "light" ? "dark" : "light";
  // Every colour has a transition for hover; without this the switch smears
  // across the whole page for half a second.
  root.classList.add("theme-switching");
  root.dataset.theme = next;
  requestAnimationFrame(() => setTimeout(() => root.classList.remove("theme-switching"), 60));
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch { /* storage blocked */ }
  return next;
}

const themeButton = () =>
  `<button class="theme-toggle" id="theme-toggle" type="button"
     aria-label="Switch between dark and light mode" title="Switch theme">
     <span class="icon-moon" aria-hidden="true">☾</span><span class="icon-sun" aria-hidden="true">☀</span>
   </button>`;

/** Wires the toggle that ships in each page's header markup.
 *  It must be in the HTML rather than injected: the nav is a space-between
 *  row, so adding a fourth child after paint redistributed the links and the
 *  whole menu visibly slid across. Inserting it here is only a fallback for
 *  a page whose markup predates this. */
export function mountThemeToggle() {
  let btn = document.getElementById("theme-toggle");
  if (!btn) {
    const nav = document.querySelector(".site-header .nav");
    if (!nav) return;
    nav.insertAdjacentHTML("beforeend", themeButton());
    btn = document.getElementById("theme-toggle");
  }
  if (btn.dataset.wired) return;
  btn.dataset.wired = "1";
  btn.addEventListener("click", toggleTheme);
}

// `base` is the relative path back to /app (e.g. "" for index, "../" for pages)
const NAV = [
  ["", "Home"],
  ["pages/cars.html", "Cars"],
  ["pages/brands.html", "Brands"],
  ["pages/compare.html", "Compare"],
  ["pages/wishlist.html", "Wishlist"],
  ["pages/contact.html", "Contact"],
  ["pages/admin-login.html", "Admin"],
];

export async function renderLayout({ base = "", active = "" } = {}) {
  initTheme();
  initAnimations();

  const paint = (s = {}) => {
    const name = s.siteName || "CarVerse";
    if (document.title.includes("%SITE%")) document.title = document.title.replace("%SITE%", name);

    const header = document.getElementById("site-header");
    if (header) {
      header.className = "site-header";
      header.innerHTML = `
      <div class="container nav">
        <a class="brand" href="${base}index.html">
          ${s.logoUrl ? `<img src="${esc(s.logoUrl)}" alt="${esc(name)} logo">` : ""}
          <span>${esc(name)}</span>
        </a>
        <button class="nav-toggle" id="nav-toggle" aria-label="Toggle navigation">Menu</button>
        <nav class="nav-links" id="nav-links">
          ${NAV.map(
            ([href, label]) =>
              `<a href="${base}${href || "index.html"}" class="${
                active === label ? "active" : ""
              }">${label}</a>`
          ).join("")}
        </nav>
        ${themeButton()}
      </div>`;
      document
        .getElementById("nav-toggle")
        ?.addEventListener("click", () => document.getElementById("nav-links").classList.toggle("open"));
      document.getElementById("theme-toggle")?.addEventListener("click", toggleTheme);
    }

    const footer = document.getElementById("site-footer");
    if (footer) {
      footer.className = "site-footer";
      const socials = s.socialLinks || {};
      footer.innerHTML = `
      <div class="container">
        <div class="footer-grid">
          <div>
            <div class="brand" style="margin-bottom:10px">${esc(name)}</div>
            <p class="small">${esc(s.footerText || "A minimal, data-driven car marketplace.")}</p>
          </div>
          <div>
            <h4>Explore</h4>
            ${NAV.slice(0, 6)
              .map(([href, label]) => `<a href="${base}${href || "index.html"}">${label}</a>`)
              .join("")}
          </div>
          <div>
            <h4>Contact</h4>
            ${s.contactEmail ? `<a href="mailto:${esc(s.contactEmail)}">${esc(s.contactEmail)}</a>` : ""}
            ${s.contactPhone ? `<a href="tel:${esc(s.contactPhone)}">${esc(s.contactPhone)}</a>` : ""}
            ${s.contactAddress ? `<span class="small muted">${esc(s.contactAddress)}</span>` : ""}
            ${Object.entries(socials)
              .filter(([, v]) => v)
              .map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(k)}</a>`)
              .join("")}
          </div>
        </div>
        <div class="footer-bottom">
          <span>\u00a9 ${new Date().getFullYear()} ${esc(name)}. All rights reserved.</span>
          <span>GTU Minor Project</span>
        </div>
      </div>`;
    }
  };

  // The header/footer shell is already in the page HTML, so it paints with the
  // first frame. Only wire the menu button and repaint if Firestore settings
  // actually override something — that avoids a visible second render.
  document
    .getElementById("nav-toggle")
    ?.addEventListener("click", () => document.getElementById("nav-links")?.classList.toggle("open"));
  mountThemeToggle();
  if (document.title.includes("%SITE%")) document.title = document.title.replace("%SITE%", "CarVerse");

  initMotionFx();

  const s = (await getSettings().catch(() => ({}))) || {};
  const overrides =
    s.siteName || s.logoUrl || s.footerText || s.contactEmail || s.contactPhone || s.contactAddress || s.socialLinks;
  if (overrides) paint(s);
  return s;
}
