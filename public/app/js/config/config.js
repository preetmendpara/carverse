// ---------------------------------------------------------------------------
// FIREBASE + GEMINI CONFIGURATION
// Replace the placeholder values with your own project credentials.
// Firebase web config values are public by design (they are not secrets).
// The Gemini key is NOT here: it is a Worker secret, because anything in this
// file is downloaded by every visitor. See `wrangler secret put GEMINI_API_KEY`.
// ---------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey: "AIzaSyDtNQMbEr_sIVNWirivrl9klcb3vpIFzZU",
  authDomain: "carverse-ai-project.firebaseapp.com",
  projectId: "carverse-ai-project",
  storageBucket: "carverse-ai-project.firebasestorage.app",
  messagingSenderId: "984562611357",
  appId: "1:984562611357:web:6ea2a2b7dee51511825074",
  measurementId: "G-515S2LDN63",
};

// "-latest" alias so the chatbot survives model retirements.
export const GEMINI_MODEL = "gemini-flash-latest";
// UIDs granted admin access without needing an `admins` Firestore doc.
export const ADMIN_UIDS = ["U95gwk62Ale4kPfCNSAlUQ7TQcq2"];
