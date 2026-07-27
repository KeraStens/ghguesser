class MapView {
  constructor(containerEl) {
    this.container = containerEl;
    this.onGuess = null; // callback(x, y) in normalized 0-1 coords
    this.locked = false;
    this._pinLayer = null;
    this._buildBase();
  }

  _buildBase() {
    this.container.innerHTML = `
      <div class="map-frame">
        <img class="map-img" src="assets/map-placeholder.svg" alt="Expedition map" draggable="false" />
        <svg class="map-pin-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none"></svg>
      </div>
    `;
    this._pinLayer = this.container.querySelector('.map-pin-layer');
    const img = this.container.querySelector('.map-img');
    img.addEventListener('click', (e) => this._handleClick(e, img));
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
      this._drawPin(g.x * 1000, g.y * 1000, i + 1, 'guess');
    });
    if (truth) {
      this._drawPin(truth.x * 1000, truth.y * 1000, null, 'truth');
      // connective lines from each guess to truth
      guesses.forEach(g => {
        this._drawLine(g.x * 1000, g.y * 1000, truth.x * 1000, truth.y * 1000);
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
