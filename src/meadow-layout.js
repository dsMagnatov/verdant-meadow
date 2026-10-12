import * as THREE from 'three';
import { noise2 } from './math.js';

export const LEFT_GRASS_BOUNDS = [-6.8, -1.8, -3.1, 9.5];
export const RIGHT_GRASS_BOUNDS = [1.8, 6.8, -3.1, 9.5];

// A shared, softly irregular clearing keeps the foreground grass and fern
// thinning aligned, without changing the rest of the meadow's composition.
export function leftGrassClearing(x, z) {
  const radius = Math.hypot((x + 4.3) / 2.45, (z - 3.2) / 6.2);
  const edge = (noise2(x * 1.1 + 6.7, z * .73 + 21.3) - .5) * .16;
  return 1 - THREE.MathUtils.smoothstep(radius + edge, .70, 1.02);
}

export function rightGrassClearing(x, z) {
  const radius = Math.hypot((x - 4.3) / 2.45, (z - 3.2) / 6.2);
  const edge = (noise2(x * 1.1 + 38.2, z * .73 + 61.3) - .5) * .16;
  return 1 - THREE.MathUtils.smoothstep(radius + edge, .70, 1.02);
}
