# Green Hell: Picture Guesser

A GeoGuessr-style game: you're shown a screenshot from an expedition, you drop
a pin on the map for where it was taken. 3 pins per picture, with a hot/cold +
compass tip after each one. Works solo, or with friends via a room code.

## Run it locally

No build step. Just serve the folder — you can't open `index.html` directly
via `file://` because it uses `fetch()` for the location data.

```
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy to GitHub Pages

1. Push this whole folder to a GitHub repo.
2. Repo Settings → Pages → Source: deploy from branch → `main` → `/ (root)`.
3. Your game is live at `https://<username>.github.io/<repo>/`.

That's it for solo mode — it's 100% static and needs nothing else.

## Swap in real assets

- **Map**: replace `assets/map-placeholder.svg` with your real map. Keep it
  square (or update `.map-panel { aspect-ratio }` in `styles.css` to match).
  Guess accuracy is measured in **normalized 0–1 coordinates** across the
  image, so any image works as a drop-in replacement.
- **Screenshots + true locations**: edit `assets/locations.json`. Each entry
  needs an `image` path and the `x`/`y` (0–1) position on the map where that
  screenshot was taken. Add as many as you want — `CONFIG.ROUNDS_PER_GAME` in
  `js/game.js` picks a random subset each playthrough.
- Tune scoring/round count/pin count at the top of `js/game.js` — it's all in
  one `CONFIG` object.

## Enable multiplayer

GitHub Pages only serves static files, so multiplayer rooms are backed by a
free Firebase project (Firestore) instead of a custom server.

1. Go to https://console.firebase.google.com → **Add project** (free tier is
   plenty for this).
2. **Build → Firestore Database → Create database** (start in test mode is
   fine for a small group of friends; lock it down later if you want).
3. **Project settings → General → Your apps → Web app (`</>`)** → copy the
   config object it gives you.
4. Paste those values into `js/firebase-config.js`, replacing the
   placeholders. That's the only file you need to touch.

Once that's filled in, "Play with Friends" works: host creates a room and
gets a 5-letter code, friends join with the code, everyone sees the same set
of pictures, and a live leaderboard fills in as people finish.

**Note on Firestore test-mode rules**: test mode allows open read/write for
30 days, which is fine for casual play with people you trust with the link.
If you want it locked down, restrict rules to the `rooms/{code}` path.

## How scoring works

- Each round: up to 3 pins.
- Pin 1: no comparison yet, just a vague read.
- Pin 2 & 3: compared to the previous pin — "warmer" (closer) or "colder"
  (farther), plus a rough compass bearing toward the truth.
- Only the **final** pin of a round counts for score. Falloff is linear from
  `MAX_SCORE_PER_ROUND` at 0m to 0 at ~2200m (tunable in `CONFIG`).

## File map

```
index.html              screens + layout
styles.css               all visual styling
js/game.js               CONFIG, scoring, tip logic, round/game state
js/map.js                click-to-pin map rendering
js/multiplayer.js        Firebase room/lobby/leaderboard logic
js/firebase-config.js    <- put your Firebase config here
js/app.js                wires screens + game + multiplayer together
assets/locations.json    screenshot -> true map coordinate data
assets/screenshots/      placeholder images (swap with real captures)
assets/map-placeholder.svg   placeholder map (swap with real map)
```
