// ---------------------------------------------------------------------------
// GAME CONFIG — tune these without touching logic below
// ---------------------------------------------------------------------------
const CONFIG = {
  ROUNDS_PER_GAME: 5,        // how many pictures per playthrough
  PINS_PER_ROUND: 3,         // guesses allowed per picture
  MAP_SPAN_METERS: 2000,     // flavor scale: how many meters the map's 0-1 span represents
  MAX_SCORE_PER_ROUND: 1000, // points for a perfect (0m) guess
  SCORE_FALLOFF: 0.45,       // points lost per meter of error (linear falloff)
};

// Bearing labels for compass-style tips
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function bearingLabel(fromX, fromY, toX, toY) {
  // svg y grows downward, so invert dy for compass "north = up"
  const dx = toX - fromX;
  const dy = fromY - toY;
  let deg = Math.atan2(dx, dy) * (180 / Math.PI);
  if (deg < 0) deg += 360;
  const idx = Math.round(deg / 22.5) % 16;
  return COMPASS[idx];
}

function normalizedDistance(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function distanceToMeters(normDist) {
  return normDist * CONFIG.MAP_SPAN_METERS;
}

function scoreForDistance(normDist) {
  const meters = distanceToMeters(normDist);
  const score = Math.round(CONFIG.MAX_SCORE_PER_ROUND - meters * CONFIG.SCORE_FALLOFF);
  return Math.max(0, Math.min(CONFIG.MAX_SCORE_PER_ROUND, score));
}

// Field-journal flavored tip lines
const TIP_LINES = {
  warmer: [
    "Getting warmer. The undergrowth looks familiar here.",
    "This feels closer to where I was standing.",
    "Warmer — the light matches what I remember.",
  ],
  colder: [
    "Colder. This doesn't match the picture at all.",
    "Further off than the last guess.",
    "Colder — wrong side of the ridge, I think.",
  ],
  first: [
    "First read on the terrain — trust your gut.",
    "No reference point yet. Take your best guess.",
  ],
};

function pickLine(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

class RoundState {
  constructor(location) {
    this.location = location; // { id, image, name, x, y }
    this.guesses = [];        // [{x,y,distance,score}]
  }

  get pinsUsed() {
    return this.guesses.length;
  }

  get isComplete() {
    return this.guesses.length >= CONFIG.PINS_PER_ROUND;
  }

  addGuess(x, y) {
    const dist = normalizedDistance(x, y, this.location.x, this.location.y);
    const score = scoreForDistance(dist);
    const entry = { x, y, distance: dist, score, meters: Math.round(distanceToMeters(dist)) };
    this.guesses.push(entry);
    return entry;
  }

  // Tip for the NEXT guess, based on how this guess compares to the previous one
  tipForLastGuess() {
    const n = this.guesses.length;
    const last = this.guesses[n - 1];
    const bearing = bearingLabel(last.x, last.y, this.location.x, this.location.y);

    if (n === 1) {
      return { kind: 'first', text: pickLine(TIP_LINES.first), bearing };
    }
    const prev = this.guesses[n - 2];
    if (last.distance < prev.distance) {
      return { kind: 'warmer', text: pickLine(TIP_LINES.warmer), bearing };
    } else if (last.distance > prev.distance) {
      return { kind: 'colder', text: pickLine(TIP_LINES.colder), bearing };
    }
    return { kind: 'same', text: "Exactly as close as before.", bearing };
  }

  get finalScore() {
    if (this.guesses.length === 0) return 0;
    return this.guesses[this.guesses.length - 1].score;
  }
}

class GameEngine {
  constructor(locations) {
    this.allLocations = locations;
    this.rounds = [];
    this.currentRoundIndex = 0;
  }

  startGame(roundCount = CONFIG.ROUNDS_PER_GAME) {
    const shuffled = [...this.allLocations].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, Math.min(roundCount, shuffled.length));
    this.rounds = picked.map(loc => new RoundState(loc));
    this.currentRoundIndex = 0;
    return this.currentRound;
  }

  // For multiplayer: force a specific ordered set of location ids so all players see the same pictures
  startGameWithLocationIds(ids) {
    const byId = Object.fromEntries(this.allLocations.map(l => [l.id, l]));
    this.rounds = ids.map(id => new RoundState(byId[id])).filter(r => r.location);
    this.currentRoundIndex = 0;
    return this.currentRound;
  }

  get currentRound() {
    return this.rounds[this.currentRoundIndex] || null;
  }

  get isLastRound() {
    return this.currentRoundIndex >= this.rounds.length - 1;
  }

  nextRound() {
    if (this.currentRoundIndex < this.rounds.length - 1) {
      this.currentRoundIndex += 1;
    }
    return this.currentRound;
  }

  get totalScore() {
    return this.rounds.reduce((sum, r) => sum + r.finalScore, 0);
  }

  get maxPossibleScore() {
    return this.rounds.length * CONFIG.MAX_SCORE_PER_ROUND;
  }
}
