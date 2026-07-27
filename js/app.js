// Multiplayer is loaded lazily (only when needed) so a Firebase/CDN hiccup
// can never break solo mode, which has no business depending on it.
let MultiplayerRoom = null;
async function loadMultiplayerModule() {
  if (!MultiplayerRoom) {
    const mod = await import('./multiplayer.js');
    MultiplayerRoom = mod.MultiplayerRoom;
  }
  return MultiplayerRoom;
}

const state = {
  locations: [],
  engine: null,
  mapView: null,
  mode: 'solo', // 'solo' | 'mp'
  mp: null,     // MultiplayerRoom instance
  pendingGuess: null,
};

const el = (sel) => document.querySelector(sel);
const screens = {};

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el(`#screen-${name}`).classList.add('active');
}

async function loadLocations() {
  const res = await fetch('assets/locations.json');
  state.locations = await res.json();
}

// ---------------------------------------------------------------------------
// SOLO MODE
// ---------------------------------------------------------------------------
function startSoloGame() {
  state.mode = 'solo';
  state.engine = new GameEngine(state.locations);
  state.engine.startGame();
  showScreen('game');
  renderRound();
}

// ---------------------------------------------------------------------------
// SHARED GAME-SCREEN RENDERING
// ---------------------------------------------------------------------------
function renderRound() {
  const round = state.engine.currentRound;
  el('#round-counter').textContent = `Picture ${state.engine.currentRoundIndex + 1} / ${state.engine.rounds.length}`;
  el('#pins-counter').textContent = `Pin ${round.pinsUsed + 1} / ${CONFIG.PINS_PER_ROUND}`;
  el('#scene-img').src = round.location.image;
  el('#tip-box').classList.remove('visible');
  el('#tip-box').textContent = '';
  el('#next-round-btn').style.display = 'none';

  state.mapView.setLocked(false);
  state.mapView.render(round.guesses, null);
}

function handleMapGuess(x, y) {
  const round = state.engine.currentRound;
  if (round.isComplete) return;

  const entry = round.addGuess(x, y);
  const tip = round.tipForLastGuess();

  const tipBox = el('#tip-box');
  tipBox.textContent = `${tip.text}  (bearing: ${tip.bearing})  — ${entry.meters}m off`;
  tipBox.classList.add('visible');
  tipBox.dataset.kind = tip.kind;

  el('#pins-counter').textContent = `Pin ${round.pinsUsed} / ${CONFIG.PINS_PER_ROUND}`;

  if (round.isComplete) {
    state.mapView.setLocked(true);
    state.mapView.render(round.guesses, round.location);
    el('#tip-box').textContent = `Final guess: ${entry.meters}m off. +${entry.score} points.`;
    el('#next-round-btn').style.display = 'inline-block';
    el('#next-round-btn').textContent = state.engine.isLastRound ? 'See results' : 'Next picture';
  } else {
    state.mapView.render(round.guesses, null);
  }
}

function handleNextRound() {
  if (!state.engine.isLastRound) {
    state.engine.nextRound();
    renderRound();
  } else {
    finishGame();
  }
}

function finishGame() {
  if (state.mode === 'solo') {
    showFinalSolo();
  } else {
    submitMultiplayerScore();
  }
}

function showFinalSolo() {
  showScreen('final');
  el('#final-score').textContent = `${state.engine.totalScore} / ${state.engine.maxPossibleScore}`;
  el('#final-breakdown').innerHTML = state.engine.rounds.map((r, i) =>
    `<li>${r.location.name}: <strong>${r.finalScore}</strong> pts (${r.guesses[r.guesses.length - 1].meters}m off)</li>`
  ).join('');
  el('#final-title').textContent = 'Expedition Complete';
  el('#mp-leaderboard-wrap').style.display = 'none';
  el('#play-again-btn').style.display = 'inline-block';
}

// ---------------------------------------------------------------------------
// MULTIPLAYER MODE
// ---------------------------------------------------------------------------
async function createRoom() {
  const name = el('#mp-name-input').value.trim() || 'Player';
  if (!MULTIPLAYER_ENABLED) {
    alert('Multiplayer needs Firebase set up first — see js/firebase-config.js.');
    return;
  }
  const shuffled = [...state.locations].sort(() => Math.random() - 0.5);
  const ids = shuffled.slice(0, CONFIG.ROUNDS_PER_GAME).map(l => l.id);

  const MPRoom = await loadMultiplayerModule();
  state.mp = new MPRoom();
  const code = await state.mp.createRoom(name, ids);
  enterLobby(code, true);
}

