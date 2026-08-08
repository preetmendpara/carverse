// ---------------------------------------------------------------------------
// FIREBASE + GEMINI CONFIGURATION
// Replace the placeholder values with your own project credentials.
// Firebase web config values are public by design (they are not secrets).
// NOTE: the Gemini key IS sensitive. For a college/minor project a restricted
// key is acceptable; for real production traffic proxy it through a function.
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

export const GEMINI_API_KEY = "AQ.Ab8RN6Iy7gc4aBxb4lBZAdMQPrj7aa_3cbAga08ZF7MHiiegiA";
export const GEMINI_MODEL = "gemini-2.5-flash";
// UIDs granted admin access without needing an `admins` Firestore doc.
export const ADMIN_UIDS = ["U95gwk62Ale4kPfCNSAlUQ7TQcq2"];
