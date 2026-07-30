// ---------------------------------------------------------------------------
// GAME CONFIG — tune these without touching logic below
// ---------------------------------------------------------------------------
const CONFIG = {
  ROUNDS_PER_GAME: 5,        // how many pictures per playthrough
  PINS_PER_ROUND: 3,         // guesses allowed per picture
  MAP_ASPECT_W: 1400,        // must match the map SVG's viewBox width
  MAP_ASPECT_H: 1000,        // must match the map SVG's viewBox height
  MAX_SCORE_PER_ROUND: 1000, // points for a perfect (0m) guess
  SCORE_FALLOFF: 0.1,        // points lost per meter of error — tuned so the worst possible
                              // guess (half the 20,832m lap away, the max any arc-distance can be)
                              // still bottoms out at 0 points
};

// ---------------------------------------------------------------------------
// TRACK-DISTANCE — guesses are scored by distance *along the track centerline*
// (the real racing line), not straight-line "as the crow flies" distance.
// Both points are projected onto the nearest spot on the GPS-traced centerline,
// then the shortest arc between those two spots (going either direction around
// the closed 20,832m lap) is the guess distance in meters.
// ---------------------------------------------------------------------------
const TrackDistance = {
  points: null,      // [{x,y,m}] normalized 0-1 coords + meters-along-track from start/finish
  totalMeters: 0,
  ready: false,

  init(data) {
    this.points = data.points;
    this.totalMeters = data.totalMeters;
    this.ready = true;
  },

  // nearest-point-on-polyline projection; returns along-track position in meters
  projectMeters(x, y) {
    if (!this.ready || !this.points || this.points.length < 2) return 0;
    const W = CONFIG.MAP_ASPECT_W, H = CONFIG.MAP_ASPECT_H;
    const px = x * W, py = y * H;
    const pts = this.points;
    let bestD2 = Infinity, bestM = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const ax = pts[i].x * W, ay = pts[i].y * H;
      const bx = pts[i + 1].x * W, by = pts[i + 1].y * H;
      const abx = bx - ax, aby = by - ay;
      const abLenSq = abx * abx + aby * aby || 1e-9;
      let t = ((px - ax) * abx + (py - ay) * aby) / abLenSq;
      t = Math.max(0, Math.min(1, t));
      const cx = ax + abx * t, cy = ay + aby * t;
      const dx = px - cx, dy = py - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        bestM = pts[i].m + (pts[i + 1].m - pts[i].m) * t;
      }
    }
    return bestM;
  },

  // shortest distance along the closed loop between two along-track positions
  arcDistance(mA, mB) {
    const d = Math.abs(mA - mB);
    return Math.min(d, this.totalMeters - d);
  },

  // convenience: distance in meters, along the track, between two normalized (x,y) points
  distanceMeters(ax, ay, bx, by) {
    const mA = this.projectMeters(ax, ay);
    const mB = this.projectMeters(bx, by);
    return this.arcDistance(mA, mB);
  },
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

function scoreForMeters(meters) {
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

function nearestCorners(corners, x, y, count = 2) {
  return corners
    .map(c => ({ ...c, distance: TrackDistance.distanceMeters(x, y, c.x, c.y) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, count);
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
    const meters = Math.round(TrackDistance.distanceMeters(x, y, this.location.x, this.location.y));
    const score = scoreForMeters(meters);
    const entry = { x, y, meters, score };
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
    if (last.meters < prev.meters) {
      return { kind: 'warmer', text: pickLine(TIP_LINES.warmer), bearing };
    } else if (last.meters > prev.meters) {
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
