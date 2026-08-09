// Thin, reusable Firestore/Storage data layer. No hardcoded data anywhere.
import { db } from "../config/firebase.js";
import { ADMIN_UIDS } from "../config/config.js";
import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
};

const snapList = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// Writes must never hang forever (offline, blocked Storage/Firestore host, etc.):
// reject with a readable message so the UI can show it instead of "Saving…".
const WRITE_TIMEOUT_MS = 20000;
export function withTimeout(promise, ms = WRITE_TIMEOUT_MS, label = "Request") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              `${label} timed out after ${Math.round(ms / 1000)}s. Check your internet connection and that Firestore/Storage are enabled for this project.`
            )
          ),
        ms
      )
    ),
  ]);
}

// Reads must never break a page: log and fall back to empty data so the UI
// shows its "no data" state (e.g. before Firebase config is filled in).
const READ_TIMEOUT_MS = 8000;
const safe = async (fn, fallback) => {
  try {
    return await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Firestore request timed out")), READ_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    console.error("Firestore read failed:", err);
    return fallback;
  }
};

/* -------------------------- catalogue cache ---------------------------- */
// The cars collection is ~225KB and takes about a second to fetch, and every
// page asks for the whole thing. Hold it for the tab's session so only the
// first page load pays; writes clear it so the admin never sees stale rows.
const CACHE_TTL_MS = 5 * 60 * 1000;

function cacheRead(key) {
  try {
    const hit = JSON.parse(sessionStorage.getItem("cv:" + key) || "null");
    return hit && Date.now() - hit.t < CACHE_TTL_MS ? hit.v : null;
  } catch {
    return null; // storage blocked, or a quota/parse failure — just refetch
  }
}
function cacheWrite(key, value) {
  try {
    sessionStorage.setItem("cv:" + key, JSON.stringify({ t: Date.now(), v: value }));
  } catch { /* over quota or blocked; caching is optional */ }
}
export function clearCatalogCache() {
  try {
    Object.keys(sessionStorage)
      .filter((k) => k.startsWith("cv:"))
      .forEach((k) => sessionStorage.removeItem(k));
  } catch { /* storage blocked */ }
}
/** Runs a write, then invalidates the cached catalogue. */
const bust = (promise) =>
  Promise.resolve(promise).then((r) => {
    clearCatalogCache();
    return r;
  });

const cached = async (key, load, fallback) => {
  const hit = cacheRead(key);
  if (hit) return hit;
  const value = await safe(load, fallback);
  if (value && value !== fallback) cacheWrite(key, value);
  return value;
};

