class MapView {
  constructor(containerEl, opts = {}) {
    this.container = containerEl;
    this.onGuess = null; // callback(x, y) in normalized 0-1 coords
    this.locked = false;
    this.viewW = opts.viewW || 1600;
    this.viewH = opts.viewH || 1000;
    this.mapSrc = opts.mapSrc || 'assets/map-nurburgring.svg';
    this._pinLayer = null;
    this._staticLayer = null;
    this._buildBase();
  }

  _buildBase() {
    this.container.innerHTML = `
      <div class="map-frame">
        <img class="map-img" src="${this.mapSrc}" alt="Nordschleife track map" draggable="false" />
        <svg class="map-static-layer" viewBox="0 0 ${this.viewW} ${this.viewH}" preserveAspectRatio="none"></svg>
        <svg class="map-pin-layer" viewBox="0 0 ${this.viewW} ${this.viewH}" preserveAspectRatio="none"></svg>
      </div>
    `;
    this._staticLayer = this.container.querySelector('.map-static-layer');
    this._pinLayer = this.container.querySelector('.map-pin-layer');
    const img = this.container.querySelector('.map-img');
    img.addEventListener('click', (e) => this._handleClick(e, img));
  }

  // draws the start/finish lines once — call after construction if you have track-config.json loaded
  renderTrackConfig(config) {
    if (!config || !this._staticLayer) return;
    this._staticLayer.innerHTML = '';
    if (config.startLine) this._drawTrackLine(config.startLine, 'start');
    if (config.finishLine) this._drawTrackLine(config.finishLine, 'finish');
  }

  _drawTrackLine(line, kind) {
    const ns = 'http://www.w3.org/2000/svg';
    const x1 = line.x1 * this.viewW, y1 = line.y1 * this.viewH;
    const x2 = line.x2 * this.viewW, y2 = line.y2 * this.viewH;

    const el = document.createElementNS(ns, 'line');
    el.setAttribute('x1', x1); el.setAttribute('y1', y1);
    el.setAttribute('x2', x2); el.setAttribute('y2', y2);
    el.setAttribute('class', `track-line track-line-${kind}`);
    this._staticLayer.appendChild(el);

    const label = document.createElementNS(ns, 'text');
    label.textContent = kind === 'start' ? 'START' : 'FINISH';
    label.setAttribute('x', (x1 + x2) / 2);
    label.setAttribute('y', Math.min(y1, y2) - 10);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', `track-line-label track-line-label-${kind}`);
    this._staticLayer.appendChild(label);
  }

  _handleClick(e, img) {
    if (this.locked) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
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
      // connective lines from each guess to truth
      guesses.forEach(g => {
        this._drawLine(g.x * this.viewW, g.y * this.viewH, truth.x * this.viewW, truth.y * this.viewH);
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
