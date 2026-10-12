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
  emission = 1.35, breeze = 1, diffuseBoost = 1, baseEmission = 0,
} = {}) {
  const originalCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    originalCompile?.call(material, shader, renderer);
    shader.uniforms.uPlantTime = uniforms.time;
    shader.uniforms.uPlantPointer = uniforms.pointerWorld;
    shader.uniforms.uPlantPointerActive = uniforms.pointerActive;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uPlantTime;
       uniform vec3 uPlantPointer;
       uniform float uPlantPointerActive;
       varying float vPlantHover;
       varying float vPlantHeight;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 plantAnchor = modelMatrix[3].xyz;
       vec3 plantAxisX = vec3(1.0, 0.0, 0.0);
       vec3 plantAxisZ = vec3(0.0, 0.0, 1.0);
       #ifdef USE_INSTANCING
         plantAnchor = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
         plantAxisX = normalize((modelMatrix * vec4(instanceMatrix[0].xyz, 0.0)).xyz);
         plantAxisZ = normalize((modelMatrix * vec4(instanceMatrix[2].xyz, 0.0)).xyz);
       #endif
       vec2 pointerDelta = plantAnchor.xz - uPlantPointer.xz;
       float pointerDistance = length(pointerDelta);
       float plantHover = (1.0 - smoothstep(0.15, 1.25, pointerDistance)) * uPlantPointerActive;
       vPlantHover = plantHover;
       float plantHeight = clamp(position.y, 0.0, 1.0);
       vPlantHeight = plantHeight;
       float rootedWeight = plantHeight * plantHeight;
       float seed = dot(plantAnchor.xz, vec2(2.17, 3.63));
       float windWave = sin(uPlantTime * 0.78 + seed * 0.31)
                      + 0.42 * sin(uPlantTime * 1.57 + seed * 0.79);
       float tipFlutter = sin(uPlantTime * 2.1 + seed) * 0.014;
       transformed *= 1.0 + plantHover * 0.12;
       transformed.x += (windWave * 0.046 + tipFlutter) * rootedWeight * ${breeze.toFixed(3)};
       transformed.z += cos(uPlantTime * 0.67 + seed * 0.43) * 0.032 * rootedWeight * ${breeze.toFixed(3)};
       vec3 awayWorld = vec3(pointerDelta.x, 0.0, pointerDelta.y) / max(pointerDistance, 0.001);
       vec2 awayLocal = vec2(dot(awayWorld, plantAxisX), dot(awayWorld, plantAxisZ));
       transformed.xz += awayLocal * plantHover * rootedWeight * 0.24;
       transformed.y -= plantHover * rootedWeight * 0.025;`,
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
         totalEmissiveRadiance += hoverGlow * vPlantHover
             * (0.18 + 0.82 * vPlantHeight) * ${emission.toFixed(3)};`,
      );
    }
  };
  material.customProgramCacheKey = () => `rooted-meadow-${emission}-${breeze}-${diffuseBoost}-${baseEmission}`;
  material.needsUpdate = true;
  return material;
}

