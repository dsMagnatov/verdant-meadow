import * as THREE from 'three';

export const JOURNEY_OPEN_DISTANCE = 3.3;
export const DESCENT_SCROLL_VIEWPORTS = 5;
export const JOURNEY_SCROLL_VIEWPORTS = 12;
export const DESCENT_END = DESCENT_SCROLL_VIEWPORTS / JOURNEY_SCROLL_VIEWPORTS;

// The camera stays above the stone until both leaves have reached full clearance.
// Keeping the target ahead in -Z avoids the vertical lookAt singularity as the
// descent turns into a view along the underground corridor.
const DESCENT_KEYFRAMES = [
  { p: 0, position: [0, 3.4, 8.9], target: [0, 2.25, -2.5] },
  { p: .10, position: [0, 3.4, 8.9], target: [0, 2.25, -2.5] },
  { p: .28, position: [0, 3.0, 5.5], target: [0, -.6, 2.2] },
  { p: .42, position: [0, 1.1, 3.1], target: [0, -3.2, .4] },
  { p: .54, position: [0, -2.3, 2.6], target: [0, -5.3, -3.1] },
  { p: .70, position: [0, -6.2, 2.25], target: [0, -7.6, -10] },
  { p: 1, position: [0, -11.4, 1.8], target: [0, -11.3, -20] },
];
const KEYFRAMES = [
  ...DESCENT_KEYFRAMES.map(key => ({ ...key, p: key.p * DESCENT_END })),
  { p: 7 / 12, position: [0, -11.45, -7.8], target: [0, -11.35, -20.5] },
  { p: 9 / 12, position: [0, -11.55, -17.4], target: [0, -11.45, -30] },
  { p: 11 / 12, position: [0, -11.65, -28.8], target: [0, -11.55, -40] },
  { p: 1, position: [0, -11.65, -30], target: [0, -11.55, -42] },
];

function clampProgress(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}

