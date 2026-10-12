import * as THREE from 'three';
import { makeCrossedHerbGeometry } from './vegetation.js';
import { rand } from './math.js';
import { REFERENCE_WIDTH, REFERENCE_HEIGHT } from './responsive.js';

function addSlowWind(material, time, height, reducedMotion) {
  material.onBeforeCompile = shader => {
    shader.uniforms.uFinalTime = time;
    shader.uniforms.uFinalWind = { value: reducedMotion ? 0 : 1 };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float uFinalTime, uFinalWind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 root=vec3(0.);
      #ifdef USE_INSTANCING
        root=instanceMatrix[3].xyz;
      #endif
      float seed=root.x*3.13+root.y*1.71;
      float weight=pow(clamp(position.y/${height.toFixed(3)},0.,1.),2.);
      float breeze=sin(uFinalTime*.22+seed)+.35*sin(uFinalTime*.37+seed*1.43);
      transformed.x+=breeze*.018*weight*uFinalWind;
      transformed.z+=cos(uFinalTime*.19+seed)*.009*weight*uFinalWind;`);
  };
  material.customProgramCacheKey = () => `finale-slow-rooted-wind-${height}-${reducedMotion}`;
  return material;
}

/** Reuse meadow assets to frame the finale; no new textures or WebGL context. */
export function createFinaleGarden({ camera, fernGeometry, fernMap, atlas, time, reducedMotion }) {
  const group = new THREE.Group();
  group.name = 'Wind swept foliage at the final screen edges';
  camera.add(group);
  const random = rand(62874);
  const placements = [];
  const fernMaterial = addSlowWind(new THREE.MeshBasicMaterial({ map: fernMap, alphaMap: fernMap,
    alphaTest: .06, side: THREE.DoubleSide, color: 0xc3d8a8, fog: false, depthTest: false, depthWrite: false }), time, .26, reducedMotion);
  const herbsMaterial = addSlowWind(new THREE.MeshBasicMaterial({ map: atlas, alphaMap: atlas,
    alphaTest: .09, side: THREE.DoubleSide, color: 0xd2dfa8, fog: false, depthTest: false, depthWrite: false }), time, 1, reducedMotion);
  const ferns = new THREE.InstancedMesh(fernGeometry, fernMaterial, 8);
  ferns.name = 'Finale framing fern rosettes';
  group.add(ferns);
  for (let side of [-1, 1]) for (let index = 0; index < 4; index++) {
    placements.push({ mesh: ferns, index: placements.length, side,
      u: .99 + random() * .06, v: -.96 + index * .48, depth: 4.8 + random() * .5,
      scale: 3.2 + random() * 1.1, rotation: new THREE.Euler(.55 + random() * .25, side * (.3 + random() * .4), -side * .28) });
  }
  for (const column of [0, 1, 3, 4]) {
    const herbs = new THREE.InstancedMesh(makeCrossedHerbGeometry(column), herbsMaterial, 4);
    herbs.name = `Finale leafy stems ${column}`;
    group.add(herbs);
    let instance = 0;
    for (const side of [-1, 1]) for (let index = 0; index < 2; index++) {
      placements.push({ mesh: herbs, index: instance++, side,
        u: .92 + random() * .13, v: -1.05 + index * .80 + random() * .32,
        depth: 5.2 + random() * .6, scale: 1.65 + random() * .65,
        rotation: new THREE.Euler(0, side * (random() - .5) * .45, -side * (.10 + random() * .17)) });
    }
  }
  const transform = new THREE.Object3D();
  function resize() {
    for (const plant of placements) {
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * plant.depth;
      transform.position.set(plant.side * plant.u * halfHeight * camera.aspect,
        plant.v * halfHeight, -plant.depth);
      transform.rotation.copy(plant.rotation);
      // Match the UI's reference-frame scale when desktop aspect ratios change.
      const viewScale = Math.min(1, camera.aspect / (REFERENCE_WIDTH / REFERENCE_HEIGHT));
      const portraitScale = camera.aspect < 1 ? .5 : 1;
      transform.scale.setScalar(plant.scale * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) / Math.tan(THREE.MathUtils.degToRad(24)) * viewScale * portraitScale);
      transform.updateMatrix();
      plant.mesh.setMatrixAt(plant.index, transform.matrix);
    }
    for (const mesh of group.children) { mesh.instanceMatrix.needsUpdate = true; mesh.frustumCulled = false; mesh.renderOrder = 100; }
  }
  resize();
  group.visible = false;
  return { resize, setProgress(value) { group.visible = value > .01; }, count: placements.length };
}
