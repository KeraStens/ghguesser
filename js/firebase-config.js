// ---------------------------------------------------------------------------
// REPLACE THIS with your own Firebase project config to enable multiplayer.
// Single-player works with zero setup — this file is only needed for rooms.
//
// How to get one (free):
//   1. https://console.firebase.google.com -> Add project
//   2. Build -> Firestore Database -> Create database (start in test mode)
//   3. Project settings -> General -> Your apps -> Web app (</>) -> copy config
// ---------------------------------------------------------------------------
const FIREBASE_CONFIG = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const MULTIPLAYER_ENABLED = FIREBASE_CONFIG.apiKey !== "YOUR_API_KEY";