async function joinRoom() {
  const name = el('#mp-name-input').value.trim() || 'Player';
  const code = el('#mp-code-input').value.trim().toUpperCase();
  if (!MULTIPLAYER_ENABLED) {
    alert('Multiplayer needs Firebase set up first — see js/firebase-config.js.');
    return;
  }
  if (!code) return alert('Enter a room code.');

  state.mp = new (await loadMultiplayerModule())();
  try {
    await state.mp.joinRoom(code, name);
    enterLobby(code, false);
  } catch (err) {
    alert(err.message);
  }
}

function enterLobby(code, isHost) {
  showScreen('mp-lobby');
  el('#lobby-code').textContent = code;
  el('#lobby-start-btn').style.display = isHost ? 'inline-block' : 'none';
  el('#lobby-wait-msg').style.display = isHost ? 'none' : 'block';

  state.mp.watchPlayers(renderLobbyPlayers);
  state.mp.watchRoom((room) => {
    if (room.status === 'playing' && !state._mpStarted) {
      state._mpStarted = true;
      startMultiplayerGame(room.locationIds);
    }
  });
}

function renderLobbyPlayers(players) {
  el('#lobby-players').innerHTML = players.map(p =>
    `<li>${p.name} <span class="status-tag">${p.status}</span></li>`
  ).join('');
}

async function hostStartGame() {
  await state.mp.startRoomGame();
}

function startMultiplayerGame(locationIds) {
  state.mode = 'mp';
  state.engine = new GameEngine(state.locations);
  state.engine.startGameWithLocationIds(locationIds);
  state.mp.setStatus('playing');
  showScreen('game');
  renderRound();
}

async function submitMultiplayerScore() {
  state.mp.stopWatching(); // drop lobby listeners before attaching results listeners
  await state.mp.submitScore(state.engine.totalScore);
  showScreen('final');
  el('#final-title').textContent = 'Waiting on the rest of the squad…';
  el('#final-score').textContent = `Your score: ${state.engine.totalScore} / ${state.engine.maxPossibleScore}`;
  el('#final-breakdown').innerHTML = '';
  el('#play-again-btn').style.display = 'none';
  el('#mp-leaderboard-wrap').style.display = 'block';

  state.mp.watchPlayers((players) => {
    const sorted = [...players].sort((a, b) => b.score - a.score);
    el('#mp-leaderboard').innerHTML = sorted.map((p, i) =>
      `<li>#${i + 1} — ${p.name}: <strong>${p.score}</strong> ${p.status !== 'done' ? '(playing…)' : ''}</li>`
    ).join('');
    const allDone = players.every(p => p.status === 'done');
    el('#final-title').textContent = allDone ? 'Final Results' : 'Waiting on the rest of the squad…';
  });
}

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
function wireUI() {
  el('#solo-btn').addEventListener('click', startSoloGame);
  el('#mp-btn').addEventListener('click', () => showScreen('mp-setup'));
  el('#back-to-landing-1').addEventListener('click', () => showScreen('landing'));
  el('#back-to-landing-2').addEventListener('click', () => { state.mp?.stopWatching(); showScreen('landing'); });

  el('#create-room-btn').addEventListener('click', createRoom);
  el('#join-room-btn').addEventListener('click', joinRoom);
  el('#lobby-start-btn').addEventListener('click', hostStartGame);

  el('#next-round-btn').addEventListener('click', handleNextRound);
  el('#play-again-btn').addEventListener('click', () => { state.mp?.stopWatching(); showScreen('landing'); });
  el('#play-again-final-btn').addEventListener('click', () => { state.mp?.stopWatching(); showScreen('landing'); });

  state.mapView = new MapView(el('#map-container'));
  state.mapView.onGuess = handleMapGuess;
}

async function init() {
  try {
    await loadLocations();
    wireUI();
    showScreen('landing');
    if (!MULTIPLAYER_ENABLED) {
      el('#mp-btn').title = 'Set up js/firebase-config.js to enable this';
    }
  } catch (err) {
    console.error('Failed to start Green Hell: Picture Guesser', err);
    document.body.innerHTML = `<div style="padding:40px;font-family:monospace;color:#f2e6c9;background:#0b0f0b;min-height:100vh">
      <h2>Couldn't load the game</h2>
      <p>${err.message}</p>
      <p>Check the browser console (F12) for details — this is usually a missing or misnamed file.</p>
    </div>`;
  }
}

init();