function smootherstep(value) {
  const t = clampProgress(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function buildAxis(property, axis) {
  const values = KEYFRAMES.map(key => key[property][axis]);
  const tangents = new Float64Array(KEYFRAMES.length);
  // Monotone cubic Hermite tangents preserve each coordinate's local bounds.
  // Unlike easing every segment separately, these do not pause at every key.
  for (let i = 1; i < KEYFRAMES.length - 1; i++) {
    const before = KEYFRAMES[i].p - KEYFRAMES[i - 1].p;
    const after = KEYFRAMES[i + 1].p - KEYFRAMES[i].p;
    const left = (values[i] - values[i - 1]) / before;
    const right = (values[i + 1] - values[i]) / after;
    if (left * right <= 0) continue;
    const weightLeft = 2 * after + before;
    const weightRight = after + 2 * before;
    tangents[i] = (weightLeft + weightRight) / (weightLeft / left + weightRight / right);
  }
  // Starting and ending at rest also keeps a clamped scroll boundary smooth.
  return { values, tangents };
}

const positionAxes = [0, 1, 2].map(axis => buildAxis('position', axis));
const targetAxes = [0, 1, 2].map(axis => buildAxis('target', axis));

function sampleAxis(axis, segment, t, width) {
  const t2 = t * t, t3 = t2 * t;
  return (2 * t3 - 3 * t2 + 1) * axis.values[segment]
    + (t3 - 2 * t2 + t) * width * axis.tangents[segment]
    + (-2 * t3 + 3 * t2) * axis.values[segment + 1]
    + (t3 - t2) * width * axis.tangents[segment + 1];
}

/** Allocate once, then pass this object to getJourneyPose for frame sampling. */
export function createJourneyPose() {
  return {
    position: new THREE.Vector3(0, 3.4, 8.9),
    target: new THREE.Vector3(0, 2.25, -2.5),
    progress: 0, rawProgress: 0, descentProgress: 0,
    opening: 0, openingDistance: 0, depthProgress: 0, phase: 'meadow',
  };
}

/** Deterministic, reversible sampler. opening is normalized; distance is meters. */
export function getJourneyPose(progress, pose = createJourneyPose()) {
  const p = clampProgress(progress);
  let segment = 0;
  while (segment < KEYFRAMES.length - 2 && p > KEYFRAMES[segment + 1].p) segment++;
  const width = KEYFRAMES[segment + 1].p - KEYFRAMES[segment].p;
  const t = (p - KEYFRAMES[segment].p) / width;
  pose.position.set(
    sampleAxis(positionAxes[0], segment, t, width),
    sampleAxis(positionAxes[1], segment, t, width),
    sampleAxis(positionAxes[2], segment, t, width),
  );
  pose.target.set(
    sampleAxis(targetAxes[0], segment, t, width),
    sampleAxis(targetAxes[1], segment, t, width),
    sampleAxis(targetAxes[2], segment, t, width),
  );
  pose.progress = pose.rawProgress = p;
  pose.descentProgress = clampProgress(p / DESCENT_END);
  pose.opening = smootherstep(pose.descentProgress / .28);
  pose.openingDistance = pose.opening * JOURNEY_OPEN_DISTANCE;
  pose.depthProgress = THREE.MathUtils.clamp(-pose.position.y / 11.4, 0, 1);
  pose.phase = p === 0 ? 'meadow'
    : pose.descentProgress < .28 ? 'opening'
      : pose.position.y > .4 ? 'approach'
        : pose.position.y > -6.2 ? 'descent'
          : p >= 11 / 12 ? 'finale' : 'underground';
  return pose;
}

const browserScrollY = () => typeof window === 'undefined' ? 0 : window.scrollY;
const browserViewportHeight = () => typeof window === 'undefined' ? 1 : window.innerHeight;

/**
 * A 13-viewport document supplies 5 viewports of descent, then the corridor.
 * Call update(dtSeconds) once per frame; the returned pose and
 * its Vector3s are reused. Resize reads the new viewport height automatically.
 * Reduced motion removes scroll damping while preserving the requested pose.
 */
export function createScrollJourney({
  heightMultiplier = JOURNEY_SCROLL_VIEWPORTS,
  reducedMotion: prefersReducedMotion = false,
  response = 10,
  scrollStart = 0,
  readScrollY = browserScrollY,
  readViewportHeight = browserViewportHeight,
  initialProgress,
} = {}) {
  const viewports = Number.isFinite(heightMultiplier) && heightMultiplier > 0 ? heightMultiplier : JOURNEY_SCROLL_VIEWPORTS;
  const damping = Number.isFinite(response) && response > 0 ? response : 10;
  const start = Number.isFinite(scrollStart) ? scrollStart : 0;
  const readProgress = () => {
    const viewport = readViewportHeight();
    const height = Number.isFinite(viewport) && viewport > 0 ? viewport : 1;
    return clampProgress((readScrollY() - start) / (viewports * height));
  };
  let targetProgress = readProgress();
  let progress = initialProgress === undefined ? targetProgress : clampProgress(initialProgress);
  const pose = getJourneyPose(progress, createJourneyPose());
  pose.rawProgress = targetProgress;

  return {
    pose,
    get progress() { return progress; },
    get targetProgress() { return targetProgress; },
    update(dtSeconds, reducedMotion = prefersReducedMotion) {
      targetProgress = readProgress();
      if (reducedMotion) progress = targetProgress;
      else {
        const dt = Number.isFinite(dtSeconds) ? THREE.MathUtils.clamp(dtSeconds, 0, .1) : 0;
        progress += (targetProgress - progress) * -Math.expm1(-damping * dt);
        if (Math.abs(targetProgress - progress) < .00001) progress = targetProgress;
      }
      getJourneyPose(progress, pose);
      pose.rawProgress = targetProgress;
      return pose;
    },
    reset(nextProgress = readProgress()) {
      progress = targetProgress = clampProgress(nextProgress);
      return getJourneyPose(progress, pose);
    },
  };
}
