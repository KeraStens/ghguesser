# Green Hell: Picture Guesser

A GeoGuessr-style game: you're shown a screenshot from a Nordschleife lap, you drop
a pin on the map for where it was taken. 3 pins per picture, with a hot/cold +
compass tip after each one. Single-player only.

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

It's 100% static — no backend, no config, nothing else to set up.

## Interaction features

- **Full-size screenshot**: click the photo (or the ✦ button on it) to open
  it full-screen. Esc, the ✕, or clicking outside the image closes it.
- **Map zoom**: scroll/pinch to zoom (up to 5×), drag to pan once zoomed,
  double-click/double-tap to zoom in on that spot, and the −/1:1/+ buttons in
  the corner do the same. Zoom resets automatically at the start of each
  round. Guess coordinates are computed from the underlying 0–1 track space,
  so zooming in doesn't change scoring — it just makes it easier to place the
  pin precisely.
- **Fullscreen map**: the ✦ button on the map panel (both in-game and on the
  standalone Map screen) expands it to fill the viewport for a bigger,
  easier-to-aim-at view; ✕ or Esc closes it.
- **Share results**: "Copy results as image" on the final screen renders the
  score + per-round breakdown to a canvas and copies it to the clipboard as a
  PNG (`navigator.clipboard.write`), ready to paste into Discord/chat. Falls
  back to downloading the PNG if the clipboard image API isn't available
  (older Safari, or a non-secure context).

## Swap in real assets

- **Map**: `assets/map-nurburgring.svg` is traced from a real GPS survey of
  the Nordschleife (a 534-point tourist-lap GPX track, ~20.6 km recorded
  length against the official 20.832 km), not hand-drawn. The track shape,
  the true ~6.1 × 4.9 km bounding box aspect ratio, and every corner label
  position are all derived from that trace: each named corner is placed at
  its actual distance-along-track (in km, per the official Nordschleife
  section markers) rather than eyeballed. North is up. If you want a
  photographic map instead, swap in a real map image and update `MAP_DIMS`
  in `js/app.js` to match your image's actual pixel dimensions — guesses are
  measured in **normalized 0–1 coordinates**, so any image works as a
  drop-in.
  - Regeneration notes for future updates: the source GPX trace is shipped
    at `tools/nordschleife-source.gpx` (534 trackpoints, starting and ending
    at the start/finish straight). To rebuild or extend the map: project
    lat/lon to local meters (equirectangular, scaled by `cos(mean_lat)`), fit
    the result to the 1400×1000 viewBox preserving the real aspect ratio,
    then walk cumulative haversine distance along the trace to place each
    named corner at its known official km marker (e.g. Flugplatz ≈ km 4.3,
    Karussell ≈ km 13.7, Brünnchen ≈ km 16.2 — see nordschleife-btg.net's
    section table for the full list).
- **Start/finish lines**: permanently baked into `assets/map-nurburgring.svg`
  (matched to the real start/finish straight). There's no picker for these
  anymore — if they ever need to move, edit the two `<line>`/`<text>` pairs
  near the top of the SVG directly (search for "start / finish lines").
- **Screenshots + true locations**: use `tools/location-picker.html` — open
  it in a browser, click the map where a screenshot was taken, and it builds
  a ready-to-paste `locations.json` for you. Much easier than hand-editing
  coordinates. You can also load your current `locations.json` into it to
  keep adding to your existing set. Supports selecting many screenshots at
  once and queues them so you can click through them rapidly. This tool runs
  entirely in your browser and never writes anywhere — even if it ends up
  publicly reachable on your deployed site, visitors can only generate a
  JSON file on their own screen, not push data into your live game.
- Tune scoring/round count/pin count at the top of `js/game.js` — it's all in
  one `CONFIG` object. `MAP_ASPECT_W`/`MAP_ASPECT_H` must match whatever map
  image you use, so distance scoring isn't skewed on a non-square map.

## How scoring works

- Each round: up to 3 pins.
- Pin 1: no comparison yet, just a vague read.
- Pin 2 & 3: compared to the previous pin — "warmer" (closer) or "colder"
  (farther), plus a rough compass bearing toward the truth.
- Distance is measured **along the track centerline**, not straight-line —
  both the guess and the true point are projected onto the nearest spot on
  the GPS-traced racing line (`assets/track-path.json`, 534 points spanning
  the real 20,832m lap), then scored by the shorter arc between those two
  spots around the closed loop. A guess on the inside of the Karussell
  hairpin and the real point just meters away on the other side of the
  loop won't get credit for being "close" if they're actually on opposite
  sides of the track by road distance. The connecting line drawn after the
  final pin traces this same route along the track rather than cutting
  straight across the infield.
- The **best** of the 3 pins counts for score, not necessarily the last one —
  so a good first guess isn't wasted if pin 2 or 3 ends up worse. Falloff is
  curved, not
  linear: `MAX_SCORE_PER_ROUND` (1000) at 0m, dropping to 0 at
  `SCORE_MAX_DISTANCE_M` (3000m) along a `SCORE_CURVE_POWER`-exponent ease-out
  curve (default power 2 — quadratic), so precision near the true point is
  rewarded disproportionately: e.g. by default, 100m off only costs ~66
  points, but 2500m off leaves only ~28. Both are tunable in `CONFIG`. This
  only affects the score number — the hot/cold tip between pins still
  compares raw along-track meters, so it's unaffected by the curve.
- After the 3rd pin, the true point is revealed along with the two nearest
  named corners (from `assets/corners.json`, also by along-track distance)
  — e.g. "Nearest corners: Karussell / Hohe Acht" — so a wrong guess still
  teaches you the map.
- Regenerating the map? `assets/track-path.json` needs to stay in sync with
  `assets/map-nurburgring.svg` — both are derived from the same GPS trace
  (`tools/nordschleife-source.gpx`) using the same projection, so if you
  retrace the map you should regenerate the path data the same way.

## Map button

The landing screen has a "Map" button that shows the full track with all
corner names labeled, for studying the layout outside of a round. This just
displays `assets/map-nurburgring.svg` directly — the corner labels are baked
into that image already.

If you replace the map image, remember `assets/corners.json` won't update
itself — it's a separate list of named points used for the "nearest corners"
callout, so keep it in sync with whatever your map actually shows.

## File map

```
index.html              screens + layout
styles.css               all visual styling
js/game.js               CONFIG, scoring, tip logic, round/game state
js/map.js                click-to-pin map rendering
js/app.js                wires screens + game together
assets/locations.json    screenshot -> true map coordinate data
assets/corners.json      named corner points used for the nearest-corners callout
assets/track-path.json   GPS-traced centerline + real meters-along-track, used for scoring
assets/screenshots/      placeholder images (swap with real captures)
assets/map-nurburgring.svg   GPS-traced Nordschleife map, start/finish lines baked in
tools/location-picker.html   click-to-place tool for building locations.json
```
