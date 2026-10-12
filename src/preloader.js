const WEIGHTS = { boot: .02, engine: .03, fonts: .03, assets: .78, geometry: .06, shaders: .04, frame: .04 };

function createPreloader() {
  const layer = document.querySelector('#preloader');
  const experience = document.querySelector('#experience');
  const bar = layer.querySelector('[role="progressbar"]');
  const fill = layer.querySelector('.preloader-fill');
  const status = layer.querySelector('[role="status"]');
  const digits = [...layer.querySelectorAll('.preloader-strip')];
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const stages = Object.fromEntries(Object.keys(WEIGHTS).map(key => [key, 0]));
  const assets = [];
  let assetCount = 0, target = 0, displayed = 0, lastPercent = -1;
  let lastTime = performance.now(), landedAt = null, state = 'loading', raf;

  // Repeated zeroes keep every carry moving upward: 009 → 010 → … → 100.
  for (const [index, strip] of digits.entries()) {
    const rows = index === 0 ? 2 : index === 1 ? 11 : 101;
    strip.replaceChildren(...Array.from({ length: rows }, (_, value) => {
      const row = document.createElement('span');
      row.textContent = String(value % 10);
      return row;
    }));
  }

  function refreshTarget() {
    stages.assets = assetCount ? Math.min(1, assets.reduce((sum, value) => sum + value, 0) / assetCount) : 0;
    const next = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + stages[key] * weight, 0);
    target = Math.max(target, Math.min(1, next));
    layer.dataset.target = String(Math.round(target * 100));
  }

  function mark(stage) {
    if (state !== 'loading' || !(stage in stages) || stage === 'assets') return;
    stages[stage] = 1;
    refreshTarget();
  }

  function track(load) {
    const index = assets.push(0) - 1;
    const progress = event => {
      if (state !== 'loading' || !event.total) return;
      // The last 10% of each resource waits for its image/model decoder.
      assets[index] = Math.max(assets[index], Math.min(.9, event.loaded / event.total * .9));
      refreshTarget();
    };
    return load(progress).then(result => {
      assets[index] = 1;
      refreshTarget();
      return result;
    });
  }

  function finish() {
    if (state !== 'revealing') return;
    state = 'complete';
    document.documentElement.classList.remove('is-loading');
    document.documentElement.dataset.preloader = 'complete';
    experience.style.removeProperty('visibility');
    experience.inert = false;
    experience.removeAttribute('aria-hidden');
    experience.setAttribute('aria-busy', 'false');
    layer.remove();
  }

  function reveal() {
    state = 'revealing';
    layer.dataset.state = state;
    experience.style.visibility = 'visible';
    layer.classList.add('is-exiting');
    layer.addEventListener('transitionend', event => {
      if (event.target === layer && event.propertyName === 'opacity') finish();
    });
    window.setTimeout(finish, motion.matches ? 0 : 900);
  }

  function tick(now) {
    if (state !== 'loading') return;
    const dt = Math.min((now - lastTime) / 1000, .1);
    lastTime = now;
    displayed = motion.matches ? target : displayed + (target - displayed) * -Math.expm1(-7 * dt);
    const ready = Object.values(stages).every(value => value === 1);
    const percent = ready && displayed >= .997 ? 100 : Math.min(99, Math.floor(displayed * 100));
    if (percent !== lastPercent) {
      digits.forEach((strip, index) => strip.style.setProperty('--digit-step', String(Math.floor(percent / 10 ** (2 - index)))));
      bar.setAttribute('aria-valuenow', String(percent));
      layer.dataset.progress = String(percent);
      lastPercent = percent;
    }
    fill.style.transform = `scaleX(${percent === 100 ? 1 : displayed.toFixed(4)})`;
    if (percent === 100) {
      landedAt ??= now;
      status.textContent = 'The scene is ready.';
      if (now - landedAt >= (motion.matches ? 120 : 560)) { reveal(); return; }
    }
    raf = requestAnimationFrame(tick);
  }

  function fail() {
    if (state !== 'loading') return;
    state = 'failed';
    cancelAnimationFrame(raf);
    layer.dataset.state = state;
    document.documentElement.dataset.preloader = state;
    layer.classList.add('has-error');
    status.textContent = 'The scene could not load. Please try again.';
    const error = layer.querySelector('.preloader-error');
    error.hidden = false;
    error.querySelector('button').focus({ preventScroll: true });
  }

  layer.querySelector('.preloader-retry').addEventListener('click', () => window.location.reload());
  window.addEventListener('error', () => { if (state === 'loading') fail(); });
  document.documentElement.dataset.preloader = state;
  raf = requestAnimationFrame(tick);
  return { mark, track, fail, beginAssets(count) { assetCount = count; refreshTarget(); },
    get blocking() { return state !== 'complete'; }, get failed() { return state === 'failed'; } };
}

export const preloader = createPreloader();
