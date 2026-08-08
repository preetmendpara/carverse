// ---------------------------------------------------------------------------
// Local demo access for the admin panel.
// Active ONLY while Firebase is still using placeholder credentials, so you
// can explore the dashboard before wiring up your own project. Once real
// credentials are in firebase/config.js this file disables itself and the
// normal Firebase Auth + `admins` collection guard is the only way in.
// ---------------------------------------------------------------------------
import { firebaseConfig } from "../../firebase/config.js";

export const DEMO_EMAIL = "admin@carverse.local";
export const DEMO_PASSWORD = "carverse123";
const KEY = "carverse_demo_admin";

export const demoAvailable = () =>
  !firebaseConfig.apiKey || firebaseConfig.apiKey.startsWith("YOUR_");

export const demoSignIn = (email, password) => {
  if (!demoAvailable()) return false;
  if (email.trim().toLowerCase() !== DEMO_EMAIL || password !== DEMO_PASSWORD) return false;
  sessionStorage.setItem(KEY, "1");
  return true;
};

export const isDemoAdmin = () => demoAvailable() && sessionStorage.getItem(KEY) === "1";
export const demoSignOut = () => sessionStorage.removeItem(KEY);
