import { JOURNEY_SCROLL_VIEWPORTS } from './scroll-journey.js';

const clamp = value => Math.max(0, Math.min(1, value));
const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
const WINDOWS = [
  [5.2, 5.65, 6.35, 6.8],
  [7.0, 7.45, 8.15, 8.6],
  [8.8, 9.25, 9.95, 10.4],
];

/** Reveal one tile at a time from the same reversible progress as the camera. */
export function createTunnelStory({ reducedMotion = false } = {}) {
  const layer = document.querySelector('.tunnel-story');
  const cards = [...layer.querySelectorAll('.tunnel-card')];
  const finale = document.querySelector('.journey-finale');
  const lastValues = cards.map(() => -1);
  const tilt = cards.map(() => ({ x: 0, y: 0, rendered: '' }));
  const sizes = cards.map(card => ({ width: card.offsetWidth, height: card.offsetHeight }));
  const pointer = { x: 0, y: 0, present: false };
  const observer = new ResizeObserver(entries => {
    for (const entry of entries) {
      const index = cards.indexOf(entry.target);
      const box = entry.borderBoxSize?.[0];
      sizes[index] = { width: box?.inlineSize ?? entry.target.offsetWidth,
        height: box?.blockSize ?? entry.target.offsetHeight };
    }
  });
  cards.forEach(card => observer.observe(card));
  window.addEventListener('pointermove', event => {
    if (event.pointerType === 'touch') { pointer.present = false; return; }
    pointer.x = event.clientX; pointer.y = event.clientY; pointer.present = true;
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointer.present = false; });
  window.addEventListener('blur', () => { pointer.present = false; });
  let lastFinale = -1;
  const state = { activeCard: 'none', finale: 0 };

  function update(progress, dt = 0, menuOpen = false) {
    const scroll = progress * JOURNEY_SCROLL_VIEWPORTS;
    let active = 'none';
    for (let index = 0; index < cards.length; index++) {
      const [enter, arrived, leave, gone] = WINDOWS[index];
      const reveal = smooth((scroll - enter) / (arrived - enter))
        * (1 - smooth((scroll - leave) / (gone - leave)));
      const value = Number(reveal.toFixed(3));
      if (value > .01) active = String(index + 1);
      const card = cards[index];
      if (value !== lastValues[index]) {
        card.style.opacity = String(value);
        card.style.visibility = value > 0 ? 'visible' : 'hidden';
        card.style.filter = reducedMotion || value === 1 ? 'none' : `blur(calc(${((1 - value) * 18).toFixed(2)} * var(--card-unit, var(--u))))`;
        card.style.setProperty('--reveal-y', reducedMotion ? '0px' : `calc(${((1 - value) * 38).toFixed(2)} * var(--card-unit, var(--u)))`);
        card.style.setProperty('--reveal-scale', reducedMotion ? '1' : String(.95 + value * .05));
        card.setAttribute('aria-hidden', String(value < .5));
        lastValues[index] = value;
      }
      const x = (pointer.x - window.innerWidth / 2) / Math.max(1, sizes[index].width / 2);
      const y = (pointer.y - window.innerHeight / 2) / Math.max(1, sizes[index].height / 2);
      const hover = !reducedMotion && !menuOpen && pointer.present && value > .5 && Math.abs(x) < 1.1 && Math.abs(y) < 1.1;
      const targetX = hover ? -Math.max(-1, Math.min(1, y)) * 7 : 0;
      const targetY = hover ? Math.max(-1, Math.min(1, x)) * 9 : 0;
      const response = 1 - Math.exp(-9 * dt);
      tilt[index].x += (targetX - tilt[index].x) * response;
      tilt[index].y += (targetY - tilt[index].y) * response;
      if (Math.abs(tilt[index].x) < .01) tilt[index].x = 0;
      if (Math.abs(tilt[index].y) < .01) tilt[index].y = 0;
      const angles = `${tilt[index].x.toFixed(2)},${tilt[index].y.toFixed(2)}`;
      if (angles !== tilt[index].rendered) {
        card.style.setProperty('--tilt-x', `${tilt[index].x.toFixed(2)}deg`);
        card.style.setProperty('--tilt-y', `${tilt[index].y.toFixed(2)}deg`);
        tilt[index].rendered = angles;
      }
    }
    if (active !== state.activeCard) layer.dataset.activeCard = active;
    state.activeCard = active;
    const finaleReveal = Number(smooth((scroll - 10.75) / 1.0).toFixed(3));
    if (finaleReveal !== lastFinale) {
      finale.style.opacity = String(finaleReveal);
      finale.style.visibility = finaleReveal > 0 ? 'visible' : 'hidden';
      finale.inert = finaleReveal < .95;
      finale.setAttribute('aria-hidden', String(finaleReveal < .5));
      lastFinale = finaleReveal;
    }
    state.finale = finaleReveal;
    return state;
  }

  update(0);
  return { update, state };
}
