import * as THREE from 'three';
import { fbm, noise2, rand, groundHeight, smoothstep } from './math.js';

function mossTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const data = ctx.createImageData(size, size);
  const random = rand(571);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = fbm(x * .064, y * .064), speckle = random();
    const fine = noise2(x * .8, y * .8);
    const light = .52 + n * .74 + fine * .3;
    const i = (y * size + x) * 4;
    data.data[i] = (64 + speckle * 38) * light;
    data.data[i + 1] = (95 + speckle * 46) * light;
    data.data[i + 2] = (29 + speckle * 20) * light;
    data.data[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(26, 30);
  tex.anisotropy = 8;
  return tex;
}

export function createEnvironment(scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(350, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: {},
    vertexShader: `varying vec3 vDirection;
      void main(){vDirection=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader: `varying vec3 vDirection;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x),f.y);}
      float fbm(vec2 p){float v=0.,a=.5; for(int i=0;i<5;i++){v+=a*noise(p);p=p*2.03+12.6;a*=.5;}return v;}
      void main(){
        vec3 d=normalize(vDirection); float h=max(d.y,0.);
        vec3 horizon=vec3(.98,.57,.25), low=vec3(.86,.55,.39), high=vec3(.17,.31,.48);
        vec3 col=mix(horizon,low,smoothstep(0.,.12,h));
        col=mix(col,high,smoothstep(.035,.38,h));
        vec3 sunDir=normalize(vec3(-.62,.10,-1.)); float s=max(0.,dot(d,sunDir));
        col+=vec3(.35,.16,.04)*pow(s,24.);
        col+=vec3(1.,.63,.28)*smoothstep(.99973,.99988,s);
        vec2 p=vec2(atan(d.x,-d.z)*3.8,d.y*22.);
        float cloud=fbm(p*vec2(1.1,2.8)+vec2(6.,1.));
        cloud=smoothstep(.58,.73,cloud)*smoothstep(.08,.16,h)*(1.-smoothstep(.4,.6,h));
        col=mix(col,vec3(.76,.53,.50),cloud*.50);
        gl_FragColor=vec4(col,1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`
  }));
  sky.name = 'Sunset sky'; sky.frustumCulled = false; scene.add(sky);

  const tex = mossTexture();
  const terrainMaterial = new THREE.MeshStandardMaterial({
    map: tex, bumpMap: tex, bumpScale: .13, roughness: 1,
    vertexColors: true, color: 0xffffff,
  });
  const geometry = new THREE.PlaneGeometry(120, 128, 240, 256);
  geometry.rotateX(-Math.PI / 2); geometry.translate(0, 0, -48);
  const p = geometry.attributes.position;
  const colors = new Float32Array(p.count * 3);
  const dark = new THREE.Color('#a0b979'), light = new THREE.Color('#d9dfad');
  const c = new THREE.Color();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    p.setY(i, groundHeight(x,z));
    c.copy(dark).lerp(light, fbm(x * .27 + 7, z * .27));
    c.multiplyScalar(.78 + noise2(x * 1.9, z * 1.9) * .23);
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors,3));
  geometry.computeVertexNormals();
  const ground = new THREE.Mesh(geometry, terrainMaterial);
  ground.name = 'Moss valley heightfield'; ground.receiveShadow = true;
  scene.add(ground);

  // Distant rolling ridges separate the sky from the valley without a flat horizon.
  for (let layer = 0; layer < 5; layer++) {
    const g = new THREE.PlaneGeometry(210, 28, 170, 10);
    g.rotateX(-Math.PI/2);
    const a = g.attributes.position;
    for (let i = 0; i < a.count; i++) {
      const x = a.getX(i), z = a.getZ(i);
      const peak = 3 + layer * .65 + fbm(x * .042 + layer * 31, layer * 5.12) * 9.0;
      const crest = Math.pow(Math.cos(z / 28 * Math.PI),2);
      a.setXYZ(i, x, peak * crest - 1.7, z - 75 - layer * 17);
    }
    g.computeVertexNormals();
    const m = new THREE.MeshStandardMaterial({color: new THREE.Color('#7b8a66').lerp(new THREE.Color('#b3a78e'), layer*.17), roughness:1});
    const mesh = new THREE.Mesh(g,m); mesh.name = `Distant ridge ${layer}`; scene.add(mesh);
  }
  return { ground, sky, terrainMaterial };
}

export function scatterRocks(scene, geometries, material) {
  const random = rand(9217);
  const dummy = new THREE.Object3D();
  const shade = new THREE.Color();
  const placements = [];
  // Three irregular groups frame the clearing; scattered stones stitch them together.
  for (let i = 0; i < 155; i++) {
    const side = random() > .5 ? 1 : -1;
    const z = -26 + random() * 34;
    const x = side * (3.8 + random() * 11.0);
    const scale = .22 + random() ** 2 * 1.9 + (z < -7 ? .25 : 0);
    placements.push({x,z,scale,rotation:random()*Math.PI*2});
  }
  placements.push(
    {x:-5.5,z:3.2,scale:2.65,rotation:.4},
    {x:6.1,z:1.9,scale:2.45,rotation:1.3},
    {x:-6.4,z:-5.7,scale:3.3,rotation:2.8},
    {x:7.7,z:-8.4,scale:3.7,rotation:.6},
  );
  const meshes = [];
  for (let index = 0; index < geometries.length; index++) {
    const spots = placements.filter((_,i)=>i%geometries.length===index);
    const geometry = geometries[index];
    const mesh = new THREE.InstancedMesh(geometry, material, spots.length);
    mesh.name = `Scanned landscape rocks ${index}`;
    spots.forEach((rock,i)=>{
      dummy.position.set(rock.x,groundHeight(rock.x,rock.z)-.10*rock.scale,rock.z);
      dummy.rotation.set((random()-.5)*.3,rock.rotation,(random()-.5)*.25);
      dummy.scale.set(rock.scale*(.7+random()*.7),rock.scale*(.7+random()*.55),rock.scale);
      dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix);
      shade.setHSL(.13+random()*.04,.07+random()*.07,.76+random()*.2); mesh.setColorAt(i,shade);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere(); scene.add(mesh); meshes.push(mesh);
  }
  return meshes;
}

export function createDust(scene) {
  const count = 60, positions = new Float32Array(count*3), random=rand(42);
  for(let i=0;i<count;i++) {
    positions[i*3]=(random()-.5)*18;
    positions[i*3+1]=.15+random()*3;
    positions[i*3+2]=-12+random()*19;
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.BufferAttribute(positions,3));
  const material=new THREE.PointsMaterial({color:0xffe1a0,size:.014,transparent:true,opacity:.35,depthWrite:false});
  const points=new THREE.Points(geometry,material); points.name='Airborne pollen';scene.add(points);
  return points;
}
