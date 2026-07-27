// Uses Firebase v10 modular SDK via CDN (loaded as ES module in index.html)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, onSnapshot,
  collection, serverTimestamp, deleteField
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let db = null;

function ensureDb() {
  if (!MULTIPLAYER_ENABLED) {
    throw new Error("Multiplayer isn't configured yet — set up js/firebase-config.js first.");
  }
  if (!db) {
    const app = initializeApp(FIREBASE_CONFIG);
    db = getFirestore(app);
  }
  return db;
}

function randomRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let code = "";
  for (let i = 0; i < 5; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

class MultiplayerRoom {
  constructor() {
    this.code = null;
    this.playerId = null;
    this.playerName = null;
    this._unsub = null;
  }

  // Host: creates a room with a fixed, shared set of round location ids
  async createRoom(playerName, locationIds) {
    const database = ensureDb();
    const code = randomRoomCode();
    this.code = code;
    this.playerId = crypto.randomUUID();
    this.playerName = playerName;

    await setDoc(doc(database, "rooms", code), {
      createdAt: serverTimestamp(),
      locationIds,
      status: "lobby",
    });
    await setDoc(doc(database, "rooms", code, "players", this.playerId), {
      name: playerName,
      status: "waiting",
      score: 0,
      joinedAt: serverTimestamp(),
    });
    return code;
  }

  async joinRoom(code, playerName) {
    const database = ensureDb();
    const roomRef = doc(database, "rooms", code);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) throw new Error("No room with that code.");

    this.code = code;
    this.playerId = crypto.randomUUID();
    this.playerName = playerName;

    await setDoc(doc(database, "rooms", code, "players", this.playerId), {
      name: playerName,
      status: "waiting",
      score: 0,
      joinedAt: serverTimestamp(),
    });
    return roomSnap.data();
  }

  async startRoomGame() {
    const database = ensureDb();
    await updateDoc(doc(database, "rooms", this.code), { status: "playing" });
  }

  // Live-updates callback(roomData: {status, locationIds})
  watchRoom(callback) {
    const database = ensureDb();
    this._unsubRoom = onSnapshot(doc(database, "rooms", this.code), (snap) => {
      if (snap.exists()) callback(snap.data());
    });
    return this._unsubRoom;
  }

  async setStatus(status) {
    const database = ensureDb();
    await updateDoc(doc(database, "rooms", this.code, "players", this.playerId), { status });
  }

  async submitScore(score) {
    const database = ensureDb();
    await updateDoc(doc(database, "rooms", this.code, "players", this.playerId), {
      status: "done",
      score,
    });
  }

  // Live-updates callback(players: [{id,name,status,score}])
  watchPlayers(callback) {
    const database = ensureDb();
    this._unsub = onSnapshot(
      collection(database, "rooms", this.code, "players"),
      (snap) => {
        const players = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        callback(players);
      }
    );
    return this._unsub;
  }

  stopWatching() {
    if (this._unsub) this._unsub();
    if (this._unsubRoom) this._unsubRoom();
    this._unsub = null;
    this._unsubRoom = null;
  }
}
