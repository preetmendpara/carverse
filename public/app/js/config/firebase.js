import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./config.js";

// No Auth here, and no Storage SDK. Auth lives in ./auth.js because loading it
// spins up a cross-origin __/auth/iframe that cost ~2.2s on every public page,
// none of which needs a signed-in user. Media lives in R2 via /api/upload.
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
