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

async function copyResultsAsImage() {
  const btn = el('#copy-results-btn');
  const originalText = btn.textContent;

  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
    const blob = await renderResultsCard();

    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      btn.textContent = 'Copied!';
    } else {
      throw new Error('Clipboard image API not available');
    }
  } catch (err) {
    // Fallback: clipboard image writes aren't supported everywhere (older Safari,
    // insecure contexts, permission denial) — download the PNG instead.
    try {
      const blob = await renderResultsCard();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'green-hell-results.png';
      a.click();
      btn.textContent = 'Downloaded (clipboard unavailable)';
    } catch (err2) {
      btn.textContent = "Couldn't generate image";
    }
  }
  setTimeout(() => { btn.textContent = originalText; }, 2200);
}

function renderResultsCard() {
  const rounds = state.engine.rounds;
  const W = 900;
  const rowH = 42;
  const H = 340 + rounds.length * rowH;

  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = '#0b0f0b';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createRadialGradient(W/2, H*0.4, 40, W/2, H*0.4, W*0.7);
  grad.addColorStop(0, '#1c2e20');
  grad.addColorStop(1, '#0b0f0b');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(202,182,138,0.25)';
  ctx.lineWidth = 2;
  ctx.strokeRect(16, 16, W - 32, H - 32);

  // eyebrow
  ctx.fillStyle = '#c98a4b';
  ctx.font = '600 16px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('NORDSCHLEIFE — THE GREEN HELL', W / 2, 62);

  // title
  ctx.fillStyle = '#f2e6c9';
  ctx.font = '400 56px "Staatliches", sans-serif';
  ctx.fillText('LAP COMPLETE', W / 2, 118);

  // total score
  ctx.fillStyle = '#c98a4b';
  ctx.font = '600 20px "JetBrains Mono", monospace';
  ctx.fillText('TOTAL SCORE', W / 2, 168);
  ctx.fillStyle = '#f2e6c9';
  ctx.font = '400 64px "Staatliches", sans-serif';
  ctx.fillText(`${state.engine.totalScore} / ${state.engine.maxPossibleScore}`, W / 2, 232);

  // divider
  ctx.strokeStyle = 'rgba(202,182,138,0.3)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W * 0.18, 258);
  ctx.lineTo(W * 0.82, 258);
  ctx.stroke();

  // per-round breakdown
  ctx.textAlign = 'left';
  const rowStartY = 300;
  rounds.forEach((r, i) => {
    const y = rowStartY + i * rowH;
    ctx.fillStyle = 'rgba(242,230,201,0.06)';
    if (i % 2 === 0) ctx.fillRect(48, y - 26, W - 96, rowH - 8);

    ctx.fillStyle = '#f2e6c9';
    ctx.font = '600 17px "JetBrains Mono", monospace';
    ctx.fillText(`${ordinal(i + 1)} guess`, 68, y);

    ctx.fillStyle = '#cdbf9a';
    ctx.font = '400 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(`${r.bestGuess.meters}m off`, W - 68 - 130, y);

    ctx.fillStyle = '#c98a4b';
    ctx.font = '700 17px "JetBrains Mono", monospace';
    ctx.fillText(`${r.finalScore} pts`, W - 68, y);
    ctx.textAlign = 'left';
  });

  // footer
  ctx.fillStyle = 'rgba(205,191,154,0.6)';
  ctx.font = '400 13px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Green Hell: Picture Guesser', W / 2, H - 26);

  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('toBlob failed')), 'image/png');
  });
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
  el('#copy-results-btn').addEventListener('click', copyResultsAsImage);

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
