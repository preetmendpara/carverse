import { renderLayout, esc, toast } from "../components/layout.js";
import { carTitle } from "../components/car-card.js";
import { listCars, addInquiry, visitorId } from "../core/store.js";
import { mountChatbot } from "../features/chatbot.js";

(async function init() {
  const s = await renderLayout({ base: "../", active: "Contact" });
  mountChatbot();

  document.getElementById("info").innerHTML = `
    <h2>Reach us</h2>
    <p>Questions about pricing, finance or a test drive? Send the form and we will get back to you.</p>
    <table class="spec-table">
      ${s.contactEmail ? `<tr><td>Email</td><td>${esc(s.contactEmail)}</td></tr>` : ""}
      ${s.contactPhone ? `<tr><td>Phone</td><td>${esc(s.contactPhone)}</td></tr>` : ""}
      ${s.contactAddress ? `<tr><td>Address</td><td>${esc(s.contactAddress)}</td></tr>` : ""}
    </table>`;

  const cars = await listCars();
  const sel = document.getElementById("car");
  cars.forEach((c) => sel.add(new Option(carTitle(c), c.id)));
  const pre = new URLSearchParams(location.search).get("car");
  if (pre) sel.value = pre;

  document.getElementById("form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("submit");
    const status = document.getElementById("status");
    const values = {
      name: document.getElementById("name").value.trim(),
      email: document.getElementById("email").value.trim(),
      phone: document.getElementById("phone").value.trim(),
      message: document.getElementById("message").value.trim(),
      carId: sel.value || null,
      carName: sel.value ? sel.options[sel.selectedIndex].text : null,
      visitorId: visitorId(),
    };
    if (!values.name || !values.email || !values.phone || !values.message) {
      status.textContent = "Please fill in every field.";
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(values.email)) {
      status.textContent = "Please enter a valid email address.";
      return;
    }
    btn.disabled = true;
    try {
      await addInquiry(values);
      e.target.reset();
      status.textContent = "Thanks! Your enquiry has been sent.";
      toast("Enquiry sent");
    } catch (err) {
      console.error(err);
      status.textContent = "Could not send right now. Please try again.";
    } finally {
      btn.disabled = false;
    }
  });
})();