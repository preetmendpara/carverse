import { renderLayout } from "../components/layout.js";
import { auth } from "../config/auth.js";
import {
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { isAdmin } from "../core/store.js";

(async function init() {
  await renderLayout({ base: "../", active: "Admin" });
  const status = document.getElementById("status");
  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    btn.disabled = true;
    status.textContent = "Signing in…";
    const email = document.getElementById("email").value;
    const password = document.getElementById("password").value;
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