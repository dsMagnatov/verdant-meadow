import * as THREE from 'three';
import { fbm, noise2, rand, groundHeight, smoothstep } from './math.js';
import { HATCH_CENTER_Z, HATCH_RADIUS_X, HATCH_RADIUS_Z } from './hatch.js';

export const UNDERGROUND_BOUNDS = Object.freeze({
  halfWidth: 2.8,
  entranceMinZ: -5.35,
  entranceMaxZ: 10.65,
  tunnelEndZ: -36,
  floorY: -14,
  archSpringY: -9.05,
  archHeight: 3.0,
});

const B = UNDERGROUND_BOUNDS;

function entranceEdge(z, side) {
  const localZ = z - HATCH_CENTER_Z;
  const fraction = THREE.MathUtils.clamp(localZ / HATCH_RADIUS_Z, -1, 1);
  const angle = Math.asin(fraction);
  const outline = 1 + Math.sin(angle * 7 + side * .6) * .014
    + Math.sin(angle * 15 - side * 1.2) * .006;
  const ellipse = HATCH_RADIUS_X * Math.sqrt(Math.max(0, 1 - fraction * fraction)) * outline;
  return side * Math.min(B.halfWidth, ellipse);
}

/** The exact clipped ellipse slot used by both the terrain cut and wall tops. */
export function openingContains(x, z) {
  return z >= B.entranceMinZ && z <= B.entranceMaxZ
    && x > entranceEdge(z, -1) && x < entranceEdge(z, 1);
}

export function undergroundFloorHeight(x, z) {
  const edgeDebris = smoothstep(1.1, 2.8, Math.abs(x))
    * noise2(x * 2.7 + 20, z * 2.7) * .15;
  return B.floorY + Math.sin(z * .24 + x * .21) * .095
    + (fbm(x * .75 + 13, z * .62) - .48) * .22 + edgeDebris;
}

function wallX(side, y, z, isEntrance) {
  const topY = isEntrance ? groundHeight(entranceEdge(z, side), z) - .025 : 0;
  const depth = Math.max(0, topY - y);
  const topWidth = isEntrance ? Math.abs(entranceEdge(z, side)) : B.halfWidth;
  const widening = smoothstep(.12, 1.65, depth);
  const width = THREE.MathUtils.lerp(topWidth, B.halfWidth, widening);
  const strata = Math.sin(y * 1.7 + Math.sin(z * .47) * .9) * .105;
  const broken = (fbm(y * .8 + side * 9, z * .62 + 7) - .45) * .44;
  const grain = Math.sin(y * 6.1 - z * 3.9) * Math.sin(z * 5.7 + y * 1.8) * .025;
  return side * (width + (strata + broken + grain) * widening);
}

function mossAmount(x, y, z, kind) {
  const patch = fbm(z * .36 + 3.7, y * .37 + x * .22) * .74
    + noise2(z * 1.4 + 8.1, y * 1.3 - x * .8) * .26;
  const depthFade = THREE.MathUtils.lerp(.93, .36, smoothstep(-1, 14, -y));
  const shelfBoost = kind === 'ledge' || kind === 'rim' || kind === 'floor' ? 1.16 : .85;
  return THREE.MathUtils.clamp(smoothstep(.33, .61, patch) * depthFade * shelfBoost, 0, .96);
}

