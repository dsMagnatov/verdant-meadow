import * as THREE from 'three';
import { rand } from './math.js';
import { addPlantMotion, makeCrossedHerbGeometry } from './vegetation.js';

function normalizeFern(source) {
  const geometry = source.clone();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const height = Math.max(0.001, box.max.y - box.min.y);
  geometry.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  geometry.scale(1 / height, 1 / height, 1 / height);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeHangingVine(seed) {
  const random = rand(seed);
  const positions = [], colors = [], uvs = [], indices = [];
  const stemColor = new THREE.Color(0x304d19);
  const leafColor = new THREE.Color();
  const phase = random() * Math.PI * 2;
  const stemPoint = height => new THREE.Vector3(
    Math.sin(height * 7.5 + phase) * 0.030 * height,
    height,
    Math.cos(height * 5.0 + phase) * 0.026 * height,
  );
  for (let plane = 0; plane < 2; plane++) {
    const baseIndex = positions.length / 3;
    for (let segment = 0; segment <= 14; segment++) {
      const height = segment / 14;
      const point = stemPoint(height);
      for (const side of [-1, 1]) {
        positions.push(point.x + (plane === 0 ? side * 0.008 : 0), point.y,
          point.z + (plane === 1 ? side * 0.008 : 0));
        colors.push(stemColor.r, stemColor.g, stemColor.b);
        uvs.push((side + 1) / 2, height);
      }
    }
    for (let segment = 0; segment < 14; segment++) {
      const index = baseIndex + segment * 2;
      indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
    }
  }
  for (let leaf = 0; leaf < 14; leaf++) {
    const height = 0.07 + leaf / 14 * 0.85 + (random() - 0.5) * 0.030;
    const point = stemPoint(height);
    const angle = (leaf % 2 ? Math.PI : 0) + (random() - 0.5) * 1.9;
    const dx = Math.cos(angle), dz = Math.sin(angle);
    const length = 0.13 + random() * 0.14;
    const halfWidth = 0.043 + random() * 0.038;
    leafColor.setHSL(0.24 + random() * 0.075, 0.41 + random() * 0.14, 0.31 + random() * 0.11);
    const baseIndex = positions.length / 3;
    for (let segment = 0; segment <= 4; segment++) {
      const progress = segment / 4;
      const width = Math.sin(progress * Math.PI) ** 0.8 * halfWidth + 0.001;
      const curve = Math.sin(progress * Math.PI) * 0.028;
      for (const side of [-1, 1]) {
        positions.push(point.x + dx * length * progress - dz * width * side,
          point.y + curve + progress * 0.018,
          point.z + dz * length * progress + dx * width * side);
        colors.push(leafColor.r, leafColor.g, leafColor.b);
        uvs.push((side + 1) / 2, progress);
      }
    }
    for (let segment = 0; segment < 4; segment++) {
      const index = baseIndex + segment * 2;
      indices.push(index, index + 1, index + 2, index + 1, index + 3, index + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function addRootedGrowth(material, reveal) {
  const compileMotion = material.onBeforeCompile;
  const motionKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    compileMotion.call(material, shader, renderer);
    shader.uniforms.uCaveDepthReveal = reveal;
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float aCaveDepth;
      attribute float aCaveSeed;
      uniform float uCaveDepthReveal;
      varying float vCaveGrowth;`);
    // Scale from the sampled root after wind and pointer motion. The root never
    // translates, including when the vine grows downward from a cave ridge.
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      float caveGrowth = smoothstep(aCaveDepth - 1.45 + aCaveSeed * 0.28,
                                    aCaveDepth + 0.55 + aCaveSeed * 0.28, uCaveDepthReveal);
      vCaveGrowth = caveGrowth;
      transformed *= caveGrowth;
      #include <project_vertex>`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float vCaveGrowth;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      #include <alphatest_fragment>
      if (vCaveGrowth < 0.025) discard;`);
  };
  material.customProgramCacheKey = () => `${motionKey}-rooted-cave-growth-v1`;
  material.needsUpdate = true;
  return material;
}

/** Ledge samples use world-space position/normal; depth and depthMeters are meters below ground. */
export function createUndergroundVegetation({
  scene, fernGeometry, fernMaterial, atlas, mossMap = null, uniforms, rootSamples = [],
}) {
  const group = new THREE.Group();
  group.name = 'growing-cave-vegetation';
  scene.add(group);
  const random = rand(945028);
  const reveal = { value: 1.1 };
  const counts = { ferns: 0, herbs: 0, flowers: 0, vines: 0, plants: 0, chunks: 0 };
  const validSamples = rootSamples.filter(sample => sample.position && sample.normal
    && Math.abs(sample.position.x) > 1.35 && sample.position.y <= 0.35
    && sample.normal.lengthSq() > 0.25 && (sample.moss ?? 1) > 0.12);
  const sampleDepth = sample => Math.max(0, sample.depthMeters ?? sample.depth ?? -sample.position.y);
  const maximumDepth = Math.max(14, ...validSamples.map(sampleDepth));
  const fern = normalizeFern(fernGeometry);
  const geometryTypes = new Map([['fern', fern]]);
  for (let column = 0; column < 8; column++) geometryTypes.set(`herb-${column}`, makeCrossedHerbGeometry(column));
  const blossomCells = [{ row: 4, column: 5 }, { row: 2, column: 7 }, { row: 3, column: 6 }];
  blossomCells.forEach((cell, index) => geometryTypes.set(`flower-${index}`, makeCrossedHerbGeometry(cell.column, cell.row)));
  for (let variant = 0; variant < 3; variant++) geometryTypes.set(`vine-${variant}`, makeHangingVine(11371 + variant * 981));

  const motionOptions = {
    fern: { emission: 1.15, breeze: 0.68, diffuseBoost: 1.8, baseEmission: 0.045 },
    herb: { emission: 1.15, breeze: 0.80, diffuseBoost: 1.8, baseEmission: 0.050 },
    flower: { emission: 0.75, breeze: 0.80, diffuseBoost: 1.3, baseEmission: 0.11 },
    vine: { emission: 1.00, breeze: 0.65, diffuseBoost: 1.1, baseEmission: 0.045 },
  };
  const surfaces = {
    fern: fernMaterial.clone(),
    herb: new THREE.MeshStandardMaterial({ map: atlas ?? null, color: 0xe0edc5, alphaTest: 0.42,
      roughness: 0.90, side: THREE.DoubleSide }),
    flower: new THREE.MeshStandardMaterial({ map: atlas ?? null, color: 0xf6f0d9, alphaTest: 0.38,
      roughness: 0.86, side: THREE.DoubleSide }),
    vine: new THREE.MeshStandardMaterial({ map: mossMap, bumpMap: mossMap, bumpScale: 0.007,
      color: 0xf3eed0, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
  };
  const depths = {};
  for (const [type, surface] of Object.entries(surfaces)) {
    surface.side = THREE.DoubleSide;
    addRootedGrowth(addPlantMotion(surface, uniforms, motionOptions[type]), reveal);
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking,
      map: surface.map, alphaMap: surface.alphaMap, alphaTest: surface.alphaTest, side: THREE.DoubleSide });
    depths[type] = addRootedGrowth(addPlantMotion(depth, uniforms, {
      emission: 0, breeze: motionOptions[type].breeze, heightRange: 1,
    }), reveal);
  }

  const buckets = new Map();
  function addPlant(sample, type, geometryKey, height, width, hanging = false) {
    const depth = sampleDepth(sample);
    const chunkIndex = Math.max(0, Math.floor(depth / 3.5));
    const key = `${chunkIndex}:${geometryKey}`;
    if (!buckets.has(key)) buckets.set(key, { chunkIndex, type, geometryKey, plants: [] });
    buckets.get(key).plants.push({ sample, depth, height, width, hanging, seed: random() });
    counts[type === 'fern' ? 'ferns' : type === 'herb' ? 'herbs' : type === 'flower' ? 'flowers' : 'vines']++;
    counts.plants++;
  }
  const ledges = validSamples.filter(sample => sample.normal.y > 0.27
    && (sample.kind !== 'wall' && sample.role !== 'cave-wall'));
  for (let index = 0; index < ledges.length; index++) {
    const sample = ledges[index];
    const depth = sampleDepth(sample);
    const choose = random();
    if (choose < 0.70 || !atlas) {
      if (counts.ferns >= 1040) continue;
      const floor = sample.kind === 'floor' || sample.role === 'cave-floor';
      const height = floor ? 0.18 + random() * 0.29 : 0.28 + random() ** 0.8 * 0.43;
      addPlant(sample, 'fern', 'fern', height, 0.75 + random() * 0.27);
    } else if (choose > 0.965 && depth < 5.5) {
      addPlant(sample, 'flower', `flower-${index % blossomCells.length}`, 0.19 + random() * 0.23, 0.82 + random() * 0.21);
    } else {
      addPlant(sample, 'herb', `herb-${index % 8}`, 0.23 + random() * 0.41, 0.80 + random() * 0.30);
    }
  }
  const walls = validSamples.filter(sample => sample.kind === 'wall' || sample.role === 'cave-wall'
    || sample.normal.y <= 0.27);
  for (let index = 0; index < walls.length; index++) {
    const sample = walls[index];
    const depth = sampleDepth(sample);
    if (index % 5 === 0 && counts.ferns < 1040) {
      addPlant(sample, 'fern', 'fern', 0.19 + random() * 0.24, 0.72 + random() * 0.23);
    } else {
      const length = Math.min(0.95 + random() * 1.55, Math.max(0.22, 14.0 - depth));
      addPlant(sample, 'vine', `vine-${index % 3}`, length, 0.68 + random() * 0.38, true);
    }
  }

  const chunks = new Map();
  const dummy = new THREE.Object3D();
  const up = new THREE.Vector3(0, 1, 0), axis = new THREE.Vector3();
  const alignment = new THREE.Quaternion(), yaw = new THREE.Quaternion();
  const tint = new THREE.Color();
  for (const bucket of buckets.values()) {
    if (!chunks.has(bucket.chunkIndex)) {
      const chunk = new THREE.Group();
      chunk.name = `cave-plants-depth-${bucket.chunkIndex}`;
      chunk.userData.minimumDepth = bucket.chunkIndex * 3.5;
      chunks.set(bucket.chunkIndex, chunk);
      group.add(chunk);
    }
    const geometry = geometryTypes.get(bucket.geometryKey).clone();
    geometry.setAttribute('aCaveDepth', new THREE.InstancedBufferAttribute(
      new Float32Array(bucket.plants.map(plant => plant.depth)), 1));
    geometry.setAttribute('aCaveSeed', new THREE.InstancedBufferAttribute(
      new Float32Array(bucket.plants.map(plant => plant.seed)), 1));
    const mesh = new THREE.InstancedMesh(geometry, surfaces[bucket.type], bucket.plants.length);
    mesh.name = `rooted-cave-${bucket.geometryKey}-${bucket.chunkIndex}`;
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.customDepthMaterial = depths[bucket.type];
    bucket.plants.forEach((plant, index) => {
      const normal = plant.sample.normal.clone().normalize();
      dummy.position.copy(plant.sample.position).addScaledVector(normal, 0.013);
      if (plant.hanging) {
        axis.set(normal.x * 0.13, -1, normal.z * 0.08).normalize();
      } else {
        axis.copy(normal);
        if (axis.y < 0.18) axis.y = 0.18;
        axis.normalize();
      }
      alignment.setFromUnitVectors(up, axis);
      yaw.setFromAxisAngle(up, plant.seed * Math.PI * 2);
      dummy.quaternion.copy(alignment).multiply(yaw);
      const lateral = plant.hanging ? plant.width : plant.height * plant.width;
      dummy.scale.set(lateral, plant.height, lateral);
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
      tint.set(bucket.type === 'flower' ? 0xffffff : 0xdce8bf).multiplyScalar(0.91 + plant.seed * 0.12);
      mesh.setColorAt(index, tint);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    // Bounds include pointer rise, bending and the complete ungrown foliage.
    mesh.boundingSphere.radius += 1.0;
    chunks.get(bucket.chunkIndex).add(mesh);
  }
  counts.chunks = chunks.size;
  group.userData.counts = counts;

  function setProgress(depthProgress) {
    const progress = THREE.MathUtils.clamp(Number.isFinite(depthProgress) ? depthProgress : 0, 0, 1);
    reveal.value = 1.1 + progress * (maximumDepth + 0.7);
    group.userData.depthProgress = progress;
    for (const chunk of chunks.values()) {
      chunk.visible = reveal.value > chunk.userData.minimumDepth - 1.6;
    }
  }
  setProgress(0);
  return { group, counts, setProgress };
}
