class MapView {
  constructor(containerEl, opts = {}) {
    this.container = containerEl;
    this.onGuess = null; // callback(x, y) in normalized 0-1 coords
    this.locked = false;
    this.viewW = opts.viewW || 1600;
    this.viewH = opts.viewH || 1000;
    this.mapSrc = opts.mapSrc || 'assets/map-nurburgring.svg';
    this._pinLayer = null;
    this.labelsMode = 'auto'; // 'auto' (hover to reveal) | 'on' (always visible) | 'off' (hidden entirely)

    // Zoom/pan is implemented by changing the SVG viewBox (true vector re-render
    // at every level) rather than a CSS transform: scale(). A CSS transform just
    // stretches an already-rasterized composited layer, which is what caused the
    // blur/distortion when zoomed in — viewBox zoom has no such layer to stretch,
    // so it's crisp at any zoom level on every browser.
    this.zoom = 1;
    this.viewX = 0; // top-left of the current viewBox, in world units (0..viewW)
    this.viewY = 0; // top-left of the current viewBox, in world units (0..viewH)
    this.MIN_ZOOM = 1;
    this.MAX_ZOOM = 5;

    this._dragging = false;
    this._dragMoved = false;
    this._dragStart = { x: 0, y: 0 };
    this._viewStart = { x: 0, y: 0 };
    this._pinchStartDist = null;
    this._pinchStartZoom = 1;

    this._buildBase();
  }

  _buildBase() {
    this.container.innerHTML = `
      <div class="map-frame">
        <div class="map-zoom-inner">
          <div class="map-svg-holder"></div>
          <svg class="map-pin-layer" viewBox="0 0 ${this.viewW} ${this.viewH}" preserveAspectRatio="none"></svg>
        </div>
        <div class="map-controls">
          <button type="button" class="map-ctrl-btn map-labels-btn" title="Corner names: Auto (hover to reveal)" aria-label="Cycle corner name display">Aa</button>
          <button type="button" class="map-ctrl-btn map-zoom-out" title="Zoom out" aria-label="Zoom out">&minus;</button>
          <button type="button" class="map-ctrl-btn map-zoom-reset" title="Reset zoom" aria-label="Reset zoom">1:1</button>
          <button type="button" class="map-ctrl-btn map-zoom-in" title="Zoom in" aria-label="Zoom in">&plus;</button>
          <button type="button" class="map-ctrl-btn map-fullscreen-btn" title="Expand" aria-label="Expand map">&#10021;</button>
        </div>
        <button type="button" class="map-fullscreen-close" title="Close" aria-label="Close expanded map">&times;</button>
      </div>
    `;
    this.frameEl = this.container.querySelector('.map-frame');
    this.innerEl = this.container.querySelector('.map-zoom-inner');
    this._svgHolder = this.container.querySelector('.map-svg-holder');
    this._pinLayer = this.container.querySelector('.map-pin-layer');
    this._loadMapSvg();

    this.frameEl.addEventListener('pointerdown', (e) => this._onPointerDown(e));
    window.addEventListener('pointermove', (e) => this._onPointerMove(e));
    window.addEventListener('pointerup', (e) => this._onPointerUp(e));
    this.frameEl.addEventListener('wheel', (e) => this._onWheel(e), { passive: false });
    this.frameEl.addEventListener('touchstart', (e) => this._onTouchStart(e), { passive: false });
    this.frameEl.addEventListener('touchmove', (e) => this._onTouchMove(e), { passive: false });
    this.frameEl.addEventListener('touchend', (e) => this._onTouchEnd(e), { passive: false });
    this.frameEl.addEventListener('dblclick', (e) => this._onDblClick(e));

    this.container.querySelector('.map-zoom-in').addEventListener('click', () => this._stepZoom(1.5));
    this.container.querySelector('.map-zoom-out').addEventListener('click', () => this._stepZoom(1 / 1.5));
    this.container.querySelector('.map-zoom-reset').addEventListener('click', () => this.resetZoom());
    this.container.querySelector('.map-fullscreen-btn').addEventListener('click', () => this.setFullscreen(true));
    this.container.querySelector('.map-labels-btn').addEventListener('click', () => this._cycleLabelsMode());
    this.container.querySelector('.map-fullscreen-close').addEventListener('click', () => this.setFullscreen(false));

    this._applyViewBox();
    this._applyLabelsMode();
  }

