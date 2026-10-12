import * as THREE from 'three';
import { rand, noise2 } from './math.js';

const HATCH_X = 2.58;
const HATCH_Z = 1.82;

function outsideHatch(x, z, padding = 0) {
  return (x / (HATCH_X + padding)) ** 2 + (z / (HATCH_Z + padding)) ** 2 > 1;
}

// Each plant shares one interaction value, so roots remain anchored and the
// textured fronds move as a coherent rosette instead of stretching individually.
function addPlantMotion(material, uniforms, {
  emission = 1.35, breeze = 1, diffuseBoost = 1, baseEmission = 0, heightRange = 1,
} = {}) {
  const originalCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    originalCompile?.call(material, shader, renderer);
    shader.uniforms.uPlantTime = uniforms.time;
    shader.uniforms.uPlantPointer = uniforms.pointerWorld;
    shader.uniforms.uPlantPointerActive = uniforms.pointerActive;
    shader.uniforms.uPlantRayOrigin = uniforms.pointerRayOrigin ?? { value: new THREE.Vector3(1e6, 1e6, 1e6) };
    shader.uniforms.uPlantRayDirection = uniforms.pointerRayDirection ?? { value: new THREE.Vector3(0, 0, -1) };
    shader.uniforms.uPlantPointerPresence = uniforms.pointerPresence ?? { value: 0 };
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uPlantTime;
       uniform vec3 uPlantPointer;
       uniform float uPlantPointerActive;
       uniform vec3 uPlantRayOrigin;
       uniform vec3 uPlantRayDirection;
       uniform float uPlantPointerPresence;
       varying float vPlantHover;
       varying float vPlantHeight;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 plantAnchor = modelMatrix[3].xyz;
       vec3 plantAxisX = vec3(1.0, 0.0, 0.0);
       vec3 plantScaledYAxis = vec3(0.0, 1.0, 0.0);
       vec3 plantAxisZ = vec3(0.0, 0.0, 1.0);
       #ifdef USE_INSTANCING
         plantAnchor = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
         plantAxisX = normalize((modelMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xyz);
         plantScaledYAxis = (modelMatrix * vec4(instanceMatrix[1].xyz, 0.0)).xyz;
         plantAxisZ = normalize((modelMatrix * vec4(instanceMatrix[2].xyz, 0.0)).xyz);
       #endif
       vec2 pointerDelta = plantAnchor.xz - uPlantPointer.xz;
       float pointerDistance = length(pointerDelta);
       float surfaceHover = (1.0 - smoothstep(0.15, 1.25, pointerDistance)) * uPlantPointerActive;
       vec3 plantProbe = plantAnchor + plantScaledYAxis * (0.40 * ${heightRange.toFixed(3)});
       float rayT = dot(plantProbe - uPlantRayOrigin, uPlantRayDirection);
       vec3 closestRayPoint = uPlantRayOrigin + max(0.0, rayT) * uPlantRayDirection;
       float rayHover = (1.0 - smoothstep(0.20, 0.85, distance(plantProbe, closestRayPoint)))
                      * uPlantPointerPresence * step(0.0, rayT);
       float plantHover = max(surfaceHover, rayHover);
       if (rayHover > surfaceHover) {
         pointerDelta = plantAnchor.xz - closestRayPoint.xz;
         pointerDistance = length(pointerDelta);
       }
       vPlantHover = plantHover;
       float plantHeight = clamp(position.y / ${heightRange.toFixed(3)}, 0.0, 1.0);
       vPlantHeight = plantHeight;
       float rootedWeight = plantHeight * plantHeight;
       float seed = dot(plantAnchor.xz, vec2(2.17, 3.63));
       float windWave = sin(uPlantTime * 0.78 + seed * 0.31)
                      + 0.42 * sin(uPlantTime * 1.57 + seed * 0.79);
       float tipFlutter = sin(uPlantTime * 2.1 + seed) * 0.014;
       transformed.xz *= 1.0 + plantHover * 0.12;
       transformed.y *= 1.0 + plantHover * 0.33;
       transformed.x += (windWave * 0.046 + tipFlutter) * rootedWeight * ${breeze.toFixed(3)};
       transformed.z += cos(uPlantTime * 0.67 + seed * 0.43) * 0.032 * rootedWeight * ${breeze.toFixed(3)};
       vec3 awayWorld = vec3(pointerDelta.x, 0.0, pointerDelta.y) / max(pointerDistance, 0.001);
       vec2 awayLocal = vec2(dot(awayWorld, plantAxisX), dot(awayWorld, plantAxisZ));
       transformed.xz += awayLocal * plantHover * rootedWeight * 0.35;`,
    );
    if (emission > 0) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <common>',
        `#include <common>
         varying float vPlantHover;
         varying float vPlantHeight;`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         diffuseColor.rgb *= ${diffuseBoost.toFixed(3)}
             * mix(vec3(1.0), vec3(1.16, 1.28, 1.05), vPlantHover);`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         totalEmissiveRadiance += diffuseColor.rgb * ${baseEmission.toFixed(3)};
         vec3 hoverGlow = mix(vec3(0.54, 1.07, 0.19), vec3(1.22, 1.32, 0.33), vPlantHeight);
         hoverGlow *= clamp(diffuseColor.rgb * 1.8, vec3(0.12), vec3(0.90));
         totalEmissiveRadiance += hoverGlow * vPlantHover
             * (0.10 + 0.90 * pow(vPlantHeight, 1.6)) * ${emission.toFixed(3)};`,
      );
    }
  };
  material.customProgramCacheKey = () => `rooted-meadow-${emission}-${breeze}-${diffuseBoost}-${baseEmission}-${heightRange}`;
  material.needsUpdate = true;
  return material;
}

function makeCrossedHerbGeometry(column, atlasRow = 5) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];
  // Two intersecting, segmented cards retain actual depth when the camera moves.
  const inset = 0.0025;
  for (let plane = 0; plane < 2; plane++) {
    const offset = positions.length / 3;
    const angle = plane * Math.PI / 2;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    for (let row = 0; row <= 4; row++) {
      const height = row / 4;
      for (let side = 0; side < 2; side++) {
        const width = side - 0.5;
        positions.push(width * dx, height, width * dz);
        normals.push(-dz, 0, dx);
        uvs.push(
          column / 8 + inset + side * (1 / 8 - inset * 2),
          1 - (atlasRow + 1) / 7 + inset + height * (1 / 7 - inset * 2),
        );
      }
    }
    for (let row = 0; row < 4; row++) {
      const i = offset + row * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function makeGrassTuft() {
  const random = rand(982137);
  const positions = [];
  const colors = [];
  const indices = [];
  const rootColor = new THREE.Color(0x334818);
  const tipColor = new THREE.Color(0x8b9b42);
  const color = new THREE.Color();
  for (let blade = 0; blade < 7; blade++) {
    const angle = blade * 2.399963 + random() * 0.42;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const height = 0.45 + random() * 0.55;
    const radius = random() * 0.16;
    const width = 0.025 + random() * 0.025;
    const bend = 0.18 + random() * 0.24;
    const baseIndex = positions.length / 3;
    for (let segment = 0; segment <= 3; segment++) {
      const progress = segment / 3;
      const sideWidth = width * (1 - progress * 0.95);
      color.copy(rootColor).lerp(tipColor, progress * 0.85);
      for (let side = -1; side <= 1; side += 2) {
        const outward = radius + progress * progress * bend;
        positions.push(
          dx * outward - dz * sideWidth * side,
          height * progress,
          dz * outward + dx * sideWidth * side,
        );
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let segment = 0; segment < 3; segment++) {
      const i = baseIndex + segment * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function makeMossRosette() {
  const random = rand(741023);
  const positions = [];
  const colors = [];
  const indices = [];
  const rootColor = new THREE.Color(0x3e601c);
  const leafColor = new THREE.Color();
  const color = new THREE.Color();
  // Fine pointed leaves form a low, irregular carpet instead of large clover.
  for (let leaf = 0; leaf < 8; leaf++) {
    const angle = leaf * 2.399963 + random() * 0.54;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const length = 0.34 + random() * 0.22;
    const halfWidth = 0.040 + random() * 0.035;
    const leafLift = 0.33 + random() * 0.32;
    const baseIndex = positions.length / 3;
    leafColor.setHSL(0.22 + random() * 0.095, 0.42 + random() * 0.15, 0.32 + random() * 0.095);
    for (let segment = 0; segment <= 4; segment++) {
      const progress = segment / 4;
      const roundWidth = Math.sin(progress * Math.PI) ** 1.1 * halfWidth + 0.002;
      const outward = 0.025 + progress * length;
      // The leaf arches upward before gently turning its pointed tip down.
      const lift = Math.sin(progress * Math.PI * 0.77) * leafLift;
      color.copy(rootColor).lerp(leafColor, Math.min(1, progress * 1.5));
      for (let side = -1; side <= 1; side += 2) {
        positions.push(dx * outward - dz * roundWidth * side, lift, dz * outward + dx * roundWidth * side);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let segment = 0; segment < 4; segment++) {
      const i = baseIndex + segment * 2;
      indices.push(i, i + 1, i + 2, i + 1, i + 3, i + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

export function createVegetation({
  scene, fernGeometry, fernMaterial, atlas, groundHeight, uniforms, hatch, rockSamples = [],
}) {
  const group = new THREE.Group();
  group.name = 'living-meadow';
  scene.add(group);
  const random = rand(301824);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const counts = {
    ferns: 0, herbs: 0, flowers: 0, grassClumps: 0, mossClumps: 0,
    onHatchPlants: 0, onRockPlants: 0, tallHatchPlants: 0, tallRockPlants: 0, fernVertices: 0,
  };
  let herbSurface;
  let flowerSurface;
  const hasHatchSurface = Boolean(hatch?.contains && hatch?.left && hatch?.right);
  const hatchGroups = hasHatchSurface ? [new THREE.Group(), new THREE.Group()] : null;
  if (hatchGroups) {
    hatchGroups[0].name = 'left-stone-vegetation';
    hatchGroups[1].name = 'right-stone-vegetation';
    hatch.left.add(hatchGroups[0]);
    hatch.right.add(hatchGroups[1]);
  }

  function plantAllowed(x, z, padding = 0) {
    if (!hasHatchSurface) return outsideHatch(x, z, padding);
    if (!hatch.contains(x, z)) return true;
    if (Math.abs(x) < 0.17 + padding) return false;
    // Shared slow noise creates coherent stone clearings across all species.
    // Plants on their edges soften the boundaries, leaving roughly a third of
    // the plate visible instead of filling every available square centimetre.
    const coverage = noise2(x * 0.36 + 12.7, z * 0.36 + 8.3);
    return coverage > 0.46;
  }

  function attachToSurfaces(mesh) {
    if (!hasHatchSurface) return;
    const buckets = [[], [], []];
    const matrix = new THREE.Matrix4();
    const color = new THREE.Color();
    mesh.updateWorldMatrix(true, false);
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      const world = matrix.clone().premultiply(mesh.matrixWorld);
      const x = world.elements[12], z = world.elements[14];
      const onHatch = hatch.contains(x, z)
        && (!hatch.surfaceHeight || groundHeight(x, z) <= hatch.surfaceHeight(x, z) + 0.035);
      const half = onHatch ? hatch.leafForPoint?.(x, z) : null;
      const bucket = onHatch ? (half === hatch.left ? 1 : half === hatch.right ? 2 : x < 0 ? 1 : 2) : 0;
      mesh.getColorAt(index, color);
      buckets[bucket].push({ matrix: world, color: color.clone() });
      if (onHatch) counts.onHatchPlants++;
    }
    group.remove(mesh);
    for (let bucket = 0; bucket < buckets.length; bucket++) {
      const instances = buckets[bucket];
      if (!instances.length) continue;
      const parent = bucket === 0 ? group : hatchGroups[bucket - 1];
      parent.updateWorldMatrix(true, false);
      const inverseParent = parent.matrixWorld.clone().invert();
      const partition = new THREE.InstancedMesh(mesh.geometry, mesh.material, instances.length);
      partition.name = `${mesh.name}-${bucket === 0 ? 'terrain' : bucket === 1 ? 'left-plate' : 'right-plate'}`;
      partition.receiveShadow = mesh.receiveShadow;
      partition.castShadow = mesh.castShadow;
      partition.customDepthMaterial = mesh.customDepthMaterial;
      partition.frustumCulled = false;
      for (let index = 0; index < instances.length; index++) {
        partition.setMatrixAt(index, instances[index].matrix.premultiply(inverseParent));
        partition.setColorAt(index, instances[index].color);
      }
      partition.instanceMatrix.needsUpdate = true;
      partition.instanceColor.needsUpdate = true;
      parent.add(partition);
    }
  }

  function setPlant(mesh, index, { x, z, height, width = 1, lean = 0.10, color = 0xe3eccb }) {
    dummy.position.set(x, groundHeight(x, z) + 0.006, z);
    dummy.rotation.set((random() - 0.5) * lean, random() * Math.PI * 2, (random() - 0.5) * lean);
    dummy.scale.set(height * width, height, height * width);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    tint.set(color).multiplyScalar(0.86 + random() * 0.22);
    mesh.setColorAt(index, tint);
  }

  function scatter(amount, bounds, callback, {
    padding = 0, clustered = true, centralOpening = false, flowerClusters,
  } = {}) {
    let planted = 0;
    for (let attempt = 0; planted < amount && attempt < amount * 45; attempt++) {
      const center = flowerClusters?.[Math.floor(random() * flowerClusters.length)];
      const x = center ? center.x + (random() + random() - 1) * center.radius
                       : bounds[0] + random() * (bounds[1] - bounds[0]);
      const z = center ? center.z + (random() + random() - 1) * center.radius
                       : bounds[2] + random() * (bounds[3] - bounds[2]);
      if (x < bounds[0] || x > bounds[1] || z < bounds[2] || z > bounds[3]) continue;
      if (!plantAllowed(x, z, padding)) continue;
      const density = Math.max(0.16, Math.min(0.94,
        0.56 + (noise2(x * 0.30, z * 0.30) * 2 - 1) * 0.32
             + (noise2(x * 0.83 + 20, z * 0.83) * 2 - 1) * 0.15,
      ));
      if (clustered && random() > density) continue;
      if (centralOpening && z < -4 && Math.abs(x) < 1.7 && random() > 0.28) continue;
      callback(planted++, x, z);
    }
    return planted;
  }

  const fern = fernGeometry.clone();
  fern.computeBoundingBox();
  const box = fern.boundingBox;
  const fullHeight = Math.max(0.001, box.max.y - box.min.y);
  fern.translate(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2);
  fern.scale(1 / fullHeight, 1 / fullHeight, 1 / fullHeight);
  fern.computeBoundingBox();
  fern.computeBoundingSphere();
  const vertexCount = fern.getAttribute('position').count;
  const fernCount = Math.min(3500, Math.floor(3_650_000 / vertexCount));
  const fernSurface = addPlantMotion(fernMaterial.clone(), uniforms, {
    diffuseBoost: 1.8, baseEmission: 0.3,
  });
  fernSurface.side = THREE.DoubleSide;
  const fernMesh = new THREE.InstancedMesh(fern, fernSurface, fernCount);
  fernMesh.name = 'otherlife-ferns';
  fernMesh.receiveShadow = true;
  fernMesh.castShadow = true;
  fernMesh.frustumCulled = false;
  const fernDepth = new THREE.MeshDepthMaterial({
    depthPacking: THREE.RGBADepthPacking,
    map: fernSurface.map,
    alphaMap: fernSurface.alphaMap,
    alphaTest: fernSurface.alphaTest,
    side: THREE.DoubleSide,
  });
  fernMesh.customDepthMaterial = addPlantMotion(fernDepth, uniforms, { emission: 0 });
  group.add(fernMesh);

  let fernIndex = 0;
  const multiplier = fernCount / 3500;
  // Small irregular rosettes give the hatch a soft overgrown perimeter.
  const rimCount = Math.round(350 * multiplier);
  for (let index = 0; index < rimCount; index++) {
    const angle = random() * Math.PI * 2;
    const radius = 0.80 + random() * 0.27;
    const x = Math.cos(angle) * (hasHatchSurface ? 7.6 : HATCH_X + 0.18) * radius;
    const z = Math.sin(angle) * (hasHatchSurface ? 8.1 : HATCH_Z + 0.18) * radius + (hasHatchSurface ? 2.6 : 0);
    if (!plantAllowed(x, z, 0.50)) continue;
    const front = z > 0 && Math.abs(x) < 2.5;
    setPlant(fernMesh, fernIndex++, {
      x, z,
      height: front ? 0.08 + random() * 0.11 : 0.15 + random() * 0.20,
      width: 0.82 + random() * 0.40,
    });
  }

  const foregroundCount = Math.round(150 * multiplier);
  for (let index = 0; index < foregroundCount; index++) {
    const side = random() > 0.5 ? 1 : -1;
    const x = side * (3.5 + random() * 3.0);
    const z = -3.0 + random() * 7.0;
    if (!plantAllowed(x, z, 0.80)) continue;
    setPlant(fernMesh, fernIndex++, {
      x, z,
      height: 0.60 + random() * 0.50,
      width: 0.86 + random() * 0.25,
      color: 0xd1e1b6,
      lean: 0.16,
    });
  }

  const midCount = Math.round(2100 * multiplier);
  fernIndex += scatter(midCount, [-13.0, 13.0, -18.0, 7.5], (index, x, z) => {
    const frontCenter = z > 1.5 && Math.abs(x) < 3.15;
    setPlant(fernMesh, fernIndex + index, {
      x, z,
      height: frontCenter ? 0.065 + random() * 0.11 : 0.115 + random() ** 1.6 * 0.31,
      width: 0.84 + random() * 0.34,
    });
  }, { padding: 0.60, centralOpening: true });

  const backCount = fernCount - fernIndex;
  fernIndex += scatter(backCount, [-22, 22, -40, -10], (index, x, z) => {
    setPlant(fernMesh, fernIndex + index, {
      x, z,
      height: 0.17 + random() * 0.32,
      width: 0.92 + random() * 0.36,
      color: 0xc6d8ab,
    });
  }, { centralOpening: true });
  fernMesh.count = fernIndex;
  fernMesh.instanceMatrix.needsUpdate = true;
  fernMesh.instanceColor.needsUpdate = true;
  counts.ferns = fernIndex;
  counts.fernVertices = fernIndex * vertexCount;
  attachToSurfaces(fernMesh);

  // Green herbs use row five; stemmed wildflowers use the blossom rows below.
  if (atlas) {
    herbSurface = addPlantMotion(new THREE.MeshStandardMaterial({
      map: atlas,
      color: 0xe6edc9,
      alphaTest: 0.42,
      side: THREE.DoubleSide,
      roughness: 0.88,
      metalness: 0,
    }), uniforms, { emission: 1.25, breeze: 1.2, diffuseBoost: 1.8, baseEmission: 0.3 });
    for (let column = 0; column < 8; column++) {
      const herbs = new THREE.InstancedMesh(makeCrossedHerbGeometry(column), herbSurface, 150);
      herbs.name = `gladeye-green-${column}`;
      herbs.receiveShadow = true;
      herbs.frustumCulled = false;
      herbs.count = scatter(150, [-12, 12, -19, 7], (index, x, z) => {
        const frontCenter = z > 1.8 && Math.abs(x) < 3.2;
        setPlant(herbs, index, {
          x, z,
          height: frontCenter ? 0.09 + random() * 0.14 : 0.19 + random() ** 1.8 * 0.55,
          width: 0.84 + random() * 0.30,
          lean: 0.08,
          color: 0xe7edcf,
        });
      }, { padding: 0.38, centralOpening: true });
      herbs.instanceMatrix.needsUpdate = true;
      herbs.instanceColor.needsUpdate = true;
      counts.herbs += herbs.count;
      group.add(herbs);
      attachToSurfaces(herbs);
    }

    flowerSurface = addPlantMotion(new THREE.MeshStandardMaterial({
      map: atlas,
      color: 0xfff8de,
      alphaTest: 0.38,
      side: THREE.DoubleSide,
      roughness: 0.82,
      metalness: 0,
    }), uniforms, { emission: 0.85, breeze: 1.30, diffuseBoost: 1.3, baseEmission: 0.38 });
    // All selected cells include stems: yellow narcissus and small white daisies,
    // with restrained pink/purple accents. The 1050 instances follow 60:25:15.
    const flowerCells = [
      { row: 0, column: 1, amount: 126 },
      { row: 3, column: 4, amount: 126 },
      { row: 3, column: 5, amount: 126 },
      { row: 3, column: 6, amount: 126 },
      { row: 3, column: 7, amount: 126 },
      { row: 2, column: 7, amount: 88 },
      { row: 4, column: 5, amount: 88 },
      { row: 4, column: 6, amount: 88 },
      { row: 0, column: 4, amount: 39 },
      { row: 0, column: 5, amount: 39 },
      { row: 1, column: 3, amount: 39 },
      { row: 1, column: 5, amount: 39 },
    ];
    for (const cell of flowerCells) {
      const flowerClusters = [];
      const yellowOrWhite = cell.row === 3 || (cell.row === 0 && cell.column === 1)
        || (cell.row === 2 && cell.column === 7) || cell.row === 4;
      if (yellowOrWhite) {
        // Shared clusters make mixed white/yellow blossoms readable along the
        // stone's side borders without filling the exposed stone clearings.
        for (const side of [-1, 1]) {
          for (const z of [-4, -1, 2]) {
            flowerClusters.push({
              x: side * 3.5 + (random() - 0.5) * 0.24,
              z: z + (random() - 0.5) * 0.24,
              radius: 0.52 + random() * 0.24,
            });
          }
          flowerClusters.push({ x: side * 5, z: -7, radius: 0.66 });
        }
      }
      const randomClusterCount = yellowOrWhite ? 10 : 18;
      for (let index = 0; index < randomClusterCount; index++) {
        flowerClusters.push({
          x: -10.5 + random() * 21,
          z: -16 + random() * 22,
          radius: 0.35 + random() * 0.80,
        });
      }
      const flowers = new THREE.InstancedMesh(makeCrossedHerbGeometry(cell.column, cell.row), flowerSurface, cell.amount);
      flowers.name = `wildflowers-${cell.row}-${cell.column}`;
      flowers.receiveShadow = true;
      flowers.frustumCulled = false;
      flowers.count = scatter(cell.amount, [-11.5, 11.5, -18, 7], (index, x, z) => {
        const foreground = z > -4.5;
        setPlant(flowers, index, {
          x, z,
          height: (foreground ? 0.26 : 0.24) + random() ** 1.4 * (foreground ? 0.29 : 0.26),
          width: 0.90 + random() * 0.20,
          lean: 0.12,
          color: 0xffffff,
        });
      }, { padding: 0.30, clustered: false, flowerClusters });
      flowers.instanceMatrix.needsUpdate = true;
      flowers.instanceColor.needsUpdate = true;
      counts.flowers += flowers.count;
      group.add(flowers);
      attachToSurfaces(flowers);
    }
  }

  const grassSurface = addPlantMotion(new THREE.MeshStandardMaterial({
    color: 0xe4ebcc,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 1,
    metalness: 0,
  }), uniforms, { emission: 0.45, breeze: 1.3 });
  const grass = new THREE.InstancedMesh(makeGrassTuft(), grassSurface, 6500);
  grass.name = 'meadow-micro-grass';
  grass.receiveShadow = true;
  grass.frustumCulled = false;
  grass.count = scatter(6500, [-16, 16, -25, 7.9], (index, x, z) => {
    const height = 0.12 + random() ** 1.5 * 0.33;
    setPlant(grass, index, {
      x, z, height,
      width: 0.90 + random() * 0.80,
      color: random() < 0.20 ? 0xb9c394 : 0xe0e7c4,
    });
  }, { padding: 0.43 });
  grass.instanceMatrix.needsUpdate = true;
  grass.instanceColor.needsUpdate = true;
  counts.grassClumps = grass.count;
  group.add(grass);
  attachToSurfaces(grass);

  const mossSurface = addPlantMotion(new THREE.MeshStandardMaterial({
    color: 0xf0f2d8,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.91,
    metalness: 0,
  }), uniforms, { emission: 0.60, breeze: 0.48, baseEmission: 0.12, heightRange: 0.68 });
  const moss = new THREE.InstancedMesh(makeMossRosette(), mossSurface, 3300);
  moss.name = 'fine-leaf-moss-carpet';
  moss.receiveShadow = true;
  moss.frustumCulled = false;
  moss.count = scatter(3300, [-10, 10, -12, 7], (index, x, z) => {
    const height = 0.04 + random() * 0.05;
    const diameterScale = 0.14 + random() * 0.15;
    setPlant(moss, index, {
      x, z, height,
      width: diameterScale / height,
      lean: 0.035,
      color: random() < 0.24 ? 0xc8df9c : 0xe0edb8,
    });
  }, { padding: 0.16 });
  moss.instanceMatrix.needsUpdate = true;
  moss.instanceColor.needsUpdate = true;
  counts.mossClumps = moss.count;
  group.add(moss);
  attachToSurfaces(moss);

  if (hasHatchSurface) {
    const tallCenters = [];
    for (let attempt = 0; tallCenters.length < 18 && attempt < 500; attempt++) {
      const side = attempt % 2 === 0 ? -1 : 1;
      const x = side * (1.65 + random() * 3.0);
      const z = -3.7 + random() * 7.4;
      if (!hatch.contains(x, z) || !plantAllowed(x, z, 0.55)) continue;
      if (hatch.surfaceHeight && groundHeight(x, z) > hatch.surfaceHeight(x, z) + 0.035) continue;
      tallCenters.push({ x, z, radius: 0.42 + random() * 0.36 });
    }

    function tallHatchPoints(amount, isFern) {
      const points = [];
      for (let attempt = 0; points.length < amount && attempt < amount * 100 && tallCenters.length; attempt++) {
        const center = tallCenters[Math.floor(random() * tallCenters.length)];
        const x = center.x + (random() + random() - 1) * center.radius;
        const z = center.z + (random() + random() - 1) * center.radius;
        const height = 0.60 + random() ** 0.8 * 0.60 + (!isFern && points.length % 18 === 0 ? 0.10 : 0);
        const width = isFern ? 0.65 + random() * 0.18 : 0.74 + random() * 0.28;
        const footprint = height * width * (isFern ? 1.15 : 0.55);
        if (Math.abs(x) < Math.max(1.4, 0.50 + footprint * 1.12) || Math.abs(x) > 4.8 || z < -4 || z > 4) continue;
        if (!hatch.contains(x, z) || !plantAllowed(x, z, 0.55)) continue;
        if (hatch.surfaceHeight && groundHeight(x, z) > hatch.surfaceHeight(x, z) + 0.035) continue;
        points.push({ x, z, height, width, lean: 0.12, color: 0xe0edbb });
      }
      return points;
    }

    const tallFernPoints = tallHatchPoints(136, true);
    if (tallFernPoints.length) {
      const tallFerns = new THREE.InstancedMesh(fern, fernSurface, tallFernPoints.length);
      tallFerns.name = 'tall-hatch-fern-patches';
      tallFerns.receiveShadow = true;
      tallFerns.frustumCulled = false;
      tallFernPoints.forEach((point, index) => setPlant(tallFerns, index, point));
      tallFerns.instanceMatrix.needsUpdate = true;
      tallFerns.instanceColor.needsUpdate = true;
      group.add(tallFerns);
      counts.ferns += tallFernPoints.length;
      counts.fernVertices += tallFernPoints.length * vertexCount;
      counts.tallHatchPlants += tallFernPoints.length;
      attachToSurfaces(tallFerns);
    }
    if (atlas) {
      const tallHerbPoints = tallHatchPoints(120, false);
      const columns = [0, 1, 2, 3, 4, 7];
      columns.forEach((column, columnIndex) => {
        const points = tallHerbPoints.filter((_, index) => index % columns.length === columnIndex);
        if (!points.length) return;
        const tallHerbs = new THREE.InstancedMesh(makeCrossedHerbGeometry(column), herbSurface, points.length);
        tallHerbs.name = `tall-hatch-leafy-stems-${column}`;
        tallHerbs.receiveShadow = true;
        tallHerbs.frustumCulled = false;
        points.forEach((point, index) => setPlant(tallHerbs, index, point));
        tallHerbs.instanceMatrix.needsUpdate = true;
        tallHerbs.instanceColor.needsUpdate = true;
        group.add(tallHerbs);
        counts.herbs += points.length;
        counts.tallHatchPlants += points.length;
        attachToSurfaces(tallHerbs);
      });
    }
  }

  // Samples come from the actual transformed boulder surfaces. Deduplication
  // spreads the small rooted clusters rather than stacking plants on vertices.
  const rockCells = new Map();
  for (const sample of rockSamples) {
    if (!sample.position || !sample.normal || sample.normal.y <= 0.30 || sample.moss <= 0.45) continue;
    const position = sample.position;
    const cell = `${Math.floor(position.x / 0.20)},${Math.floor(position.y / 0.20)},${Math.floor(position.z / 0.20)}`;
    if (!rockCells.has(cell)) rockCells.set(cell, sample);
  }
  const eligibleRocks = [...rockCells.values()];
  for (let index = eligibleRocks.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [eligibleRocks[index], eligibleRocks[other]] = [eligibleRocks[other], eligibleRocks[index]];
  }
  const rockPlants = eligibleRocks.slice(0, 220);
  const up = new THREE.Vector3(0, 1, 0);
  const alignment = new THREE.Quaternion();
  const yaw = new THREE.Quaternion();

  function placeOnRock(mesh, index, sample, minHeight, maxHeight, tall = false) {
    const scale = tall ? 1 : THREE.MathUtils.clamp(sample.rockScale ?? 1, 0.65, 1.35);
    const height = (minHeight + random() * (maxHeight - minHeight)) * scale;
    const normal = sample.normal.clone().normalize();
    dummy.position.copy(sample.position).addScaledVector(normal, 0.02);
    alignment.setFromUnitVectors(up, normal);
    yaw.setFromAxisAngle(up, random() * Math.PI * 2);
    dummy.quaternion.copy(alignment).multiply(yaw);
    const width = height * (tall ? 0.74 + random() * 0.22 : 0.85 + random() * 0.20);
    dummy.scale.set(width, height, width);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    tint.set(0xecf2d3).multiplyScalar(0.91 + random() * 0.15);
    mesh.setColorAt(index, tint);
  }

  function populateRockBatch(name, geometry, material, samples, minHeight, maxHeight, tall = false) {
    if (!samples.length) return null;
    const mesh = new THREE.InstancedMesh(geometry, material, samples.length);
    mesh.name = name;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    samples.forEach((sample, index) => placeOnRock(mesh, index, sample, minHeight, maxHeight, tall));
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
    counts.onRockPlants += samples.length;
    if (tall) counts.tallRockPlants += samples.length;
    return mesh;
  }

  const rockFernSamples = rockPlants.filter((_, index) => !atlas || index % 10 < 5);
  populateRockBatch('boulder-rooted-ferns', fern, fernSurface, rockFernSamples, 0.075, 0.165);
  counts.ferns += rockFernSamples.length;
  counts.fernVertices += rockFernSamples.length * vertexCount;
  if (atlas && rockPlants.length) {
    const rockHerbSamples = rockPlants.filter((_, index) => index % 10 >= 5 && index % 10 < 7);
    for (let column = 0; column < 4; column++) {
      const samples = rockHerbSamples.filter((_, index) => index % 4 === column);
      populateRockBatch(`boulder-rooted-herbs-${column}`, makeCrossedHerbGeometry(column + 1), herbSurface, samples, 0.08, 0.20);
      counts.herbs += samples.length;
    }
    const rockFlowerSamples = rockPlants.filter((_, index) => index % 10 >= 7);
    const cells = [
      { row: 3, column: 4 }, { row: 3, column: 6 }, { row: 0, column: 1 },
      { row: 4, column: 5 }, { row: 2, column: 7 }, { row: 1, column: 5 },
    ];
    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
      const samples = rockFlowerSamples.filter((_, index) => index % cells.length === cellIndex);
      const cell = cells[cellIndex];
      populateRockBatch(`boulder-rooted-flowers-${cellIndex}`, makeCrossedHerbGeometry(cell.column, cell.row), flowerSurface, samples, 0.10, 0.23);
      counts.flowers += samples.length;
    }
  }

  const centerBackSamples = eligibleRocks.filter(sample => sample.role === 'center-back');
  const tallRockSource = centerBackSamples.length ? centerBackSamples : eligibleRocks.filter(sample =>
    Math.abs(sample.position.x) < 6.2 && sample.position.z > -16 && sample.position.z < -5,
  );
  const tallRockCells = new Map();
  for (const sample of tallRockSource) {
    const p = sample.position;
    const cell = `${Math.floor(p.x / 0.33)},${Math.floor(p.y / 0.33)},${Math.floor(p.z / 0.33)}`;
    if (!tallRockCells.has(cell)) tallRockCells.set(cell, sample);
  }
  const tallRockPoints = [...tallRockCells.values()].slice(0, 140);
  const tallRockFerns = tallRockPoints.filter((_, index) => !atlas || index % 14 < 7);
  populateRockBatch('central-boulder-tall-ferns', fern, fernSurface, tallRockFerns, 0.45, 0.95, true);
  counts.ferns += tallRockFerns.length;
  counts.fernVertices += tallRockFerns.length * vertexCount;
  if (atlas) {
    const tallRockHerbs = tallRockPoints.filter((_, index) => index % 14 >= 7 && index % 14 < 12);
    for (let column = 0; column < 5; column++) {
      const samples = tallRockHerbs.filter((_, index) => index % 5 === column);
      populateRockBatch(`central-boulder-tall-leafy-stems-${column}`, makeCrossedHerbGeometry(column), herbSurface, samples, 0.50, 1.00, true);
      counts.herbs += samples.length;
    }
    const tallRockFlowers = tallRockPoints.filter((_, index) => index % 14 >= 12);
    const flowerCells = [{ row: 3, column: 6 }, { row: 4, column: 5 }, { row: 0, column: 1 }];
    flowerCells.forEach((cell, cellIndex) => {
      const samples = tallRockFlowers.filter((_, index) => index % flowerCells.length === cellIndex);
      populateRockBatch(`central-boulder-tall-flowering-stems-${cellIndex}`, makeCrossedHerbGeometry(cell.column, cell.row), flowerSurface, samples, 0.65, 1.05, true);
      counts.flowers += samples.length;
    });
  }
  group.userData.counts = counts;
  return { group, counts };
}
