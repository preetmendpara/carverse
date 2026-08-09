import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { app } from "./firebase.js";

// Import this only where a signed-in user is actually needed — the admin
// pages, and the upload path in core/store.js, which imports it dynamically.
// Merely evaluating this module loads the Auth SDK and its sign-in iframe.
export const auth = getAuth(app);