/* ------------------------------- brands -------------------------------- */
export async function listBrands({ featuredOnly = false } = {}) {
  const items = await cached(
    "brands",
    async () => {
      const snap = await getDocs(collection(db, "brands"));
      return snapList(snap).sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    },
    []
  );
  return featuredOnly ? items.filter((b) => b.featured) : items;
}
export const getBrand = async (id) => {
  const s = await getDoc(doc(db, "brands", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
};
export const saveBrand = (data, id) =>
  bust(
    id
      ? updateDoc(doc(db, "brands", id), { ...data, updatedAt: serverTimestamp() })
      : addDoc(collection(db, "brands"), { ...data, createdAt: serverTimestamp() })
  );
export const deleteBrand = (id) => bust(deleteDoc(doc(db, "brands", id)));

/* -------------------------------- cars --------------------------------- */
export async function listCars({ publishedOnly = true } = {}) {
  const items = await cached(
    "cars",
    async () => {
      const snap = await getDocs(collection(db, "cars"));
      return snapList(snap).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
    },
    []
  );
  return publishedOnly ? items.filter((c) => c.status === "published") : items;
}
export const getCar = (id) =>
  safe(async () => {
    const s = await getDoc(doc(db, "cars", id));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  }, null);
export const saveCar = (data, id) =>
  bust(
    id
    ? withTimeout(
        setDoc(
          doc(db, "cars", id),
          { ...data, updatedAt: serverTimestamp() },
          { merge: true }
        ),
        WRITE_TIMEOUT_MS,
        "Saving the car"
      )
    : withTimeout(
        addDoc(collection(db, "cars"), {
          ...data,
          createdAtMs: Date.now(),
          createdAt: serverTimestamp(),
        }),
        WRITE_TIMEOUT_MS,
        "Saving the car"
      )
  );
export const deleteCar = (id) => bust(deleteDoc(doc(db, "cars", id)));

/* ------------------------------ inquiries ------------------------------ */
export const addInquiry = (data) =>
  addDoc(collection(db, "customerInquiries"), {
    ...data,
    status: "new",
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });
export async function listInquiries() {
  const snap = await getDocs(collection(db, "customerInquiries"));
  return snapList(snap).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}
export const updateInquiry = (id, data) => updateDoc(doc(db, "customerInquiries", id), data);
export const deleteInquiry = (id) => deleteDoc(doc(db, "customerInquiries", id));

/* ------------------------------- wishlist ------------------------------ */
export function visitorId() {
  let id = localStorage.getItem("visitorId");
  if (!id) {
    id = "v_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem("visitorId", id);
  }
  return id;
}
export async function listWishlist() {
  return safe(async () => {
    const snap = await getDocs(
      query(collection(db, "wishlist"), where("visitorId", "==", visitorId()))
    );
    return snapList(snap);
  }, []);
}
export async function toggleWishlist(car) {
  const existing = await listWishlist();
  const hit = existing.find((w) => w.carId === car.id);
  if (hit) {
    await deleteDoc(doc(db, "wishlist", hit.id));
    return false;
  }
  await addDoc(collection(db, "wishlist"), {
    visitorId: visitorId(),
    carId: car.id,
    createdAtMs: Date.now(),
  });
  return true;
}
export const removeWishlist = (id) => deleteDoc(doc(db, "wishlist", id));

/* ------------------------------- compare ------------------------------- */
export async function listCompare() {
  return safe(async () => {
    const snap = await getDocs(
      query(collection(db, "compare"), where("visitorId", "==", visitorId()))
    );
    return snapList(snap);
  }, []);
}
export async function toggleCompare(car) {
  const existing = await listCompare();
  const hit = existing.find((w) => w.carId === car.id);
  if (hit) {
    await deleteDoc(doc(db, "compare", hit.id));
    return false;
  }
  if (existing.length >= 4) throw new Error("You can compare up to 4 cars.");
  await addDoc(collection(db, "compare"), {
    visitorId: visitorId(),
    carId: car.id,
    createdAtMs: Date.now(),
  });
  return true;
}
export const removeCompare = (id) => deleteDoc(doc(db, "compare", id));

/* ------------------------------ chat history --------------------------- */
export const saveChat = (data) =>
  addDoc(collection(db, "chatHistory"), {
    ...data,
    createdAtMs: Date.now(),
    createdAt: serverTimestamp(),
  });
export async function listChats() {
  const snap = await getDocs(collection(db, "chatHistory"));
  return snapList(snap).sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
}
export const deleteChat = (id) => deleteDoc(doc(db, "chatHistory", id));

/* ------------------------------- settings ------------------------------ */
export async function getSettings() {
  return safe(async () => {
    const s = await getDoc(doc(db, "settings", "site"));
    return s.exists() ? s.data() : {};
  }, {});
}
export const saveSettings = (data) =>
  setDoc(doc(db, "settings", "site"), { ...data, updatedAt: serverTimestamp() }, { merge: true });

/* -------------------------------- admins ------------------------------- */
export async function isAdmin(uid) {
  if (Array.isArray(ADMIN_UIDS) && ADMIN_UIDS.includes(uid)) return true;
  try {
    const s = await getDoc(doc(db, "admins", uid));
    return s.exists();
  } catch {
    return false;
  }
}

/* -------------------------------- storage ------------------------------ */
// Uploads go to Cloudflare R2 through the site's own Worker (see worker.js),
// which verifies the caller's Firebase ID token before writing anything.
// Returns { url, path } exactly like the old Firebase Storage version.
export async function uploadFile(folder, file) {
  // Imported here rather than at module scope: this is the only place a
  // signed-in user is needed, and loading Auth eagerly made every public
  // page wait on Firebase's sign-in iframe.
  const { auth } = await import("../config/auth.js");
  const user = auth.currentUser;
  if (!user) throw new Error("Sign in as an admin before uploading files.");

  const body = new FormData();
  body.append("file", file);
  body.append("folder", folder);

  const res = await withTimeout(
    fetch("/api/upload", {
      method: "POST",
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      body,
    }),
    60000,
    `Uploading ${file.name}`
  );

  if (!res.ok) {
    const reason = await res.json().catch(() => ({}));
    throw new Error(reason.error || `Upload failed (${res.status}).`);
  }
  return res.json();
}