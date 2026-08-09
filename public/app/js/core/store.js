// Thin, reusable Firestore/Storage data layer. No hardcoded data anywhere.
import { auth, db } from "../config/firebase.js";
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

/* ------------------------------- brands -------------------------------- */
export async function listBrands({ featuredOnly = false } = {}) {
  return safe(async () => {
    const snap = await getDocs(collection(db, "brands"));
    let items = snapList(snap);
    if (featuredOnly) items = items.filter((b) => b.featured);
    return items.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, []);
}
export const getBrand = async (id) => {
  const s = await getDoc(doc(db, "brands", id));
  return s.exists() ? { id: s.id, ...s.data() } : null;
};
export const saveBrand = (data, id) =>
  id
    ? updateDoc(doc(db, "brands", id), { ...data, updatedAt: serverTimestamp() })
    : addDoc(collection(db, "brands"), { ...data, createdAt: serverTimestamp() });
export const deleteBrand = (id) => deleteDoc(doc(db, "brands", id));

/* -------------------------------- cars --------------------------------- */
export async function listCars({ publishedOnly = true } = {}) {
  return safe(async () => {
    const snap = await getDocs(collection(db, "cars"));
    let items = snapList(snap);
    if (publishedOnly) items = items.filter((c) => c.status === "published");
    return items.sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
  }, []);
}
export const getCar = (id) =>
  safe(async () => {
    const s = await getDoc(doc(db, "cars", id));
    return s.exists() ? { id: s.id, ...s.data() } : null;
  }, null);
export const saveCar = (data, id) =>
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
      );
export const deleteCar = (id) => deleteDoc(doc(db, "cars", id));

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