  // -------------------------------------------------------------------------
  // CORNER NAME DISPLAY — cycles Auto (dots visible, hover reveals the name)
  // -> On (everything always visible) -> Off (nothing shown, not even dots)
  // -------------------------------------------------------------------------
  _cycleLabelsMode() {
    const order = ['auto', 'on', 'off'];
    const idx = order.indexOf(this.labelsMode);
    this.labelsMode = order[(idx + 1) % order.length];
    this._applyLabelsMode();
  }

  _applyLabelsMode() {
    this.container.classList.remove('map-labels-auto', 'map-labels-on', 'map-labels-off');
    this.container.classList.add(`map-labels-${this.labelsMode}`);
    const btn = this.container.querySelector('.map-labels-btn');
    if (!btn) return;
    const titles = {
      auto: 'Corner names: Auto (hover to reveal)',
      on: 'Corner names: On (always visible)',
      off: 'Corner names: Off',
    };
    btn.title = titles[this.labelsMode];
    btn.dataset.mode = this.labelsMode;
  }

  // Fetches the map SVG and injects it inline (instead of an <img src="...svg">)
  // so it always renders as real vector geometry rather than a rasterized image.
  async _loadMapSvg() {
    try {
      const res = await fetch(this.mapSrc);
      const svgText = await res.text();
      this._svgHolder.innerHTML = svgText;
      const svgEl = this._svgHolder.querySelector('svg');
      if (svgEl) {
        svgEl.classList.add('map-img');
        svgEl.removeAttribute('width');
        svgEl.removeAttribute('height');
        // mirrors the old object-fit:cover behavior (fill + crop, no letterboxing)
        svgEl.setAttribute('preserveAspectRatio', 'xMidYMid slice');
      }
      this._applyViewBox(); // set the initial viewBox now that the <svg> exists
    } catch (err) {
      // fetch() needs a server (file:// won't work) — fall back to a plain <img>
      // so the map still shows something even when opened directly from disk.
      // (Zoom will use the old CSS-transform path in this fallback case, since
      // there's no live SVG element to set a viewBox on.)
      this._svgHolder.innerHTML = `<img class="map-img" src="${this.mapSrc}" alt="Nordschleife track map" draggable="false" />`;
      this._imgFallback = true;
      this._applyViewBox();
    }
  }

  // -------------------------------------------------------------------------
  // ZOOM / PAN — implemented as SVG viewBox changes, not CSS transforms, so
  // the map is always rendered fresh as vectors at the current zoom level.
  // -------------------------------------------------------------------------
  _currentSize() {
    return { w: this.viewW / this.zoom, h: this.viewH / this.zoom };
  }

  _applyViewBox() {
    const { w, h } = this._currentSize();
    const vb = `${this.viewX.toFixed(2)} ${this.viewY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)}`;
    const mapSvg = this._svgHolder.querySelector('svg');
    if (mapSvg) mapSvg.setAttribute('viewBox', vb);
    this._pinLayer.setAttribute('viewBox', vb);

    // Fallback path only (no live <svg> to re-viewBox, e.g. opened via file://):
    // fall back to the old CSS transform so zoom still does *something*.
    if (this._imgFallback) {
      const scale = this.zoom;
      const tx = -this.viewX * scale;
      const ty = -this.viewY * scale;
      this.innerEl.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    } else {
      this.innerEl.style.transform = 'none';
    }

    this.container.classList.toggle('map-zoomed', this.zoom > 1.001);
  }

  _clampView() {
    const { w, h } = this._currentSize();
    const maxX = Math.max(0, this.viewW - w);
    const maxY = Math.max(0, this.viewH - h);
    this.viewX = Math.max(0, Math.min(maxX, this.viewX));
    this.viewY = Math.max(0, Math.min(maxY, this.viewY));
  }

  // cx, cy: focal point in screen px, relative to the frame
  _zoomAt(cx, cy, newZoom) {
    newZoom = Math.max(this.MIN_ZOOM, Math.min(this.MAX_ZOOM, newZoom));
    const rect = this.frameEl.getBoundingClientRect();
    const cur = this._currentSize();
    // world point currently under the focal point, at the CURRENT zoom
    const wx = this.viewX + (cx / rect.width) * cur.w;
    const wy = this.viewY + (cy / rect.height) * cur.h;
    this.zoom = newZoom;
    const next = this._currentSize();
    // re-solve viewX/viewY so that same world point stays under the focal point
    this.viewX = wx - (cx / rect.width) * next.w;
    this.viewY = wy - (cy / rect.height) * next.h;
    this._clampView();
    this._applyViewBox();
  }

