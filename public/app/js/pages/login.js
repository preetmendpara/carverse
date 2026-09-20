import { renderLayout, toast } from "../components/layout.js";
import { signIn, signUp, resetPassword, currentUser, authMessage } from "../core/user-auth.js";

const el = (id) => document.getElementById(id);

(async function init() {
  await renderLayout({ base: "../" });

  // Where to go after signing in; only same-site paths, so a crafted ?next=
  // can't bounce the visitor off to another website.
  const raw = new URLSearchParams(location.search).get("next") || "../index.html";
  const next = /^\/(?!\/)/.test(raw) || !/^[a-z]+:|^\/\//i.test(raw) ? raw : "../index.html";

  if (await currentUser()) {
    location.replace(next);
    return;
  }

  let mode = new URLSearchParams(location.search).get("mode") === "signup" ? "signup" : "signin";
  const status = el("status");

  function paint() {
    const up = mode === "signup";
    el("head").textContent = up ? "Create an account" : "Sign in";
    el("submit").textContent = up ? "Create account" : "Sign in";
    el("name-field").hidden = !up;
    el("name").required = up;
    el("password").autocomplete = up ? "new-password" : "current-password";
    el("switch-text").textContent = up ? "Already have an account?" : "New here?";
    el("switch").textContent = up ? "Sign in" : "Create an account";
    el("forgot").hidden = up;
    status.textContent = "";
  }
  paint();

  el("switch").addEventListener("click", () => {
    mode = mode === "signup" ? "signin" : "signup";
    paint();
  });

  el("forgot").addEventListener("click", async () => {
    const email = el("email").value.trim();
    if (!email) {
      status.textContent = "Type your email above first, then press this again.";
      return;
    }
    try {
      await resetPassword(email);
      status.textContent = "Password reset email sent. Check your inbox.";
    } catch (err) {
      status.textContent = authMessage(err.code);
    }
  });

  el("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = el("submit");
    btn.disabled = true;
    status.textContent = mode === "signup" ? "Creating your account…" : "Signing in…";
    try {
      if (mode === "signup") await signUp(el("name").value.trim(), el("email").value.trim(), el("password").value);
      else await signIn(el("email").value.trim(), el("password").value);
      toast(mode === "signup" ? "Account created" : "Signed in");
      location.replace(next);
    } catch (err) {
      console.error(err);
      status.textContent = authMessage(err.code);
      btn.disabled = false;
    }
  });
})();
