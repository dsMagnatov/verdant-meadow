import * as THREE from 'three';

// Both leaves share the same fracture, so they can slide apart without a seam
// changing shape. Its front rim extends beyond the camera: the first screen
// reads as a cracked stone floor, while the far rim reveals the rounded lid.
export const HATCH_CENTER_Z = 2.6;
export const HATCH_RADIUS_X = 7.6;
export const HATCH_RADIUS_Z = 8.1;
const RADIUS_X = HATCH_RADIUS_X;
const RADIUS_Z = HATCH_RADIUS_Z;
const ROWS = 144;
const COLUMNS = 96;
const UV_SCALE = 0.32;

function hash(value) {
  const n = Math.sin(value * 127.1 + 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

function fracture(z) {
  const t = (z + RADIUS_Z) / 0.22;
  const cell = Math.floor(t);
  const f = t - cell;
  const jagged = THREE.MathUtils.lerp(hash(cell + 81), hash(cell + 82), f) - 0.5;
  const fade = Math.pow(Math.max(0, 1 - (z / RADIUS_Z) ** 2), 0.3);
  return (jagged * 0.115 + Math.sin(z * 1.7) * 0.024) * fade;
}

function crackWidth(z) {
  return 0.11 + 0.032 * Math.sin(z * 2.3 + 0.7) ** 2;
}

function outlineScale(z, sign) {
  const theta = Math.asin(THREE.MathUtils.clamp(z / RADIUS_Z, -1, 1));
  return 1 + Math.sin(theta * 7.0 + sign * 0.6) * 0.014 + Math.sin(theta * 15.0 - sign * 1.2) * 0.006;
}

function outerEdge(z, sign) {
  return sign * RADIUS_X * Math.sqrt(Math.max(0, 1 - (z / RADIUS_Z) ** 2)) * outlineScale(z, sign);
}

function localSurfaceHeight(x, z) {
  const center = fracture(z);
  const sign = x < center ? -1 : 1;
  const cutX = center + sign * crackWidth(z) * 0.5;
  const ellipseDistance = Math.max(
    0,
    (1 - Math.hypot(x / (RADIUS_X * outlineScale(z, sign)), z / RADIUS_Z)) * RADIUS_X,
  );
  // Broad eroded relief stays shallow; fine grain is supplied by the PBR maps.
  const erosion =
    Math.sin(x * 0.98 + z * 1.12) * 0.029 +
    Math.sin(x * 2.85 - z * 0.92 + 0.8) * 0.021 +
    Math.sin(x * 5.5 + z * 4.6) * Math.cos(z * 3.2 - x * 2.4) * 0.013 +
    Math.sin(x * 11.1 + z * 8.8) * 0.004;
  const rim = Math.exp(-ellipseDistance / 0.24) * 0.135;
  const fractureBevel = Math.exp(-Math.abs(x - cutX) / 0.07) * 0.026;
  return 0.45 + erosion - rim - fractureBevel;
}

/** World coordinates; excludes the open fracture between the two leaves. */
export function hatchContains(x, worldZ) {
  const z = worldZ - HATCH_CENTER_Z;
  if (Math.abs(z) >= RADIUS_Z - 0.0012) return false;
  const center = fracture(z);
  const sign = x < center ? -1 : 1;
  const cutX = center + sign * crackWidth(z) * 0.5;
  const outerX = outerEdge(z, sign);
  return sign * (x - cutX) >= 0 && sign * (outerX - x) >= 0;
}

/** Analytic top height in world coordinates, shared with mesh construction. */
export function hatchHeight(x, worldZ) {
  return localSurfaceHeight(x, worldZ - HATCH_CENTER_Z);
}

export function hatchNormalAt(x, worldZ, target = new THREE.Vector3()) {
  const step = 0.015;
  const dx = (hatchHeight(x + step, worldZ) - hatchHeight(x - step, worldZ)) / (step * 2);
  const dz = (hatchHeight(x, worldZ + step) - hatchHeight(x, worldZ - step)) / (step * 2);
  return target.set(-dx, 1, -dz).normalize();
}

export function hatchCrackAt(worldZ) {
  const z = worldZ - HATCH_CENTER_Z;
  return { x: fracture(z), width: crackWidth(z) };
}

function buildLeaf(sign, material, innerMaterial) {
  const positions = [];
  const uvs = [];
  const indices = [];
  const points = [];
  const end = RADIUS_Z - 0.0012;

  for (let row = 0; row <= ROWS; row += 1) {
    const zBase = THREE.MathUtils.lerp(-end, end, row / ROWS);
    const outerX = outerEdge(zBase, sign);
    const cutX = fracture(zBase) + sign * crackWidth(zBase) * 0.5;

    for (let column = 0; column <= COLUMNS; column += 1) {
      const fraction = column / COLUMNS;
      const jitterWeight = Math.sin(fraction * Math.PI) * Math.sin((row / ROWS) * Math.PI);
      const seed = row * 173 + column * 31 + (sign > 0 ? 1024 : 4096);
      const x = THREE.MathUtils.lerp(cutX, outerX, fraction) + (hash(seed) - 0.5) * 0.009 * jitterWeight;
      const z = zBase + (hash(seed + 3) - 0.5) * 0.009 * jitterWeight;
      const y = localSurfaceHeight(x, z);
      points.push(new THREE.Vector3(x, y, z));
      positions.push(x, y, z);
      uvs.push(x * UV_SCALE + 0.5, (z + HATCH_CENTER_Z) * UV_SCALE + 0.5);
    }
  }

  function triangle(a, b, c) {
    if (sign > 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  }

  for (let row = 0; row < ROWS; row += 1) {
    for (let column = 0; column < COLUMNS; column += 1) {
      const a = row * (COLUMNS + 1) + column;
      const b = a + COLUMNS + 1;
      const c = a + 1;
      const d = b + 1;
      if ((row + column) % 2) {
        triangle(a, b, d);
        triangle(a, d, c);
      } else {
        triangle(a, b, c);
        triangle(c, b, d);
      }
    }
  }

  const topGeometry = new THREE.BufferGeometry();
  topGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  topGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  topGeometry.setIndex(indices);
  topGeometry.computeVertexNormals();
  const top = new THREE.Mesh(topGeometry, material);
  top.name = 'eroded-stone-top';
  top.castShadow = true;
  top.receiveShadow = true;

  const perimeter = [];
  for (let column = 0; column < COLUMNS; column += 1) {
    perimeter.push({ point: points[column], cut: false });
  }
  for (let row = 0; row < ROWS; row += 1) {
    perimeter.push({ point: points[row * (COLUMNS + 1) + COLUMNS], cut: false });
  }
  for (let column = COLUMNS; column > 0; column -= 1) {
    perimeter.push({ point: points[ROWS * (COLUMNS + 1) + column], cut: false });
  }
  for (let row = ROWS; row > 0; row -= 1) {
    perimeter.push({ point: points[row * (COLUMNS + 1)], cut: true });
  }
  if (sign < 0) perimeter.reverse();

  const wallPositions = [];
  const wallUvs = [];
  const wallIndices = [];
  const fractureIndices = [];
  const count = perimeter.length;
  const depths = [0, 0.24, 0.62, 1];
  const perimeterDistances = [0];
  for (let edge = 1; edge <= count; edge += 1) {
    perimeterDistances.push(
      perimeterDistances[edge - 1] + perimeter[(edge - 1) % count].point.distanceTo(perimeter[edge % count].point),
    );
  }

  // Extra rings keep the rim rounded while small seeded offsets create chips.
  // The bottom pulls inward slightly, letting the slab sit into the meadow.
  for (let ring = 0; ring < depths.length; ring += 1) {
    for (let edge = 0; edge <= count; edge += 1) {
      const item = perimeter[edge % count];
      const p = item.point;
      const before = perimeter[(edge - 1 + count) % count].point;
      const after = perimeter[(edge + 1) % count].point;
      const tangent = new THREE.Vector2(after.x - before.x, after.z - before.z).normalize();
      const normal = new THREE.Vector2(tangent.y, -tangent.x);
      const erosion = (hash(edge * 9.7 + sign * 31) - 0.5) * 0.028;
      const profile = item.cut
        ? [0, -0.005, -0.01, -0.018][ring]
        : [0, 0.028 + erosion, 0.005 + erosion, -0.045][ring];
      const x = p.x + normal.x * profile;
      const z = p.z + normal.y * profile;
      const bottomY = 0.018 + Math.sin(x * 6.3 + z * 5.2) * 0.005;
      const y = THREE.MathUtils.lerp(p.y, bottomY, depths[ring]);
      wallPositions.push(x, y, z);
      wallUvs.push(perimeterDistances[edge] * UV_SCALE, y * UV_SCALE);
    }
  }

  const wallGeometry = new THREE.BufferGeometry();
  for (let ring = 0; ring < depths.length - 1; ring += 1) {
    for (let edge = 0; edge < count; edge += 1) {
      const a = ring * (count + 1) + edge;
      const b = a + count + 1;
      // Only the recessed fracture is darkened; its very top lip still catches light.
      const isCut = perimeter[edge].cut && perimeter[(edge + 1) % count].cut;
      const targetIndices = isCut && ring > 0 ? fractureIndices : wallIndices;
      targetIndices.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  wallGeometry.setAttribute('position', new THREE.Float32BufferAttribute(wallPositions, 3));
  wallGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(wallUvs, 2));
  wallGeometry.setIndex([...wallIndices, ...fractureIndices]);
  wallGeometry.addGroup(0, wallIndices.length, 0);
  wallGeometry.addGroup(wallIndices.length, fractureIndices.length, 1);
  wallGeometry.computeVertexNormals();
  const walls = new THREE.Mesh(wallGeometry, [material, innerMaterial]);
  walls.name = 'chipped-stone-rim';
  walls.castShadow = true;
  walls.receiveShadow = true;

  const bottomPositions = [sign * RADIUS_X * 0.45, 0.014, 0];
  const bottomIndices = [];
  const bottomUvs = [sign * RADIUS_X * 0.45 * UV_SCALE + 0.5, HATCH_CENTER_Z * UV_SCALE + 0.5];
  const bottomRingOffset = (depths.length - 1) * (count + 1) * 3;
  for (let edge = 0; edge < count; edge += 1) {
    const offset = bottomRingOffset + edge * 3;
    const x = wallPositions[offset];
    const y = wallPositions[offset + 1];
    const z = wallPositions[offset + 2];
    bottomPositions.push(x, y, z);
    bottomUvs.push(x * UV_SCALE + 0.5, (z + HATCH_CENTER_Z) * UV_SCALE + 0.5);
    bottomIndices.push(0, edge + 1, ((edge + 1) % count) + 1);
  }
  const bottomGeometry = new THREE.BufferGeometry();
  bottomGeometry.setAttribute('position', new THREE.Float32BufferAttribute(bottomPositions, 3));
  bottomGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(bottomUvs, 2));
  bottomGeometry.setIndex(bottomIndices);
  bottomGeometry.computeVertexNormals();
  const underside = new THREE.Mesh(bottomGeometry, innerMaterial);
  underside.name = 'stone-slab-underside';
  underside.castShadow = true;

  const leaf = new THREE.Group();
  leaf.name = sign < 0 ? 'hatch-left-leaf' : 'hatch-right-leaf';
  leaf.add(top, walls, underside);
  leaf.userData.slideDirection = sign;
  leaf.userData.worldCenterZ = HATCH_CENTER_Z;
  return leaf;
}

function createCrackBed() {
  const positions = [];
  const indices = [];
  for (let row = 0; row <= ROWS; row += 1) {
    const z = THREE.MathUtils.lerp(-RADIUS_Z, RADIUS_Z, row / ROWS);
    const x = fracture(z);
    const half = crackWidth(z) * 0.5 + 0.035;
    positions.push(x - half, 0.026, z, x + half, 0.026, z);
    if (row < ROWS) {
      const a = row * 2;
      indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x10160c }));
  mesh.name = 'unlit-fracture-depth';
  return mesh;
}

/**
 * @param {THREE.MeshStandardMaterial} material Rock PBR material, repeat-wrapped maps.
 * The returned sampling functions take world X/Z. A plant attached to either
 * leaf uses local (worldX, worldY, worldZ - centerZ), keeping its roots on that
 * leaf when it slides sideways. contains intentionally excludes the crack.
 */
export function createHatch(material) {
  const group = new THREE.Group();
  group.name = 'stone-hatch';
  group.position.z = HATCH_CENTER_Z;

  const innerMaterial = material.clone();
  innerMaterial.color.multiplyScalar(0.38);
  innerMaterial.roughness = 1;
  innerMaterial.name = 'stone-fracture-shadow';

  const left = buildLeaf(-1, material, innerMaterial);
  const right = buildLeaf(1, material, innerMaterial);
  const logoAnchor = new THREE.Group();
  logoAnchor.name = 'future-rotating-logo-anchor';
  logoAnchor.position.set(0, 2.1, -1 - HATCH_CENTER_Z);
  const crackBed = createCrackBed();
  group.add(crackBed, left, right, logoAnchor);
  const coordinates = Object.freeze({ centerX: 0, centerZ: HATCH_CENTER_Z, radiusX: RADIUS_X, radiusZ: RADIUS_Z });
  group.userData.coordinates = coordinates;

  return {
    group, left, right, logoAnchor, crackBed,
    descentTarget: new THREE.Vector3(0, -4, -1),
    contains: hatchContains,
    surfaceHeight: hatchHeight,
    normalAt: hatchNormalAt,
    crackAt: hatchCrackAt,
    leafForPoint: (x, z) => x < fracture(z - HATCH_CENTER_Z) ? left : right,
    centerZ: HATCH_CENTER_Z, radiusX: RADIUS_X, radiusZ: RADIUS_Z, coordinates,
  };
}
