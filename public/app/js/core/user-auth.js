// Customer sign-in. The Auth SDK is loaded on demand: importing it eagerly
// costs ~2.2s on every page for its cross-origin sign-in iframe, and most
// visits never need a user. `cachedUser()` answers instantly from localStorage
// so the header can paint the right links on the first frame.
const CACHE_KEY = "carverse-user";

const readCache = () => {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "null");
  } catch {
    return null; // storage blocked
  }
};
const writeCache = (user) => {
  try {
    if (user) localStorage.setItem(CACHE_KEY, JSON.stringify({ uid: user.uid, email: user.email, name: user.displayName || "" }));
    else localStorage.removeItem(CACHE_KEY);
  } catch { /* storage blocked */ }
};

/** Last known user, with no network round-trip. May be stale by one sign-out. */
export const cachedUser = readCache;

let ready = null;
/** Resolves with the signed-in user, or null. Loads the Auth SDK once. */
export function currentUser() {
  if (ready) return ready;
  ready = (async () => {
    const [{ auth }, { onAuthStateChanged }] = await Promise.all([
      import("../config/auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
    ]);
    return new Promise((resolve) => {
      const stop = onAuthStateChanged(auth, (user) => {
        stop();
        writeCache(user);
        resolve(user);
      });
    });
  })();
  return ready;
}

/** Sends the visitor to the login page, remembering where they wanted to go. */
export function goToLogin(base = "") {
  location.href = `${base}pages/login.html?next=${encodeURIComponent(location.pathname + location.search)}`;
}

/** The user, or null after sending them to the login page. Use this to gate
 *  an action that needs an account (enquiry, AI chat, 3D, wishlist, compare). */
export async function requireUser(base = "") {
  const user = await currentUser();
  if (!user) goToLogin(base);
  return user;
}

/** Firebase's error codes are not for humans. */
export function authMessage(code = "") {
  return (
    {
      "auth/invalid-credential": "Wrong email or password.",
      "auth/invalid-email": "That email address is not valid.",
      "auth/user-not-found": "No account uses that email. Create one below.",
      "auth/wrong-password": "Wrong email or password.",
      "auth/email-already-in-use": "That email already has an account. Sign in instead.",
      "auth/weak-password": "Use a password of at least 6 characters.",
      "auth/too-many-requests": "Too many attempts. Wait a minute and try again.",
      "auth/network-request-failed": "No connection. Check your internet and try again.",
      "auth/operation-not-allowed": "Email sign-in is switched off in the Firebase console.",
    }[code] || "Something went wrong. Please try again."
  );
}

export async function signUp(name, email, password) {
  const [{ auth }, sdk] = await Promise.all([
    import("../config/auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
  ]);
  const cred = await sdk.createUserWithEmailAndPassword(auth, email, password);
  if (name) await sdk.updateProfile(cred.user, { displayName: name });
  ready = Promise.resolve(cred.user);
  writeCache(cred.user);
  return cred.user;
}

export async function signIn(email, password) {
  const [{ auth }, sdk] = await Promise.all([
    import("../config/auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
  ]);
  const cred = await sdk.signInWithEmailAndPassword(auth, email, password);
  ready = Promise.resolve(cred.user);
  writeCache(cred.user);
  return cred.user;
}

export async function resetPassword(email) {
  const [{ auth }, sdk] = await Promise.all([
    import("../config/auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
  ]);
  return sdk.sendPasswordResetEmail(auth, email);
}

export async function signOutUser() {
  const [{ auth }, sdk] = await Promise.all([
    import("../config/auth.js"),
    import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
  ]);
  await sdk.signOut(auth);
  ready = Promise.resolve(null);
  writeCache(null);
}

/** ID token for calls to our Worker, or "" when signed out. */
export async function idToken() {
  const user = await currentUser();
  return user ? user.getIdToken() : "";
}
