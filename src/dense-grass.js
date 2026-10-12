import * as THREE from 'three';
import { rand, noise2 } from './math.js';
import { bindHoverLight } from './hover-light.js';
import { LEFT_GRASS_BOUNDS, RIGHT_GRASS_BOUNDS, leftGrassClearing, rightGrassClearing } from './meadow-layout.js';

const TILE_SIZE = 10;
const POPULATIONS = [
  { count: 118000, bounds: [-7, 7, -6, 7.9], quality: 0 },
  { count: 65000, bounds: [-16, 16, -25, 7.9], quality: 1 },
  { count: 40000, bounds: [-22, 22, -40, -25], quality: 2 },
  { count: 50000, bounds: [-2.65, 2.65, -5.15, 10.55], quality: 0, seam: true },
  // A shorter overlapping layer fills the gaps below the tall stone grass.
  // It shares the same tiles and shader, with fewer blade segments.
  { count: 65000, bounds: [-4.9, 4.9, -5.15, 10.55], quality: 1, understory: true },
  { count: 52000, bounds: LEFT_GRASS_BOUNDS, quality: 0, clearing: 'left' },
  { count: 34000, bounds: LEFT_GRASS_BOUNDS, quality: 1, understory: true, clearing: 'left' },
  { count: 52000, bounds: RIGHT_GRASS_BOUNDS, quality: 0, clearing: 'right' },
  { count: 34000, bounds: RIGHT_GRASS_BOUNDS, quality: 1, understory: true, clearing: 'right' },
];

function stoneGrassProfile(x, z, hatch) {
  const crack = hatch.crackAt?.(z) ?? { x: 0, width: .12 };
  const side = x < crack.x ? -1 : 1;
  const distance = Math.abs(x - crack.x) - crack.width * .5;
  // Follow the actual jagged fracture. Different patches on each bank remove
  // the straight bare strip without planting roots in the opening itself.
  const clearance = .025
    + noise2(z * .61 + 17.4, side * 3.7 + 8.2) * .16
    + noise2(z * 2.8 + 4.6, side * 5.3 + 3.1) * .090;
  const fineEdge = (noise2(x * 8.1 + 3.7, z * 7.4 + side * 9.2) - .5) * .16;
  const fringe = THREE.MathUtils.smoothstep(distance + fineEdge, clearance - .10, clearance + .22);
  const outerFade = 1 - THREE.MathUtils.smoothstep(distance, 1.0, 2.6);
  return { distance, clearance, fringe, outerFade,
    patch: noise2(x * .40 + 27.1, z * .40 + 3.7) };
}

