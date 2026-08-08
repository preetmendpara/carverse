import { renderLayout } from "../../components/layout.js";
import { auth } from "../../firebase/firebase.js";
import {
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { isAdmin } from "../core/store.js";
import { demoAvailable, demoSignIn, DEMO_EMAIL, DEMO_PASSWORD } from "../features/demo-admin.js";

(async function init() {
  await renderLayout({ base: "../", active: "Admin" });
  const status = document.getElementById("status");
  if (demoAvailable()) {
    const hint = document.createElement("p");
    hint.className = "small";
    hint.style.marginTop = "12px";
    hint.innerHTML =
      `Firebase isn't configured yet, so demo access is open:<br><b>${DEMO_EMAIL}</b> / <b>${DEMO_PASSWORD}</b>`;
    status.after(hint);
  }
  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    btn.disabled = true;
    status.textContent = "Signing in…";
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
    if (demoSignIn(email, password)) {
      location.href = "../admin/index.html";
      return;
    }
    try {
      const cred = await signInWithEmailAndPassword(
        auth,
        email.trim(),
        password
      );
      if (!(await isAdmin(cred.user.uid))) {
        await signOut(auth);
        status.textContent = "This account is not an administrator.";
        return;
      }
      location.href = "../admin/index.html";
    } catch (err) {
      console.error(err);
      status.textContent = "Invalid email or password.";
    } finally {
      btn.disabled = false;
    }
  });
})();