function makeCrossedHerbGeometry(column) {
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
          1 / 7 + inset + height * (1 / 7 - inset * 2),
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
  // Six curved, broad oval leaves. Four segments keep a round silhouette at
  // close range while the complete 4500-clump carpet stays below 220k triangles.
  for (let leaf = 0; leaf < 6; leaf++) {
    const angle = leaf * 2.399963 + random() * 0.54;
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const length = 0.34 + random() * 0.22;
    const halfWidth = 0.095 + random() * 0.060;
    const leafLift = 0.55 + random() * 0.38;
    const baseIndex = positions.length / 3;
    leafColor.setHSL(0.22 + random() * 0.095, 0.42 + random() * 0.15, 0.32 + random() * 0.095);
    for (let segment = 0; segment <= 4; segment++) {
      const progress = segment / 4;
      const roundWidth = Math.sin(progress * Math.PI) ** 0.72 * halfWidth + 0.002;
      const outward = 0.025 + progress * length;
      // The leaf arches upward before gently turning its pointed tip down.
      const lift = 0.14 + Math.sin(progress * Math.PI * 0.77) * leafLift;
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

export function createVegetation({ scene, fernGeometry, fernMaterial, atlas, groundHeight, uniforms }) {
  const group = new THREE.Group();
  group.name = 'living-meadow';
  scene.add(group);
  const random = rand(301824);
  const dummy = new THREE.Object3D();
  const tint = new THREE.Color();
  const counts = { ferns: 0, herbs: 0, grassClumps: 0, mossClumps: 0, fernVertices: 0 };

  function setPlant(mesh, index, { x, z, height, width = 1, lean = 0.10, color = 0xe3eccb }) {
    dummy.position.set(x, groundHeight(x, z) + 0.006, z);
    dummy.rotation.set((random() - 0.5) * lean, random() * Math.PI * 2, (random() - 0.5) * lean);
    dummy.scale.set(height * width, height, height * width);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    tint.set(color).multiplyScalar(0.86 + random() * 0.22);
    mesh.setColorAt(index, tint);
  }

  function scatter(amount, bounds, callback, { padding = 0, clustered = true, centralOpening = false } = {}) {
    let planted = 0;
    for (let attempt = 0; planted < amount && attempt < amount * 45; attempt++) {
      const x = bounds[0] + random() * (bounds[1] - bounds[0]);
      const z = bounds[2] + random() * (bounds[3] - bounds[2]);
      if (!outsideHatch(x, z, padding)) continue;
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
    const radius = 1.05 + random() * 0.39;
    const x = Math.cos(angle) * (HATCH_X + 0.18) * radius;
    const z = Math.sin(angle) * (HATCH_Z + 0.18) * radius;
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
    const x = side * (2.8 + random() * 2.5);
    const z = 2.2 + random() * 3.6;
    setPlant(fernMesh, fernIndex++, {
      x, z,
      height: 0.40 + random() * 0.45,
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
  }, { padding: 0.13, centralOpening: true });

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

  // Only the green foliage row of Gladeye's atlas is used: no flowers.
  if (atlas) {
    const herbSurface = addPlantMotion(new THREE.MeshStandardMaterial({
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
      }, { padding: 0.12, centralOpening: true });
      herbs.instanceMatrix.needsUpdate = true;
      herbs.instanceColor.needsUpdate = true;
      counts.herbs += herbs.count;
      group.add(herbs);
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
    const height = 0.065 + random() ** 1.8 * 0.24;
    setPlant(grass, index, {
      x, z, height,
      width: 1.6 + random() * 1.8,
      color: random() < 0.20 ? 0xb9c394 : 0xe0e7c4,
    });
  }, { padding: 0.045 });
  grass.instanceMatrix.needsUpdate = true;
  grass.instanceColor.needsUpdate = true;
  counts.grassClumps = grass.count;
  group.add(grass);

  const mossSurface = addPlantMotion(new THREE.MeshStandardMaterial({
    color: 0xf0f2d8,
    vertexColors: true,
    side: THREE.DoubleSide,
    roughness: 0.91,
    metalness: 0,
  }), uniforms, { emission: 0.60, breeze: 0.48, baseEmission: 0.12 });
  const moss = new THREE.InstancedMesh(makeMossRosette(), mossSurface, 4500);
  moss.name = 'broadleaf-moss-carpet';
  moss.receiveShadow = true;
  moss.frustumCulled = false;
  moss.count = scatter(4500, [-10, 10, -12, 7], (index, x, z) => {
    const height = 0.08 + random() * 0.05;
    const diameterScale = 0.22 + random() * 0.23;
    setPlant(moss, index, {
      x, z, height,
      width: diameterScale / height,
      lean: 0.035,
      color: random() < 0.24 ? 0xc8df9c : 0xe0edb8,
    });
  }, { padding: 0.045 });
  moss.instanceMatrix.needsUpdate = true;
  moss.instanceColor.needsUpdate = true;
  counts.mossClumps = moss.count;
  group.add(moss);
  group.userData.counts = counts;
  return { group, counts };
}