function bladeGeometry(quality) {
  const segments = 3 - quality;
  const positions = [], normals = [], uvs = [], lod = [], indices = [];
  for (let segment = 0; segment <= segments; segment++) {
    const height = segment / segments;
    const width = Math.pow(1 - height, 0.66) * 0.5;
    const sides = segment === segments ? [0] : [-1, 1];
    for (const side of sides) {
      positions.push(side * width, height, 0);
      normals.push(0, 0, 1);
      uvs.push(side === 0 ? 0.5 : (side + 1) / 2, height);
      lod.push(quality);
    }
  }
  for (let segment = 0; segment < segments; segment++) {
    const index = segment * 2;
    indices.push(index, index + 1, index + 2);
    if (segment < segments - 1) indices.push(index + 1, index + 3, index + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aGrassLod', new THREE.Float32BufferAttribute(lod, 1));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function grassMaterial(uniforms, viewport) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xf4efcd, roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
  });
  material.name = 'Thin grass with shaded roots and sunlit tips';
  const lightingChunk = THREE.ShaderChunk.lights_fragment_begin;
  const directionalStart = lightingChunk.indexOf('#if ( NUM_DIR_LIGHTS > 0 ) && defined( RE_Direct )');
  const directionalEnd = lightingChunk.indexOf('#if ( NUM_RECT_AREA_LIGHTS > 0 )', directionalStart);
  const directCall = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );';
  const translucentDirectional = lightingChunk.slice(directionalStart, directionalEnd).replace(directCall, `${directCall}
      // directLight.color already contains the directional shadow attenuation.
      reflectedLight.directDiffuse += material.diffuseColor * directLight.color
        * pow(max(dot(-geometryNormal, directLight.direction), 0.0), 1.15)
        * pow(vGrassHeight, 1.7) * 0.32 * RECIPROCAL_PI;`);
  const translucentLighting = lightingChunk.slice(0, directionalStart)
    + translucentDirectional + lightingChunk.slice(directionalEnd);
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, {
      uGrassTime: uniforms.time,
      uGrassPointer: uniforms.pointerWorld,
      uGrassPointerActive: uniforms.pointerActive,
      uGrassRayOrigin: uniforms.pointerRayOrigin ?? { value: new THREE.Vector3(1e6, 1e6, 1e6) },
      uGrassRayDirection: uniforms.pointerRayDirection ?? { value: new THREE.Vector3(0, 0, -1) },
      uGrassPresence: uniforms.pointerPresence ?? { value: 0 },
      uGrassViewport: viewport,
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float aGrassSeed;
      attribute float aGrassLod;
      attribute float aGrassUnderstory;
      uniform float uGrassTime;
      uniform vec3 uGrassPointer;
      uniform float uGrassPointerActive;
      uniform vec3 uGrassRayOrigin;
      uniform vec3 uGrassRayDirection;
      uniform float uGrassPresence;
      uniform float uGrassViewport;
      varying float vGrassHeight;
      varying float vGrassHover;
      varying float vGrassSeed;
      struct GrassPose { vec3 position; vec3 objectNormal; float hover; };
      GrassPose evaluateGrass(vec3 p) {
        mat4 bladeWorld = modelMatrix * instanceMatrix;
        vec3 root = bladeWorld[3].xyz;
        vec3 axisX = bladeWorld[0].xyz;
        vec3 axisY = bladeWorld[1].xyz;
        vec3 axisZ = bladeWorld[2].xyz;
        float width = max(length(axisX), 0.0001);
        float height = max(length(axisY), 0.0001);
        vec3 directionX = axisX / width;
        vec3 directionY = axisY / height;
        vec3 directionZ = normalize(axisZ);
        float t = clamp(p.y, 0.0, 1.0);
        vec3 windDirection = normalize(vec3(0.94, 0.0, -0.34));
        float broadWave = sin(dot(root.xz, vec2(0.48, -0.18)) - uGrassTime * 0.72
                           + sin(dot(root.xz, vec2(0.11, 0.26))) * 0.43);
        float slowWave = sin(dot(root.xz, vec2(0.17, 0.22)) - uGrassTime * 0.43);
        float flutter = sin(uGrassTime * 1.9 + aGrassSeed * 6.283) * 0.006;
        vec3 wind = windDirection * height * (0.13 + broadWave * 0.14 + slowWave * 0.050 + flutter);
        vec3 probe = root + axisY * 0.45;
        float surfaceHover = (1.0 - smoothstep(0.15, 1.20, distance(root, uGrassPointer))) * uGrassPointerActive;
        float rayT = dot(probe - uGrassRayOrigin, uGrassRayDirection);
        vec3 rayPoint = uGrassRayOrigin + max(0.0, rayT) * uGrassRayDirection;
        float rayHover = (1.0 - smoothstep(0.10, 0.48, distance(probe, rayPoint)))
                       * uGrassPresence * step(0.0, rayT);
        float hover = max(surfaceHover, rayHover);
        vec3 pointerPoint = rayHover > surfaceHover ? rayPoint : uGrassPointer;
        vec3 away = root - pointerPoint;
        away -= directionY * dot(away, directionY);
        away /= max(length(away), 0.001);
        vec3 cursorBend = away * hover * 0.13;
        vec3 droop = -directionY * (hover * 0.032 + abs(broadWave) * height * 0.013);
        float curve = 0.08 + aGrassSeed * 0.12 + aGrassUnderstory * 0.48;
        vec3 bending = axisZ * curve + wind + cursorBend + droop;
        vec3 worldOffset = bending * t * t;
        vec3 localOffset = vec3(dot(worldOffset, directionX) / width,
          dot(worldOffset, directionY) / height,
          dot(worldOffset, directionZ) / max(length(axisZ), 0.0001));
        // Mid/far blades widen just enough to keep opaque subpixel edges stable.
        // The reduced segment count preserves coverage without alpha overdraw.
        float depth = max(0.5, -(viewMatrix * vec4(root, 1.0)).z);
        float minimumPixels = aGrassLod < 0.5 ? 0.45 : (aGrassLod < 1.5 ? 0.65 : 0.90);
        float pixelWidth = width * uGrassViewport * projectionMatrix[1][1] / (2.0 * depth);
        float widen = clamp(minimumPixels / max(pixelWidth, 0.001), 1.0, 5.0);
        GrassPose pose;
        pose.position = vec3(p.x * widen, p.y, 0.0) + localOffset;
        vec3 tangent = axisY + bending * (2.0 * t);
        vec3 worldNormal = normalize(cross(directionX, tangent));
        pose.objectNormal = vec3(dot(worldNormal, axisX), dot(worldNormal, axisY), dot(worldNormal, axisZ));
        pose.hover = hover;
        return pose;
      }`);
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `
      GrassPose grassPose = evaluateGrass(position);
      #include <beginnormal_vertex>
      objectNormal = grassPose.objectNormal;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      transformed = grassPose.position;
      vGrassHeight = clamp(position.y, 0.0, 1.0);
      vGrassHover = grassPose.hover;
      vGrassSeed = aGrassSeed;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float vGrassHeight;
      varying float vGrassHover;
      varying float vGrassSeed;`);
    bindHoverLight(shader, uniforms);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      vec3 rootColor = vec3(0.014, 0.041, 0.005);
      vec3 midColor = vec3(0.12, 0.28, 0.030);
      vec3 tipColor = mix(vec3(0.40, 0.68, 0.11), vec3(0.48, 0.76, 0.14), vGrassSeed);
      vec3 bladeColor = mix(rootColor, midColor, smoothstep(0.0, 0.46, vGrassHeight));
      bladeColor = mix(bladeColor, tipColor, smoothstep(0.36, 1.0, vGrassHeight));
      diffuseColor.rgb *= bladeColor * (0.82 + vGrassSeed * 0.32);
      float grassLight = meadowHoverLight();
      diffuseColor.rgb *= mix(vec3(1.0), vec3(1.20, 1.36, 1.12),
        grassLight * smoothstep(0.02, 0.72, vGrassHeight));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      // Match the fern's warm green hover light while retaining dark roots.
      vec3 grassHoverGlow = mix(vec3(0.54, 1.07, 0.19), vec3(1.22, 1.32, 0.33), vGrassHeight);
      grassHoverGlow *= clamp(diffuseColor.rgb * 1.8, vec3(0.12), vec3(0.90));
      totalEmissiveRadiance += grassHoverGlow * grassLight
        * (0.04 + 0.96 * pow(vGrassHeight, 1.6)) * 1.35;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', translucentLighting);
  };
  material.customProgramCacheKey = () => 'dense-grass-single-hover-v7';
  return material;
}

/** Static rooted blades; only tile LOD and visibility change on the CPU. */
export function createDenseGrass({ parent, groundHeight, uniforms, hatch, terrainHoleContains }) {
  const group = new THREE.Group();
  group.name = 'Dense thin meadow grass';
  parent.add(group);
  const hasHatch = Boolean(hatch?.contains && hatch?.left && hatch?.right);
  const owners = [{ name: 'terrain', group }];
  if (hasHatch) {
    for (const [name, half] of [['left', hatch.left], ['right', hatch.right]]) {
      const grassGroup = new THREE.Group();
      grassGroup.name = `Dense grass rooted on ${name} stone half`;
      half.add(grassGroup);
      owners.push({ name, group: grassGroup });
    }
  }
  for (const owner of owners) {
    owner.group.updateWorldMatrix(true, false);
    owner.inverse = owner.group.matrixWorld.clone().invert();
  }
  const random = rand(420938);
  const buckets = new Map();
  const counts = { grassClumps: 0, grassBlades: 0, grassNear: 0, grassMid: 0, grassFar: 0, grassTiles: 0, grassSeam: 0, grassUnderstory: 0, grassLeftClearing: 0, grassRightClearing: 0 };
  const viewport = { value: uniforms.renderResolution?.value.y ?? 1080 };
  const material = grassMaterial(uniforms, viewport);
  const shapes = [bladeGeometry(0), bladeGeometry(1), bladeGeometry(2)];

  function rootOwner(x, z, y, population, profile) {
    if (hasHatch && hatch.contains(x, z)) {
      // Grass has its own coherent patches, including sunlit bare stone between
      // fern clumps, instead of inheriting the fern canopy's shadowed root mask.
      if (profile.distance < .065) return -1;
      if (!population.seam && !population.understory && !population.clearing && profile.patch <= .55) return -1;
      if (!hatch.surfaceHeight || y <= hatch.surfaceHeight(x, z) + 0.035) {
        return hatch.leafForPoint?.(x, z) === hatch.left || (!hatch.leafForPoint && x < 0) ? 1 : 2;
      }
    }
    if (population.seam || (population.understory && !population.clearing)) return -1;
    if (terrainHoleContains?.(x, z)) return -1;
    return 0;
  }

  for (const population of POPULATIONS) {
    if((population.seam || population.understory) && !hasHatch)continue;
    let accepted = 0;
    for (let attempt = 0; accepted < population.count && attempt < population.count * 16; attempt++) {
      const x = THREE.MathUtils.lerp(population.bounds[0], population.bounds[1], random());
      const z = THREE.MathUtils.lerp(population.bounds[2], population.bounds[3], random());
      if (population.clearing && random() > (population.clearing === 'left'
        ? leftGrassClearing(x, z) : rightGrassClearing(x, z))) continue;
      const density = 0.59 + (noise2(x * 0.30, z * 0.30) - 0.5) * 0.54;
      if (random() > density) continue;
      const y = groundHeight(x, z);
      const onPlate = hasHatch && hatch.contains(x,z);
      const profile = onPlate ? stoneGrassProfile(x,z,hatch) : null;
      const ownerIndex = rootOwner(x, z, y, population, profile);
      if (ownerIndex < 0) continue;
      const onStone = ownerIndex > 0;
      if (onStone) {
        const seamDensity = population.clearing ? 1 : population.understory
          ? Math.max(profile.outerFade, THREE.MathUtils.smoothstep(profile.patch, .55, .66))
          : population.seam
          ? profile.outerFade * (.65 + noise2(x * .85 + 6.2,z * .73 + 19.1) * .35)
          : 1;
        if (random() > profile.fringe * seamDensity) continue;
      }
      const seed = random();
      const patchFringe = onStone && !population.seam && !population.understory && !population.clearing
        ? THREE.MathUtils.smoothstep(profile.patch,.55,.66) : 1;
      const edgeHeight = onStone ? .20 + .80 * Math.sqrt(profile.fringe) : 1;
      const height = population.understory
        ? (.14 + seed ** .75 * .12) * (.45 + .55 * Math.sqrt(profile?.fringe ?? 1))
        : onStone
        ? Math.max(.055,(0.24 + seed ** 0.75 * 0.18) * (.18 + .82 * Math.sqrt(patchFringe)) * edgeHeight)
        : .26 + seed ** .85 * .24;
      const width = (population.understory ? .0040 : .0030) + random() * .0030;
      const key = `${ownerIndex}:${population.quality}:${Math.floor(x / TILE_SIZE)}:${Math.floor(z / TILE_SIZE)}`;
      if (!buckets.has(key)) buckets.set(key, { ownerIndex, maximumQuality: population.quality, records: [] });
      buckets.get(key).records.push({ x, y: y + 0.003, z, height, width, seed,
        understory: population.understory ? 1 : 0, yaw: random() * Math.PI * 2 });
      accepted++;
    }
    counts.grassBlades += accepted;
    counts[['grassNear', 'grassMid', 'grassFar'][population.quality]] += accepted;
    if(population.seam)counts.grassSeam += accepted;
    if(population.understory)counts.grassUnderstory += accepted;
    if(population.clearing === 'left')counts.grassLeftClearing += accepted;
    if(population.clearing === 'right')counts.grassRightClearing += accepted;
  }

  const dummy = new THREE.Object3D(), matrix = new THREE.Matrix4();
  const tiles = [];
  for (const bucket of buckets.values()) {
    const seed = new THREE.InstancedBufferAttribute(new Float32Array(bucket.records.map(record => record.seed)), 1);
    const understory = new THREE.InstancedBufferAttribute(new Float32Array(bucket.records.map(record => record.understory)), 1);
    const geometries = shapes.map(shape => {
      const geometry = shape.clone();
      geometry.setAttribute('aGrassSeed', seed);
      geometry.setAttribute('aGrassUnderstory', understory);
      return geometry;
    });
    const mesh = new THREE.InstancedMesh(geometries[bucket.maximumQuality], material, bucket.records.length);
    mesh.name = `Thin grass ${owners[bucket.ownerIndex].name} tile ${tiles.length}`;
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.frustumCulled = true;
    bucket.records.forEach((record, index) => {
      dummy.position.set(record.x, record.y, record.z);
      dummy.rotation.set((record.seed - 0.5) * 0.09, record.yaw, (record.seed - 0.5) * 0.07);
      dummy.scale.set(record.width, record.height, record.height);
      dummy.updateMatrix();
      matrix.copy(dummy.matrix).premultiply(owners[bucket.ownerIndex].inverse);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.boundingSphere.radius += 0.72;
    owners[bucket.ownerIndex].group.add(mesh);
    tiles.push({ mesh, geometries, maximumQuality: bucket.maximumQuality, quality: bucket.maximumQuality,
      center: mesh.boundingSphere.center.clone(), radius: mesh.boundingSphere.radius });
  }
  counts.grassTiles = tiles.length;
  const stats = { activeBlades: 0, nearBlades: 0, midBlades: 0, farBlades: 0, visibleTiles: 0, triangles: 0 };
  const worldCenter = new THREE.Vector3(), sphere = new THREE.Sphere();
  const frustum = new THREE.Frustum(), projection = new THREE.Matrix4();
  function update(camera) {
    viewport.value = uniforms.renderResolution?.value.y ?? 1080;
    for (const owner of owners) owner.group.updateWorldMatrix(true, true);
    projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(projection);
    Object.keys(stats).forEach(key => { stats[key] = 0; });
    for (const tile of tiles) {
      worldCenter.copy(tile.center).applyMatrix4(tile.mesh.matrixWorld);
      const distance = worldCenter.distanceTo(camera.position);
      sphere.set(worldCenter, tile.radius);
      tile.mesh.visible = distance < 62 && frustum.intersectsSphere(sphere);
      const desired = Math.max(tile.maximumQuality, distance < 12.5 ? 0 : distance < 27 ? 1 : 2);
      const threshold = desired > tile.quality ? 1.5 : -1.5;
      const stableQuality = tile.quality === 0 && desired === 1 && distance < 12.5 + threshold ? 0
        : tile.quality === 1 && desired === 0 && distance > 12.5 + threshold ? 1
          : tile.quality === 1 && desired === 2 && distance < 27 + threshold ? 1
            : tile.quality === 2 && desired === 1 && distance > 27 + threshold ? 2 : desired;
      if (stableQuality !== tile.quality) {
        tile.quality = stableQuality;
        tile.mesh.geometry = tile.geometries[stableQuality];
      }
      if (!tile.mesh.visible) continue;
      stats.activeBlades += tile.mesh.count;
      stats[['nearBlades', 'midBlades', 'farBlades'][tile.quality]] += tile.mesh.count;
      stats.visibleTiles++;
      stats.triangles += tile.mesh.count * (5 - tile.quality * 2);
    }
  }
  group.userData.counts = counts;
  return { group, counts, stats, update };
}
