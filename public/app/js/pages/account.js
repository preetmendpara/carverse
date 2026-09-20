import { renderLayout, esc, toast } from "../components/layout.js";
import { currentUser, signOutUser, goToLogin } from "../core/user-auth.js";

(async function init() {
  await renderLayout({ base: "../" });
  const out = document.getElementById("out");
  const user = await currentUser();
  if (!user) return goToLogin("../");

  out.innerHTML = `
    <table class="spec-table">
      <tr><td>Name</td><td>${esc(user.displayName || "—")}</td></tr>
      <tr><td>Email</td><td>${esc(user.email || "—")}</td></tr>
    </table>
    <p class="small" style="margin-top:14px">
      <a href="wishlist.html">My saved cars</a> · <a href="compare.html">My comparison</a>
    </p>
    <button class="btn btn-primary" id="out-btn" style="margin-top:8px">Sign out</button>`;

  document.getElementById("out-btn").addEventListener("click", async () => {
    await signOutUser();
    toast("Signed out");
    location.href = "../index.html";
  });
})();
