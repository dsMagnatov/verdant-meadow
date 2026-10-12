import * as THREE from 'three';
import { fbm, noise2, rand, groundHeight } from './math.js';

function mossTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(size, size);
  const random = rand(571);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const broad = fbm(x * .061, y * .061);
    const grain = noise2(x * .94, y * .94);
    const light = .43 + broad * .95 + grain * .27;
    const i = (y * size + x) * 4;
    data.data[i] = (35 + random() * 27) * light;
    data.data[i + 1] = (79 + random() * 46) * light;
    data.data[i + 2] = (15 + random() * 14) * light;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(39, 43);
  texture.anisotropy = 8;
  return texture;
}

export function createEnvironment(scene) {
  const sunlightDirection = new THREE.Vector3(-.68, .43, -.83).normalize();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(350, 40, 22), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { sunDirection: { value: sunlightDirection } },
    vertexShader: `varying vec3 vDirection;
      void main(){vDirection=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vDirection;uniform vec3 sunDirection;
      float skyHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float skyNoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(skyHash(i),skyHash(i+vec2(1.,0.)),f.x),mix(skyHash(i+vec2(0.,1.)),skyHash(i+vec2(1.,1.)),f.x),f.y);}
      float skyFbm(vec2 p){float v=0.,a=.5;for(int i=0;i<4;i++){v+=a*skyNoise(p);p=p*2.02+vec2(12.6,7.2);a*=.5;}return v;}
      void main(){
        vec3 d=normalize(vDirection);float h=d.y;
        vec3 horizon=vec3(2.25,1.94,.65);
        vec3 olive=vec3(.28,.45,.075),emerald=vec3(.013,.10,.053);
        vec3 col=mix(horizon,olive,smoothstep(-.012,.082,h));
        col=mix(col,emerald,smoothstep(.035,.235,h));
        float sunlight=max(0.,dot(d,sunDirection));
        // Broad off-frame light without an obvious sun disc.
        col+=vec3(.60,.66,.16)*pow(sunlight,12.)*(.25+smoothstep(.05,.20,h));
        float horizonGlow=exp(-pow((h-.006)*13.,2.));
        col+=vec3(.34,.36,.10)*horizonGlow;
        vec2 cloudUv=vec2(atan(d.x,-d.z)*2.2,h*8.);
        float clouds=skyFbm(cloudUv+vec2(5.7,2.));
        float haze=smoothstep(.40,.72,clouds)*(1.-smoothstep(.13,.31,h));
        col=mix(col,col+vec3(.26,.33,.11),haze*.42);
        float upperCloud=skyFbm(cloudUv*vec2(.72,1.24)+vec2(17.,3.));
        col+=vec3(.035,.075,.025)*smoothstep(.56,.78,upperCloud)*smoothstep(.06,.24,h);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  sky.name = 'Emerald sky and luminous meadow haze';
  sky.frustumCulled = false;
  sky.renderOrder = -100;
  scene.add(sky);

  const texture = mossTexture();
  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: texture, bumpMap: texture, bumpScale: .075, roughness: 1,
    vertexColors: true, color: 0xffffff,
  });
  const geometry = new THREE.PlaneGeometry(120, 128, 240, 256);
  geometry.rotateX(-Math.PI / 2);
  geometry.translate(0, 0, -48);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const dark = new THREE.Color('#78913b'), light = new THREE.Color('#c4d575');
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i);
    position.setY(i, groundHeight(x, z));
    color.copy(dark).lerp(light, fbm(x * .24 + 7, z * .24));
    color.multiplyScalar(.78 + noise2(x * 1.9, z * 1.9) * .23);
    color.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, terrainMaterial);
  ground.name = 'Living moss valley heightfield';
  ground.receiveShadow = true;
  scene.add(ground);

  // Low, broad ridges leave the luminous sky visible above the clearing.
  const ridges = new THREE.Group();
  ridges.name = 'Soft distant meadow silhouettes';
  for (let layer = 0; layer < 4; layer++) {
    const ridgeGeometry = new THREE.PlaneGeometry(220, 34, 160, 12);
    ridgeGeometry.rotateX(-Math.PI / 2);
    const p = ridgeGeometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const peak = 2.2 + fbm(x * .034 + layer * 31, layer * 5.12) * (3.1 + layer * .55);
      const crest = Math.pow(Math.max(0, Math.cos(z / 34 * Math.PI)), 1.8);
      p.setXYZ(i, x, peak * crest - 1.6, z - 79 - layer * 19);
    }
    ridgeGeometry.computeVertexNormals();
    const ridgeMaterial = new THREE.MeshStandardMaterial({
      color: new THREE.Color('#6f8838').lerp(new THREE.Color('#c3c274'), layer * .22),
      roughness: 1,
    });
    const ridge = new THREE.Mesh(ridgeGeometry, ridgeMaterial);
    ridge.name = `Hazy meadow ridge ${layer}`;
    ridges.add(ridge);
  }
  scene.add(ridges);
  return { ground, sky, terrainMaterial, ridges, sunlightDirection };
}

const rockVaryings = `
  varying vec3 vMossPosition;
  varying vec3 vMossWorldNormal;
`;
const mossFunctions = `
  float mossHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
  float mossNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
    return mix(mix(mix(mossHash(i),mossHash(i+vec3(1,0,0)),f.x),mix(mossHash(i+vec3(0,1,0)),mossHash(i+vec3(1,1,0)),f.x),f.y),
      mix(mix(mossHash(i+vec3(0,0,1)),mossHash(i+vec3(1,0,1)),f.x),mix(mossHash(i+vec3(0,1,1)),mossHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
  float mossCoverage(vec3 p,vec3 n){
    float upward=smoothstep(-.17,.65,normalize(n).y);
    float patches=mossNoise(p*5.9+vec3(8.1,3.7,1.4))*.73+mossNoise(p*18.1)*.27;
    float creases=(1.-abs(normalize(n).y))*.055;
    return smoothstep(.635,.735,patches+upward*.22+creases);
  }
  vec3 mossColor(vec3 p){
    float clumps=mossNoise(p*23.8+vec3(4.,9.,2.));
    float fine=mossNoise(p*142.);
    return mix(vec3(.035,.079,.007),vec3(.155,.255,.025),clumps)*(.55+fine*.95);
  }
`;

function prepareMossVertex(shader) {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>\n${rockVaryings}`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      vMossPosition=position;
      vec3 mossNormal=normal;
      #ifdef USE_INSTANCING
        mossNormal=mat3(instanceMatrix)*mossNormal;
      #endif
      vMossWorldNormal=normalize(mat3(modelMatrix)*mossNormal);
    `);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>\n${rockVaryings}\n${mossFunctions}`);
}

function stoneWithMoss(material) {
  const stoneMaterial = material.clone();
  stoneMaterial.onBeforeCompile = shader => {
    prepareMossVertex(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      float rockMoss=mossCoverage(vMossPosition,vMossWorldNormal);
      diffuseColor.rgb*=vec3(.56,.65,.65);
      diffuseColor.rgb=mix(diffuseColor.rgb,mossColor(vMossPosition),rockMoss*.64);
    `);
  };
  stoneMaterial.customProgramCacheKey = () => 'meadow-moss-boulder-base-v1';
  return stoneMaterial;
}

function raisedMossMaterial() {
  const bumpMap = mossTexture().clone();
  bumpMap.colorSpace = THREE.NoColorSpace;
  bumpMap.repeat.set(18, 22);
  bumpMap.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    color: 0x668e28, roughness: 1, bumpMap, bumpScale: .037, polygonOffset: true,
    polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  material.onBeforeCompile = shader => {
    prepareMossVertex(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        diffuseColor.rgb=mossColor(vMossPosition)*1.14;
      `)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
        float mossPatch=mossCoverage(vMossPosition,vMossWorldNormal);
        float mossGrain=mossNoise(vMossPosition*172.);
        if(mossPatch<.40+mossGrain*.16)discard;
      `);
  };
  material.customProgramCacheKey = () => 'meadow-raised-moss-v1';
  return material;
}

function mossShellGeometry(source) {
  const geometry = source.clone();
  const p = geometry.attributes.position, n = geometry.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const relief = .014 + noise2(x * 34.7 + y * 16.2, z * 34.7) * .017;
    p.setXYZ(i, x + n.getX(i) * relief, y + n.getY(i) * relief, z + n.getZ(i) * relief);
  }
  p.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function outsideHatch(x, z, radius = 0) {
  return Math.hypot(x / (7.6 + radius), (z - 2.6) / (8.1 + radius)) > 1.025;
}

export function scatterRocks(scene, geometries, material) {
  const random = rand(9217);
  // Large rounded masses form two deliberate groups instead of a gravel field.
  const placements = [
    { x: -6.7, z: -8.0, scale: 4.0, rotation: .30 },
    { x: -8.6, z: -6.7, scale: 3.7, rotation: 1.94 },
    { x: -4.7, z: -10.5, scale: 2.9, rotation: 2.20 },
    { x: -8.5, z: -3.5, scale: 3.2, rotation: 4.10 },
    { x: -9.6, z: -.9, scale: 3.7, rotation: .68 },
    { x: -9.7, z: -10.6, scale: 3.0, rotation: 1.15 },
    { x: -6.1, z: -11.9, scale: 2.5, rotation: 5.74 },
    { x: -8.7, z: 1.0, scale: 2.2, rotation: 3.50 },
    { x: 6.4, z: -8.9, scale: 3.8, rotation: 2.41 },
    { x: 8.6, z: -6.2, scale: 4.1, rotation: .84 },
    { x: 4.6, z: -11.1, scale: 2.7, rotation: 4.85 },
    { x: 8.8, z: -3.3, scale: 3.3, rotation: 1.34 },
    { x: 9.5, z: -.4, scale: 3.0, rotation: 2.18 },
    { x: 9.7, z: -10.3, scale: 2.6, rotation: 5.03 },
    { x: 6.9, z: -12.7, scale: 2.2, rotation: .31 },
    { x: 8.6, z: 1.0, scale: 1.9, rotation: 3.02 },
    // Nearer central banks fill the back meadow, with a low passage at x=0.
    { x: -3.05, z: -8.85, scale: 3.8, rotation: 1.16, role: 'center-back' },
    { x: -2.85, z: -11.4, scale: 3.4, rotation: 3.93, role: 'center-back' },
    { x: 3.10, z: -9.0, scale: 3.65, rotation: 2.37, role: 'center-back' },
    { x: 3.60, z: -11.8, scale: 4.0, rotation: .64, role: 'center-back' },
    { x: .35, z: -12.45, scale: 2.7, rotation: 4.80, burial: .35, role: 'center-back' },
  ];
  for (let i = 0; i < 44; i++) {
    let x, z;
    do {
      x = (random() > .5 ? 1 : -1) * (4.0 + random() * 7.4);
      z = -17.0 + random() * 18;
    } while (!outsideHatch(x, z, .55));
    placements.push({ x, z, scale: .22 + random() ** 1.9 * .86, rotation: random() * Math.PI * 2 });
  }

  const meshes = [], mossMeshes = [], surfaceSamples = [];
  const dummy = new THREE.Object3D(), shade = new THREE.Color();
  const stoneMaterial = stoneWithMoss(material), mossMaterial = raisedMossMaterial();
  const point = new THREE.Vector3(), normal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3();
  for (let index = 0; index < geometries.length; index++) {
    const spots = placements.filter((_, i) => i % geometries.length === index);
    if (!spots.length) continue;
    const geometry = geometries[index];
    const mesh = new THREE.InstancedMesh(geometry, stoneMaterial, spots.length);
    const mossMesh = new THREE.InstancedMesh(mossShellGeometry(geometry), mossMaterial, spots.length);
    mesh.name = `Rounded scanned boulders ${index}`;
    mossMesh.name = `Raised living moss on boulders ${index}`;
    mesh.userData.placements = spots;
    mossMesh.userData.placements = spots;
    spots.forEach((rock, i) => {
      const scaleY = rock.scale * (rock.role === 'center-back' ? 1.16 + random() * .16 : .79 + random() * .18);
      dummy.position.set(rock.x, groundHeight(rock.x, rock.z) - rock.scale * (rock.burial ?? .10), rock.z);
      dummy.rotation.set((random() - .5) * .10, rock.rotation, (random() - .5) * .09);
      dummy.scale.set(rock.scale * (.98 + random() * .16), scaleY, rock.scale * (.90 + random() * .16));
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      mossMesh.setMatrixAt(i, dummy.matrix);
      shade.setHSL(.15 + random() * .025, .055, .71 + random() * .12);
      mesh.setColorAt(i, shade);
      if (rock.scale < 1.25) return;
      const p = geometry.attributes.position, n = geometry.attributes.normal;
      normalMatrix.getNormalMatrix(dummy.matrix);
      // Samples stay on the actual transformed scan, ready for plant tufts.
      const stride = Math.max(1, Math.floor(p.count / 155));
      for (let vertex = index * 3; vertex < p.count; vertex += stride) {
        point.fromBufferAttribute(p, vertex).applyMatrix4(dummy.matrix);
        normal.fromBufferAttribute(n, vertex).applyMatrix3(normalMatrix).normalize();
        if (normal.y < -.05 || point.y < groundHeight(point.x, point.z) + .065) continue;
        if (!outsideHatch(point.x, point.z, -.05)) continue;
        const moss = THREE.MathUtils.clamp((normal.y + .22) * .7 + noise2(point.x * 3.2, point.z * 3.2) * .3, 0, 1);
        surfaceSamples.push({
          position: point.clone().addScaledVector(normal, .025),
          normal: normal.clone(), rockScale: rock.scale, moss, role: rock.role ?? 'side-frame',
        });
      }
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mossMesh.receiveShadow = true;
    mesh.instanceMatrix.needsUpdate = mossMesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mossMesh.computeBoundingSphere();
    scene.add(mesh, mossMesh);
    meshes.push(mesh);
    mossMeshes.push(mossMesh);
  }
  return { meshes, mossMeshes, surfaceSamples, placements };
}

export function createDust(scene) {
  const count = 1680, random = rand(42);
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count), sizes = new Float32Array(count), alphas = new Float32Array(count);
  const drifts = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = (random() - .5) * 28;
    positions[i * 3 + 1] = .4 + random() * 9.6;
    positions[i * 3 + 2] = -20 + random() * 27;
    phases[i] = random() * Math.PI * 2;
    const sizeBand = i / count;
    if (sizeBand < .70) {
      sizes[i] = .009 + random() * .016;
      alphas[i] = .46 + random() * .48;
    } else if (sizeBand < .94) {
      sizes[i] = .028 + random() * .042;
      alphas[i] = .33 + random() * .43;
    } else {
      sizes[i] = .075 + random() * .075;
      alphas[i] = .17 + random() * .18;
    }
    drifts[i] = .55 + random() * 1.05;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aDrift', new THREE.BufferAttribute(drifts, 1));
  const uniforms = { uTime: { value: 0 }, uViewport: { value: window.innerHeight } };
  const material = new THREE.ShaderMaterial({
    uniforms, transparent: true, blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: true,
    vertexShader: `attribute float aPhase;attribute float aSize;attribute float aAlpha;attribute float aDrift;
      uniform float uTime;uniform float uViewport;varying float vAlpha;varying float vSoftness;
      void main(){vec3 p=position;
        vSoftness=smoothstep(.028,.12,aSize);
        p.x+=sin(uTime*(.05+.07*aDrift)+aPhase)*(.14+.31*aDrift);
        p.z+=cos(uTime*(.05+.03*aDrift)+aPhase*1.71)*(.12+.20*aDrift);
        p.y=.4+mod(position.y-.4+uTime*(.028+.025*aDrift)*(1.-vSoftness*.45),9.6);
        p.y+=sin(uTime*.20+aPhase*.60)*.025;
        vec4 viewPosition=modelViewMatrix*vec4(p,1.);
        gl_Position=projectionMatrix*viewPosition;
        gl_PointSize=clamp(aSize*uViewport*projectionMatrix[1][1]/max(1.,-viewPosition.z),1.05,14.0);
        vAlpha=aAlpha*(.72+.28*pow(sin(uTime*(.19+.37*aDrift)+aPhase),2.));
        vAlpha*=mix(1.,.68,vSoftness);
      }`,
    fragmentShader: `varying float vAlpha;varying float vSoftness;
      void main(){vec2 p=gl_PointCoord-.5;float r=dot(p,p);
        if(r>.245)discard;
        float core=exp(-r*mix(88.,34.,vSoftness)),halo=exp(-r*mix(17.,12.,vSoftness));
        float brightness=mix(1.,.42,vSoftness);
        float edge=1.-smoothstep(.13,.245,r);
        gl_FragColor=vec4(vec3(2.05,1.43,.30)*brightness*(core+halo*.24),(core+halo*.32)*vAlpha*edge);
      }`,
  });
  const points = new THREE.Points(geometry, material);
  points.name = 'Drifting golden meadow pollen';
  points.frustumCulled = false;
  const group = new THREE.Group();
  group.name = 'Luminous meadow air';
  group.add(points);
  scene.add(group);
  const update = (time, camera) => {
    uniforms.uTime.value = time;
    uniforms.uViewport.value = window.innerHeight * Math.min(window.devicePixelRatio || 1, 1.6);
    points.userData.camera = camera;
  };
  return { group, points, update };
}
