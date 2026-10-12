import assert from 'node:assert/strict';
import {
  createJourneyPose,
  createScrollJourney,
  getJourneyPose,
} from '../src/scroll-journey.js';

const EPSILON = 1e-10;
const nearlyEqual = (actual, expected, message) => {
  assert.ok(Math.abs(actual - expected) <= EPSILON, `${message}: ${actual} vs ${expected}`);
};
const vectorEqual = (actual, expected, message) => {
  actual.toArray().forEach((value, index) => nearlyEqual(value, expected[index], `${message}[${index}]`));
};
const snapshot = pose => ({
  position: pose.position.toArray(), target: pose.target.toArray(),
  opening: pose.opening, openingDistance: pose.openingDistance,
  depthProgress: pose.depthProgress, phase: pose.phase,
});

const start = getJourneyPose(0);
assert.equal(start.opening, 0, 'The meadow starts with the hatch closed');
assert.equal(start.openingDistance, 0);
assert.equal(start.depthProgress, 0);
vectorEqual(start.position, [0, 3.4, 8.9], 'Initial meadow camera');
vectorEqual(start.target, [0, 2.25, -2.5], 'Initial meadow view');

const end = getJourneyPose(1);
assert.equal(end.opening, 1, 'The hatch remains fully open underground');
assert.equal(end.openingDistance, 3.3, 'Each leaf reaches the required shaft clearance');
assert.equal(end.depthProgress, 1);
vectorEqual(end.position, [0, -11.4, 1.8], 'Final underground camera');
vectorEqual(end.target, [0, -11.3, -20], 'Final corridor view');

const sampledPose = createJourneyPose();
let previousY = Infinity, previousOpening = -1, previousDepth = -1;
let firstGroundCrossing = null, maxPitch = 0;
for (let index = 0; index <= 10000; index++) {
  const progress = index / 10000;
  assert.equal(getJourneyPose(progress, sampledPose), sampledPose, 'Sampling reuses its output object');
  const { position, target, opening, openingDistance, depthProgress } = sampledPose;
  assert.ok(position.toArray().concat(target.toArray(), opening, openingDistance, depthProgress).every(Number.isFinite),
    `The camera and hatch stay finite at progress ${progress}`);
  assert.ok(position.y <= previousY + EPSILON, `The descent must not bounce upward at ${progress}`);
  assert.ok(opening >= previousOpening - EPSILON, `Forward scroll must not close the hatch at ${progress}`);
  assert.ok(depthProgress >= previousDepth - EPSILON, `Underground depth must not reverse at ${progress}`);
  assert.ok(opening >= 0 && opening <= 1 && openingDistance >= 0 && openingDistance <= 3.3);
  assert.ok(depthProgress >= 0 && depthProgress <= 1);

  // The shaft is about 5.6m wide. Keep substantial lateral camera clearance.
  assert.ok(Math.abs(position.x) < 2.3, `The camera must remain inside the central shaft at ${progress}`);
  if (position.y <= .6) assert.equal(opening, 1, 'The slab must clear before the camera reaches its surface');
  if (position.y <= 0) {
    firstGroundCrossing ??= progress;
    assert.ok(position.z > -5.15 && position.z < 10.45, 'The descent stays inside the shaft longitudinal bounds');
    assert.ok(position.y > -13.8, 'The underground camera stays above the floor');
  }

  const forwardZ = position.z - target.z;
  const horizontal = Math.hypot(target.x - position.x, target.z - position.z);
  assert.ok(forwardZ > .5, `The view must continue toward the corridor at ${progress}`);
  assert.ok(horizontal > .5, `The view must not become vertical or reverse its roll at ${progress}`);
  const pitch = Math.atan2(Math.abs(target.y - position.y), horizontal);
  assert.ok(pitch < Math.PI * .43, `The camera must avoid the vertical lookAt singularity at ${progress}`);
  maxPitch = Math.max(maxPitch, pitch);
  previousY = position.y;
  previousOpening = opening;
  previousDepth = depthProgress;
}
assert.notEqual(firstGroundCrossing, null, 'The journey reaches the underground scene');

// A backward scroll must retrace the same observable camera/hatch poses.
const checkpoints = [0, .05, .10, .20, .28, .42, .50, .65, .85, 1];
const forwardPoses = checkpoints.map(progress => snapshot(getJourneyPose(progress, sampledPose)));
for (let index = checkpoints.length - 1; index >= 0; index--) {
  const pose = getJourneyPose(checkpoints[index], sampledPose);
  const expected = forwardPoses[index];
  vectorEqual(pose.position, expected.position, 'Reversed camera path');
  vectorEqual(pose.target, expected.target, 'Reversed view path');
  nearlyEqual(pose.opening, expected.opening, 'Reversed hatch opening');
  nearlyEqual(pose.depthProgress, expected.depthProgress, 'Reversed underground depth');
  assert.equal(pose.phase, expected.phase);
}

let scrollY = 0;
const readScrollY = () => scrollY;
const readViewportHeight = () => 1000;
const at30Fps = createScrollJourney({ heightMultiplier: 5, readScrollY, readViewportHeight });
const at60Fps = createScrollJourney({ heightMultiplier: 5, readScrollY, readViewportHeight });
const reusedPose = at60Fps.pose, reusedPosition = reusedPose.position, reusedTarget = reusedPose.target;
scrollY = 5000;
for (let frame = 0; frame < 30; frame++) at30Fps.update(1 / 30);
for (let frame = 0; frame < 60; frame++) at60Fps.update(1 / 60);
nearlyEqual(at30Fps.progress, at60Fps.progress, 'Equal elapsed time gives equal scroll damping at 30/60fps');
assert.ok(at60Fps.progress > .9 && at60Fps.progress < 1, 'Damping approaches a requested jump smoothly');
assert.equal(at60Fps.pose, reusedPose);
assert.equal(at60Fps.pose.position, reusedPosition);
assert.equal(at60Fps.pose.target, reusedTarget);

scrollY = 0;
let previousProgress = at60Fps.progress;
for (let frame = 0; frame < 120; frame++) {
  const pose = at60Fps.update(1 / 60);
  assert.ok(pose.progress <= previousProgress + EPSILON, 'Reverse damping continuously returns toward the meadow');
  previousProgress = pose.progress;
}
assert.equal(at60Fps.progress, 0, 'Reverse scroll settles exactly at the closed start');
assert.equal(at60Fps.pose.openingDistance, 0);

const reduced = createScrollJourney({ heightMultiplier: 5, reducedMotion: true, readScrollY, readViewportHeight });
scrollY = 2500;
assert.equal(reduced.update(0).progress, .5, 'Reduced motion still follows native scroll immediately');
scrollY = 7000;
assert.equal(reduced.update(0).progress, 1, 'Overscroll clamps to the completed underground pose');
scrollY = -80;
assert.equal(reduced.update(0).progress, 0, 'Negative overscroll clamps to the closed meadow');

console.log(`Journey checks passed: ground crossing ${firstGroundCrossing.toFixed(4)}, maximum pitch ${(maxPitch * 180 / Math.PI).toFixed(2)} degrees; reversible poses, 30/60fps damping and reduced motion.`);