function makeBuilder(kind) {
  const positions = [], uv = [], colors = [], moss = [], indices = [];
  const shade = new THREE.Color();
  return {
    kind,
    grid(columns, rows, evaluate, normalHint, uvAxes = 'zy') {
      const offset = positions.length / 3;
      for (let row = 0; row <= rows; row++) {
        for (let column = 0; column <= columns; column++) {
          const p = evaluate(column / columns, row / rows);
          const [x, y, z] = p;
          positions.push(x, y, z);
          if (uvAxes === 'xz') uv.push(x * .31, z * .31);
          else if (uvAxes === 'xy') uv.push(x * .31, y * .31);
          else if (uvAxes === 'arc') uv.push(Math.atan2(y - B.archSpringY, x) * B.halfWidth * .31, z * .31);
          else uv.push(z * .31, y * .31);
          const grain = .76 + noise2(z * .87 + x * .32, y * .93 + 6) * .24;
          const weathering = .85 + fbm(x * .63 + 5, z * .61 + y * .2) * .22;
          shade.setRGB(.83 * grain * weathering, .91 * grain * weathering, .88 * grain * weathering);
          colors.push(shade.r, shade.g, shade.b);
          moss.push(mossAmount(x, y, z, kind));
        }
      }
      const pushTriangle = (a, b, c) => {
        const ia = a * 3, ib = b * 3, ic = c * 3;
        const ax = positions[ib] - positions[ia];
        const ay = positions[ib + 1] - positions[ia + 1];
        const az = positions[ib + 2] - positions[ia + 2];
        const bx = positions[ic] - positions[ia];
        const by = positions[ic + 1] - positions[ia + 1];
        const bz = positions[ic + 2] - positions[ia + 2];
        const crossX = ay * bz - az * by;
        const crossY = az * bx - ax * bz;
        const crossZ = ax * by - ay * bx;
        const hint = typeof normalHint === 'function'
          ? normalHint(positions[ia], positions[ia + 1], positions[ia + 2]) : normalHint;
        if (crossX * hint[0] + crossY * hint[1] + crossZ * hint[2] >= 0) indices.push(a, b, c);
        else indices.push(a, c, b);
      };
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const a = offset + row * (columns + 1) + column;
        const b = a + columns + 1;
        if ((column + row) % 2) {
          pushTriangle(a, b, b + 1); pushTriangle(a, b + 1, a + 1);
        } else {
          pushTriangle(a, b, a + 1); pushTriangle(a + 1, b, b + 1);
        }
      }
    },
    finish() {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      geometry.setAttribute('caveMoss', new THREE.Float32BufferAttribute(moss, 1));
      geometry.setIndex(indices);
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      return geometry;
    },
  };
}

