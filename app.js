
// app.js (patched with debug logs for Go Live + Join Live)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-app.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/9.6.10/firebase-firestore.js";

// ================== GO LIVE ==================
async function goLive() {
  console.log("📡 Go Live button clicked...");

  if (!window.FB_CFG) {
    console.error("❌ Firebase config (window.FB_CFG) is missing.");
    alert("Firebase config not loaded. Did you set firebase-config.js?");
    return;
  }

  try {
    console.log("✅ Firebase config loaded:", window.FB_CFG.projectId);

    if (!window._app) {
      window._app = initializeApp(window.FB_CFG);
      console.log("✅ Firebase app initialized.");
    } else {
      console.log("ℹ️ Firebase app already initialized.");
    }

    const db = getFirestore(window._app);
    if (!db) throw new Error("❌ Firestore not initialized");
    console.log("✅ Firestore initialized.");

    const code = makeRoomCode();
    console.log("🎲 Generated room code:", code);

    const state = getStateSnapshot();
    console.log("📦 Match state snapshot:", state);

    const ref = doc(db, "matches", code);
    console.log("📂 Writing to Firestore path:", ref.path);

    await setDoc(ref, {
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      state
    });

    console.log("✅ Firestore document created successfully.");
    alert("Live room created: " + code);

    openLiveWindow(code);
  } catch (err) {
    console.error("❌ Go Live FAILED ❌", err);
    if (err.code === "permission-denied") {
      alert("Permission denied: Check your Firestore rules.");
    } else if (err.code === "unavailable") {
      alert("Network unavailable: Check your internet or Firestore region.");
    } else {
      alert("Go Live failed: " + err.message);
    }
  }
}

// ================== JOIN LIVE ==================
async function joinLive(code) {
  console.log("👥 Join Live button clicked with code:", code);

  if (!window.FB_CFG) {
    console.error("❌ Firebase config (window.FB_CFG) missing.");
    alert("Firebase config not loaded. Did you set firebase-config.js?");
    return;
  }

  try {
    if (!window._app) {
      window._app = initializeApp(window.FB_CFG);
      console.log("✅ Firebase app initialized (viewer).");
    } else {
      console.log("ℹ️ Firebase app already initialized (viewer).");
    }

    const db = getFirestore(window._app);
    if (!db) throw new Error("❌ Firestore not initialized (viewer).");
    console.log("✅ Firestore initialized (viewer).");

    const ref = doc(db, "matches", code);
    console.log("📂 Looking up Firestore path:", ref.path);

    const snap = await getDoc(ref);
    if (!snap.exists()) {
      console.warn("⚠️ Room not found in Firestore for code:", code);
      alert("Room code not found. Double-check and try again.");
      return;
    }

    console.log("✅ Found live match document:", snap.data());
    alert("Joined live room: " + code);

    openViewerWindow(code);
  } catch (err) {
    console.error("❌ Join Live FAILED ❌", err);
    if (err.code === "permission-denied") {
      alert("Permission denied: Check your Firestore rules.");
    } else if (err.code === "unavailable") {
      alert("Network unavailable: Check your internet or Firestore region.");
    } else {
      alert("Join Live failed: " + err.message);
    }
  }
}