  _stepZoom(factor) {
    const rect = this.frameEl.getBoundingClientRect();
    this._zoomAt(rect.width / 2, rect.height / 2, this.zoom * factor);
  }

  resetZoom() {
    this.zoom = 1;
    this.viewX = 0;
    this.viewY = 0;
    this._applyViewBox();
  }

  _onWheel(e) {
    e.preventDefault();
    const rect = this.frameEl.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    this._zoomAt(cx, cy, this.zoom * factor);
  }

  _onDblClick(e) {
    const rect = this.frameEl.getBoundingClientRect();
    const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
    this._zoomAt(cx, cy, this.zoom > 1.5 ? 1 : this.zoom * 2.2);
  }

  _onPointerDown(e) {
    if (e.pointerType === 'touch') return; // touch handled separately (pinch/pan/tap)
    if (e.target.closest('.map-controls, .map-fullscreen-close')) return; // don't guess when clicking UI chrome
    this._dragging = true;
    this._dragMoved = false;
    this._dragStart = { x: e.clientX, y: e.clientY };
    this._viewStart = { x: this.viewX, y: this.viewY };
  }

  _onPointerMove(e) {
    if (!this._dragging || e.pointerType === 'touch') return;
    const dx = e.clientX - this._dragStart.x;
    const dy = e.clientY - this._dragStart.y;
    if (Math.hypot(dx, dy) > 4) this._dragMoved = true;
    if (this.zoom > 1 && this._dragMoved) {
      const rect = this.frameEl.getBoundingClientRect();
      const { w, h } = this._currentSize();
      this.viewX = this._viewStart.x - dx * (w / rect.width);
      this.viewY = this._viewStart.y - dy * (h / rect.height);
      this._clampView();
      this._applyViewBox();
    }
  }

  _onPointerUp(e) {
    if (!this._dragging || e.pointerType === 'touch') return;
    this._dragging = false;
    if (!this._dragMoved) {
      this._handleClickAt(e.clientX, e.clientY);
    }
  }