function caveMaterial(stoneMaterial, mossMap) {
  const material = stoneMaterial.clone();
  material.name = 'Locally mossed stratified cave stone';
  material.vertexColors = true;
  material.side = THREE.DoubleSide;
  material.roughness = .97;
  material.bumpMap = stoneMaterial.map ?? null;
  material.bumpScale = .038;
  const mossTexture = mossMap ?? new THREE.DataTexture(new Uint8Array([37, 79, 25, 255]), 1, 1);
  if (!mossMap) mossTexture.needsUpdate = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uCaveMossMap = { value: mossTexture };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float caveMoss;
        varying float vCaveMoss;
        varying vec3 vCavePosition;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vCaveMoss=caveMoss;
        vCavePosition=(modelMatrix*vec4(position,1.)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uCaveMossMap;
        varying float vCaveMoss;
        varying vec3 vCavePosition;
        float caveGrain(vec3 p){return fract(sin(dot(floor(p),vec3(17.71,91.19,43.33)))*41879.73);}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 caveMossUv=vec2(vCavePosition.z+vCavePosition.x*.28,vCavePosition.y)*.87;
        vec3 caveGreen=texture2D(uCaveMossMap,caveMossUv).rgb*vec3(.67,.94,.66);
        vec3 caveFine=texture2D(uCaveMossMap,caveMossUv*2.17+vec2(3.1,7.4)).rgb;
        float caveCoverage=vCaveMoss*(.73+.27*smoothstep(.04,.24,caveFine.g));
        diffuseColor.rgb*=.91+caveGrain(vCavePosition*29.)*.13;
        diffuseColor.rgb=mix(diffuseColor.rgb,caveGreen,caveCoverage*.91);`);
  };
  material.customProgramCacheKey = () => 'cave-local-moss-strata-v1';
  return material;
}

function wallGeometry(side) {
  const builder = makeBuilder('wall');
  // Entrance and tunnel share a material/UV scale, but not a stretched seam.
  builder.grid(96, 52, (u, v) => {
    const z = THREE.MathUtils.lerp(B.entranceMinZ, B.entranceMaxZ, u);
    const top = groundHeight(entranceEdge(z, side), z) - .025;
    const bottom = undergroundFloorHeight(side * B.halfWidth, z) - .10;
    const y = THREE.MathUtils.lerp(top, bottom, v);
    return [wallX(side, y, z, true), y, z];
  }, [-side, 0, 0]);
  builder.grid(128, 28, (u, v) => {
    const z = THREE.MathUtils.lerp(B.tunnelEndZ, B.entranceMinZ, u);
    const top = B.archSpringY + Math.sin(z * .67) * .055;
    const y = THREE.MathUtils.lerp(top, undergroundFloorHeight(side * B.halfWidth, z) - .10, v);
    return [wallX(side, y, z, false), y, z];
  }, [-side, 0, 0]);
  return builder.finish();
}

function archGeometry() {
  const builder = makeBuilder('wall');
  // Match the side walls' longitudinal subdivision exactly so the two shared
  // spring edges use identical vertices rather than two interpolated curves.
  builder.grid(40, 128, (u, v) => {
    const angle = u * Math.PI;
    const z = THREE.MathUtils.lerp(B.entranceMinZ, B.tunnelEndZ, v);
    return archPoint(angle, z);
  }, (x, y) => [-x, -(y - B.archSpringY), 0], 'arc');
  return builder.finish();
}

function archPoint(angle, z) {
  const side = Math.cos(angle) < 0 ? -1 : 1;
  const spring = B.archSpringY + Math.sin(z * .67) * .055;
  const y = spring + Math.sin(angle) * B.archHeight;
  const wallRadius = Math.abs(wallX(side, spring, z, false));
  const relief = (fbm(angle * 3.8 + 2, z * .61 + 11) - .48) * .34
    + Math.sin(z * 3.5 + angle * 13) * .028;
  return [Math.cos(angle) * (wallRadius + relief * Math.sin(angle)),
    y + relief * Math.sin(angle), z];
}

function endWallGeometry() {
  const builder = makeBuilder('wall');
  // The far bulkhead is solid above the arch, leaving the actual tunnel open.
  builder.grid(40, 40, (u, v) => {
    // The bottom shares the vault's exact angular tessellation, not a second
    // approximation of its arch. Side boundaries follow the same widening
    // function as the shaft at each height, preventing open sky wedges.
    const angle = u * Math.PI;
    const signed = Math.cos(angle);
    const archEdge = archPoint(angle, B.entranceMinZ);
    const archBottom = archEdge[1];
    const side = signed < 0 ? -1 : 1;
    const xBottom = archEdge[0];
    const xTop = entranceEdge(B.entranceMinZ, side) * Math.abs(signed);
    const y = THREE.MathUtils.lerp(archBottom, groundHeight(xTop, B.entranceMinZ) - .025, v);
    const widthAtHeight = wallX(side, y, B.entranceMinZ, true);
    const widthAtBottom = wallX(side, archBottom, B.entranceMinZ, true);
    const archCorrection = (xBottom - widthAtBottom * Math.abs(signed)) * (1 - v);
    // Bury a slim end strip into the adjacent stone. This closes sub-pixel
    // gaps between independently tessellated rough wall profiles.
    const buriedSide = side * .16 * smoothstep(.78, 1, Math.abs(signed)) * smoothstep(0, .12, v);
    const x = widthAtHeight * Math.abs(signed) + archCorrection + buriedSide;
    const ripple = Math.sin(x * 4.4 + y * 2.3) * .045 * Math.sin(v * Math.PI) * (1 - signed * signed);
    return [x, y, B.entranceMinZ - ripple];
  }, [0, 0, 1], 'xy');
  builder.grid(36, 48, (u, v) => {
    const signed = u * 2 - 1;
    const side = signed < 0 ? -1 : 1;
    const xTop = entranceEdge(B.entranceMaxZ, side) * Math.abs(signed);
    const xBottom = wallX(side, -13.9, B.entranceMaxZ, true) * Math.abs(signed);
    const y = THREE.MathUtils.lerp(groundHeight(xTop, B.entranceMaxZ) - .025,
      undergroundFloorHeight(xBottom, B.entranceMaxZ) - .15, v);
    const x = wallX(side, y, B.entranceMaxZ, true) * Math.abs(signed)
      + side * .16 * smoothstep(.78, 1, Math.abs(signed));
    return [x, y, B.entranceMaxZ + Math.sin(x * 3.3 - y * 2.7) * .035
      * Math.sin(v * Math.PI) * (1 - signed * signed)];
  }, [0, 0, -1], 'xy');
  // A stone face beyond the visible corridor avoids a sky-colored endpoint.
  builder.grid(28, 32, (u, v) => {
    const x = (u * 2 - 1) * 3.05;
    const bottom = undergroundFloorHeight(x, B.tunnelEndZ) - .2;
    const y = THREE.MathUtils.lerp(bottom, -5.7, v);
    return [x, y, B.tunnelEndZ - .2 + Math.sin(x * 3.8 + y * 2.3) * .08];
  }, [0, 0, 1], 'xy');
  return builder.finish();
}

function floorGeometry() {
  const builder = makeBuilder('floor');
  builder.grid(40, 184, (u, v) => {
    const z = THREE.MathUtils.lerp(B.entranceMaxZ + .15, B.tunnelEndZ - .4, v);
    const x = (u * 2 - 1) * 3.18;
    return [x, undergroundFloorHeight(x, z), z];
  }, [0, 1, 0], 'xz');
  return builder.finish();
}

function collarGeometry() {
  const builder = makeBuilder('rim');
  for (const side of [-1, 1]) {
    builder.grid(5, 128, (u, v) => {
      const z = THREE.MathUtils.lerp(B.entranceMinZ, B.entranceMaxZ, v);
      const edge = entranceEdge(z, side);
      const fringe = Math.sin(z * 3.7) * .025 + noise2(z * 3.2, side + 6) * .04;
      const x = edge + side * THREE.MathUtils.lerp(-.10, .45 + fringe, u);
      const y = groundHeight(edge, z) + .018
        + Math.sin(z * 5.2 + x * 3.7) * .019 - (1 - smoothstep(0, .28, u)) * .035;
      return [x, y, z];
    }, [0, 1, 0], 'xz');
    builder.grid(3, 128, (u, v) => {
      const z = THREE.MathUtils.lerp(B.entranceMinZ, B.entranceMaxZ, v);
      const edge = entranceEdge(z, side);
      const x = edge - side * .10;
      const top = groundHeight(edge, z) - .017;
      return [THREE.MathUtils.lerp(x, edge, u), top - u * .27, z];
    }, [-side, .15, 0]);
  }
  for (const end of [B.entranceMinZ, B.entranceMaxZ]) {
    const front = end === B.entranceMaxZ ? 1 : -1;
    builder.grid(40, 5, (u, v) => {
      const side = u < .5 ? -1 : 1;
      const x = Math.abs(u * 2 - 1) * entranceEdge(end, side);
      const z = end + front * THREE.MathUtils.lerp(-.1, .47, v);
      return [x, groundHeight(x, end) + .012 + Math.sin(x * 4.6 + z * 2.2) * .022, z];
    }, [0, 1, 0], 'xz');
  }
  return builder.finish();
}

function ledgeGeometry() {
  const builder = makeBuilder('ledge');
  const random = rand(71319);
  const shelves = [];
  for (const side of [-1, 1]) {
    for (let index = 0; index < 48; index++) {
      const entrance = index < 33;
      shelves.push({
        side, entrance,
        y: entrance ? -1.0 - random() * 11.8 : -10.0 - random() * 3.25,
        z: entrance ? -4.4 + random() * 14.1 : -6.3 - random() * 25.5,
        extent: .27 + random() ** .65 * .51,
        length: .36 + random() * .79,
      });
    }
  }
  for (const shelf of shelves) {
    const { side, y, z, extent, length, entrance } = shelf;
    const shelfTop = (u, v) => {
      const t = THREE.MathUtils.lerp(-.99, .99, v);
      const worldZ = z + t * length;
      const protrusion = Math.sqrt(1 - t * t) * extent;
      const x = wallX(side, y, worldZ, entrance) - side * protrusion * u;
      const topY = y + Math.sin(x * 5.2 + worldZ * 3.1) * .022
        - u * u * .085 + Math.sin(v * Math.PI) * .016;
      return [x, topY, worldZ];
    };
    builder.grid(8, 6, shelfTop, [0, 1, 0], 'xz');
    builder.grid(2, 6, (u, v) => {
      const p = shelfTop(1, v);
      const x = p[0] + side * u * extent * .20;
      return [x, p[1] - u * (.20 + extent * .16), p[2]];
    }, [-side, .25, 0]);
  }
  return { geometry: builder.finish(), shelves };
}

function sampleSurface(geometry, requested, random, accept, kind, role) {
  const samples = [];
  const position = geometry.attributes.position, normal = geometry.attributes.normal;
  const moss = geometry.attributes.caveMoss;
  const triangleCount = geometry.index.count / 3;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const n = new THREE.Vector3(), na = new THREE.Vector3(), nb = new THREE.Vector3(), nc = new THREE.Vector3();
  const point = new THREE.Vector3();
  for (let attempt = 0; samples.length < requested && attempt < requested * 30; attempt++) {
    const triangle = Math.floor(random() * triangleCount) * 3;
    const ia = geometry.index.getX(triangle), ib = geometry.index.getX(triangle + 1), ic = geometry.index.getX(triangle + 2);
    a.fromBufferAttribute(position, ia); b.fromBufferAttribute(position, ib); c.fromBufferAttribute(position, ic);
    na.fromBufferAttribute(normal, ia); nb.fromBufferAttribute(normal, ib); nc.fromBufferAttribute(normal, ic);
    const root = Math.sqrt(random()), second = random();
    const wa = 1 - root, wb = root * (1 - second), wc = root * second;
    point.copy(a).multiplyScalar(wa).addScaledVector(b, wb).addScaledVector(c, wc);
    n.copy(na).multiplyScalar(wa).addScaledVector(nb, wb).addScaledVector(nc, wc).normalize();
    if (!accept(point, n)) continue;
    const depth = Math.max(0, -point.y);
    samples.push({
      position: point.clone().addScaledVector(n, .018), normal: n.clone(),
      depth, depthMeters: depth, depthProgress: THREE.MathUtils.clamp(depth / 14, 0, 1),
      kind, role, side: point.x < 0 ? -1 : 1,
      moss: moss.getX(ia) * wa + moss.getX(ib) * wb + moss.getX(ic) * wc,
      seed: random(),
    });
  }
  return samples;
}

function shadowBackingGeometry(surfaces) {
  const positions = [], normals = [], uv = [], colors = [], moss = [], indices = [];
  for (const surface of surfaces) {
    const geometry = surface.geometry;
    const offset = positions.length / 3;
    const p = geometry.attributes.position, n = geometry.attributes.normal;
    const t = geometry.attributes.uv, c = geometry.attributes.color, m = geometry.attributes.caveMoss;
    // A second skin buried outside the cave stops bias-sized sunlight leaks
    // through the thin triangulated enclosure and also backs tiny view cracks.
    for (let vertex = 0; vertex < p.count; vertex++) {
      positions.push(p.getX(vertex) - n.getX(vertex) * .25,
        p.getY(vertex) - n.getY(vertex) * .25,
        p.getZ(vertex) - n.getZ(vertex) * .25);
      normals.push(n.getX(vertex), n.getY(vertex), n.getZ(vertex));
      uv.push(t.getX(vertex), t.getY(vertex));
      colors.push(c.getX(vertex), c.getY(vertex), c.getZ(vertex));
      moss.push(m.getX(vertex));
    }
    for (const index of geometry.index.array) indices.push(index + offset);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('caveMoss', new THREE.Float32BufferAttribute(moss, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

/** Natural shaft and arch beneath the hatch; root owns terrain cutting/camera. */
export function createUnderground({ scene, stoneMaterial, mossMap }) {
  const group = new THREE.Group();
  group.name = 'Living underground stone passage';
  const material = caveMaterial(stoneMaterial, mossMap);
  const pointerSurfaces = [];
  const addStone = (geometry, name) => {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    pointerSurfaces.push(mesh);
    return mesh;
  };
  const leftWall = addStone(wallGeometry(-1), 'Left eroded shaft and corridor wall');
  const rightWall = addStone(wallGeometry(1), 'Right eroded shaft and corridor wall');
  const vault = addStone(archGeometry(), 'Sun blocking vaulted stone tunnel');
  const endWalls = addStone(endWallGeometry(), 'Shaft bulkheads around open arch');
  const floor = addStone(floorGeometry(), 'Uneven clear central cave floor');
  const collar = addStone(collarGeometry(), 'Moss stone collar covering terrain cut');
  const ledges = ledgeGeometry();
  const shelves = addStone(ledges.geometry, 'Natural root bearing wall shelves');
  const shadowBacking = new THREE.Mesh(shadowBackingGeometry([leftWall, rightWall, vault, endWalls]), material);
  shadowBacking.name = 'Buried thick cave enclosure backing';
  shadowBacking.castShadow = shadowBacking.receiveShadow = true;
  group.add(shadowBacking);

  const random = rand(37182);
  const rootSamples = [
    ...sampleSurface(shelves.geometry, 1100, random,
      (p, n) => n.y > .35 && Math.abs(p.x) > 1.7 && p.y < -.5, 'ledge', 'cave-ledge'),
    ...sampleSurface(leftWall.geometry, 185, random,
      (p, n) => p.y < -.65 && p.y > -13.4 && n.x > .55, 'wall', 'cave-wall'),
    ...sampleSurface(rightWall.geometry, 185, random,
      (p, n) => p.y < -.65 && p.y > -13.4 && n.x < -.55, 'wall', 'cave-wall'),
    ...sampleSurface(floor.geometry, 200, random,
      (p, n) => Math.abs(p.x) > 1.5 && Math.abs(p.x) < 2.65 && n.y > .7, 'floor', 'cave-floor'),
    ...sampleSurface(collar.geometry, 90, random,
      (p, n) => n.y > .5, 'entrance', 'entrance'),
  ];

  const entranceLight = new THREE.PointLight(0xffd08a, 38, 25, 2);
  entranceLight.position.set(-.65, -.65, 4.2);
  entranceLight.name = 'Warm light spilling through open hatch';
  const nearLight = new THREE.PointLight(0x83d8c4, 46, 21, 2);
  nearLight.position.set(.55, -7.3, 2.0);
  nearLight.name = 'Soft cool shaft stone fill';
  const archLight = new THREE.PointLight(0x67bdb5, 54, 23, 2);
  archLight.position.set(-.4, -9.0, -9.5);
  archLight.name = 'Teal illumination beyond stone arch';
  const deepLight = new THREE.PointLight(0x517f9d, 38, 22, 2);
  deepLight.position.set(.4, -9.8, -24.0);
  deepLight.name = 'Receding blue cave illumination';
  // Keep the light count constant during scroll to avoid a shader recompilation
  // when the geometry becomes visible. Closed-state intensity remains zero.
  const lightRig = new THREE.Group();
  lightRig.name = 'Persistent subterranean lighting rig';
  lightRig.add(entranceLight, nearLight, archLight, deepLight);
  scene?.add(group, lightRig);

  let triangles = 0;
  for (const surface of pointerSurfaces) triangles += surface.geometry.index.count / 3;
  triangles += shadowBacking.geometry.index.count / 3;
  const counts = {
    meshes: pointerSurfaces.length + 1, triangles, shelves: ledges.shelves.length,
    roots: rootSamples.length,
    ledgeRoots: rootSamples.filter(s => s.kind === 'ledge').length,
    wallRoots: rootSamples.filter(s => s.kind === 'wall').length,
    floorRoots: rootSamples.filter(s => s.kind === 'floor').length,
  };
  const setProgress = (progress, opening = progress) => {
    const p = THREE.MathUtils.clamp(progress, 0, 1);
    const aperture = THREE.MathUtils.clamp(opening, 0, 1);
    group.visible = Math.max(p, aperture) > .002;
    const reveal = smoothstep(.01, .25, Math.max(p, aperture));
    entranceLight.intensity = 38 * reveal * (1 - smoothstep(.72, 1, p) * .42);
    nearLight.intensity = 46 * reveal;
    archLight.intensity = 54 * reveal;
    deepLight.intensity = 38 * reveal;
    group.userData.depthProgress = p;
  };
  setProgress(0);

  return { group, rootSamples, pointerSurfaces, floorHeight: undergroundFloorHeight,
    openingContains, setProgress, counts, bounds: B, leftWall, rightWall, vault, endWalls,
    floor, collar, shelves, shadowBacking, lightRig,
    lights: [entranceLight, nearLight, archLight, deepLight] };
}
