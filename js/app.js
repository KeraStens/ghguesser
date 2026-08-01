const state = {
  locations: [],
  corners: [],
  trackPath: null,
  engine: null,
  mapView: null,
  mapViewerInstance: null,
};

const el = (sel) => document.querySelector(sel);
const MAP_DIMS = { viewW: 1400, viewH: 1000, mapSrc: 'assets/map-nurburgring.svg' };

function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  el(`#screen-${name}`).classList.add('active');
}

async function loadData() {
  const [locRes, cornerRes, pathRes] = await Promise.all([
    fetch('assets/locations.json'),
    fetch('assets/corners.json'),
    fetch('assets/track-path.json'),
  ]);
  state.locations = await locRes.json();
  state.corners = await cornerRes.json();
  state.trackPath = await pathRes.json();
  TrackDistance.init(state.trackPath);
}

// ---------------------------------------------------------------------------
// IMAGE LIGHTBOX (full-size screenshot view)
// ---------------------------------------------------------------------------
function openLightbox(src) {
  el('#lightbox-img').src = src;
  el('#image-lightbox').classList.add('visible');
  document.body.classList.add('no-scroll');
}
function closeLightbox() {
  el('#image-lightbox').classList.remove('visible');
  document.body.classList.remove('no-scroll');
}

// ---------------------------------------------------------------------------
// GAME FLOW
// ---------------------------------------------------------------------------
function startGame() {
  state.engine = new GameEngine(state.locations);
  state.engine.startGame();
  showScreen('game');
  renderRound();
}

function renderRound() {
  const round = state.engine.currentRound;
  el('#round-counter').textContent = `Picture ${state.engine.currentRoundIndex + 1} / ${state.engine.rounds.length}`;
  el('#pins-counter').textContent = `Pin ${round.pinsUsed + 1} / ${CONFIG.PINS_PER_ROUND}`;
  el('#scene-img').src = round.location.image;
  el('#tip-box').classList.remove('visible');
  el('#tip-box').textContent = '';
  el('#next-round-btn').style.display = 'none';

  state.mapView.setLocked(false);
  state.mapView.resetZoom();
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

    const nearest = nearestCorners(state.corners, round.location.x, round.location.y, 2);
    const nearestText = nearest.map(c => c.name).join(' / ');

    el('#tip-box').innerHTML =
      `Best pin: ${round.bestGuess.meters}m off. +${round.finalScore} points.<br>` +
      `<span class="nearest-corners">Nearest corners: ${nearestText}</span>`;

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
    showFinal();
  }
}

function ordinal(n) {
  const suffixes = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
}

function showFinal() {
  showScreen('final');
  el('#final-score').textContent = `${state.engine.totalScore} / ${state.engine.maxPossibleScore}`;
  el('#final-breakdown').innerHTML = state.engine.rounds.map((r, i) =>
    `<li>${ordinal(i + 1)} guess: <strong>${r.finalScore}</strong> pts (${r.bestGuess.meters}m off)</li>`
  ).join('');
  el('#final-title').textContent = 'Lap Complete';
}

// ---------------------------------------------------------------------------
// MAP VIEWER (menu)
// ---------------------------------------------------------------------------
function openMapViewer() {
  showScreen('map');
  if (!state.mapViewerInstance) {
    state.mapViewerInstance = new MapView(el('#map-viewer-container'), MAP_DIMS);
    state.mapViewerInstance.setLocked(true); // reference only, not a guessing surface
  }
}

// ---------------------------------------------------------------------------
// WIRING
// ---------------------------------------------------------------------------
function wireUI() {
  el('#play-btn').addEventListener('click', startGame);
  el('#map-btn').addEventListener('click', openMapViewer);
  el('#map-back-btn').addEventListener('click', () => showScreen('landing'));
  el('#game-back-btn').addEventListener('click', () => showScreen('landing'));
  el('#next-round-btn').addEventListener('click', handleNextRound);
  el('#play-again-btn').addEventListener('click', () => showScreen('landing'));

  const sceneImg = el('#scene-img');
  el('#scene-expand-btn').addEventListener('click', () => openLightbox(sceneImg.src));
  sceneImg.addEventListener('click', () => openLightbox(sceneImg.src));
  el('#lightbox-close-btn').addEventListener('click', closeLightbox);
  el('#image-lightbox').addEventListener('click', (e) => {
    if (e.target.id === 'image-lightbox') closeLightbox();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLightbox();
  });

  state.mapView = new MapView(el('#map-container'), MAP_DIMS);
  state.mapView.onGuess = handleMapGuess;
}

async function init() {
  try {
    await loadData();
    wireUI();
    showScreen('landing');
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