  _onTouchStart(e) {
    if (e.target.closest('.map-controls, .map-fullscreen-close')) return; // don't guess when tapping UI chrome
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      this._pinchStartDist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      this._pinchStartZoom = this.zoom;
      this._dragging = false;
    } else if (e.touches.length === 1) {
      this._dragging = true;
      this._dragMoved = false;
      this._dragStart = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      this._viewStart = { x: this.viewX, y: this.viewY };
    }
  }

  _onTouchMove(e) {
    if (e.touches.length === 2 && this._pinchStartDist) {
      e.preventDefault();
      const [a, b] = e.touches;
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const rect = this.frameEl.getBoundingClientRect();
      const midX = (a.clientX + b.clientX) / 2 - rect.left;
      const midY = (a.clientY + b.clientY) / 2 - rect.top;
      this._zoomAt(midX, midY, this._pinchStartZoom * (dist / this._pinchStartDist));
    } else if (e.touches.length === 1 && this._dragging) {
      const dx = e.touches[0].clientX - this._dragStart.x;
      const dy = e.touches[0].clientY - this._dragStart.y;
      if (Math.hypot(dx, dy) > 4) this._dragMoved = true;
      if (this.zoom > 1 && this._dragMoved) {
        e.preventDefault();
        const rect = this.frameEl.getBoundingClientRect();
        const { w, h } = this._currentSize();
        this.viewX = this._viewStart.x - dx * (w / rect.width);
        this.viewY = this._viewStart.y - dy * (h / rect.height);
        this._clampView();
        this._applyViewBox();
      }
    }
  }

  _onTouchEnd(e) {
    this._pinchStartDist = null;
    if (this._dragging && !this._dragMoved) {
      const t = e.changedTouches[0];
      if (t) this._handleClickAt(t.clientX, t.clientY);
    }
    this._dragging = false;
  }

  // -------------------------------------------------------------------------
  // FULLSCREEN
  // -------------------------------------------------------------------------
  setFullscreen(on) {
    this.container.classList.toggle('mapview-fullscreen', on);
    document.body.classList.toggle('no-scroll', on);
    this.resetZoom(); // frame's pixel size just changed — old zoom/view values no longer apply
    if (this._escHandler) window.removeEventListener('keydown', this._escHandler);
    if (on) {
      this._escHandler = (e) => { if (e.key === 'Escape') this.setFullscreen(false); };
      window.addEventListener('keydown', this._escHandler);
    }
  }

  // -------------------------------------------------------------------------
  // GUESSING
  // -------------------------------------------------------------------------
  _handleClickAt(clientX, clientY) {
    if (this.locked) return;
    const rect = this.frameEl.getBoundingClientRect();
    const clickX = clientX - rect.left;
    const clickY = clientY - rect.top;
    const { w, h } = this._currentSize();
    const worldX = this.viewX + (clickX / rect.width) * w;
    const worldY = this.viewY + (clickY / rect.height) * h;
    const x = worldX / this.viewW;
    const y = worldY / this.viewH;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (typeof this.onGuess === 'function') this.onGuess(x, y);
  }

  setLocked(locked) {
    this.locked = locked;
    this.container.classList.toggle('map-locked', locked);
  }

  clearPins() {
    this._pinLayer.innerHTML = '';
  }

  // guesses: [{x,y}], truth: {x,y} or null (hidden until round ends)
  render(guesses, truth) {
    this.clearPins();
    guesses.forEach((g, i) => {
      this._drawPin(g.x * this.viewW, g.y * this.viewH, i + 1, 'guess');
    });
    if (truth) {
      this._drawPin(truth.x * this.viewW, truth.y * this.viewH, null, 'truth');
      guesses.forEach(g => {
        this._drawTrackTrace(g.x, g.y, truth.x, truth.y);
      });
    }
  }

  _drawLine(x1, y1, x2, y2) {
    const ns = 'http://www.w3.org/2000/svg';
    const line = document.createElementNS(ns, 'line');
    line.setAttribute('x1', x1); line.setAttribute('y1', y1);
    line.setAttribute('x2', x2); line.setAttribute('y2', y2);
    line.setAttribute('class', 'pin-connector');
    this._pinLayer.appendChild(line);
  }

  // Draws the guess→truth connector traced along the real track centerline
  // (shortest arc around the closed loop) instead of a straight "airline".
  // Falls back to a straight line if track-distance data isn't available.
  _drawTrackTrace(gx, gy, tx, ty) {
    if (typeof TrackDistance === 'undefined' || !TrackDistance.ready) {
      this._drawLine(gx * this.viewW, gy * this.viewH, tx * this.viewW, ty * this.viewH);
      return;
    }
    const pts = TrackDistance.points;
    const total = TrackDistance.totalMeters;
    const mG = TrackDistance.projectMeters(gx, gy);
    const mT = TrackDistance.projectMeters(tx, ty);

    const idxFor = (m) => {
      let lo = 0, hi = pts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (pts[mid].m < m) lo = mid + 1; else hi = mid;
      }
      return lo;
    };
    const iG = idxFor(mG), iT = idxFor(mT);

    const forwardDist = (mT - mG + total) % total;
    const backwardDist = (mG - mT + total) % total;

    const seq = [];
    let i = iG;
    seq.push(i);
    if (forwardDist <= backwardDist) {
      while (i !== iT) { i = (i + 1) % pts.length; seq.push(i); }
    } else {
      while (i !== iT) { i = (i - 1 + pts.length) % pts.length; seq.push(i); }
    }

    const guessPx = [gx * this.viewW, gy * this.viewH];
    const truthPx = [tx * this.viewW, ty * this.viewH];
    const trackPx = seq.map(idx => [pts[idx].x * this.viewW, pts[idx].y * this.viewH]);
    const fullPoints = [guessPx, ...trackPx, truthPx];

    const ns = 'http://www.w3.org/2000/svg';
    const poly = document.createElementNS(ns, 'polyline');
    poly.setAttribute('points', fullPoints.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' '));
    poly.setAttribute('fill', 'none');
    poly.setAttribute('class', 'pin-connector');
    this._pinLayer.appendChild(poly);
  }

  _drawPin(x, y, label, kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const g = document.createElementNS(ns, 'g');
    g.setAttribute('transform', `translate(${x},${y})`);
    g.setAttribute('class', `pin pin-${kind}`);

    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('r', kind === 'truth' ? 16 : 14);
    g.appendChild(circle);

    if (label) {
      const text = document.createElementNS(ns, 'text');
      text.textContent = label;
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dy', '5');
      g.appendChild(text);
    } else {
      const mark = document.createElementNS(ns, 'text');
      mark.textContent = '✕';
      mark.setAttribute('text-anchor', 'middle');
      mark.setAttribute('dy', '5');
      g.appendChild(mark);
    }
    this._pinLayer.appendChild(g);
  }
}
