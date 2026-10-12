import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createAtmospherePass } from './postprocessing.js';
import { createEnvironment, scatterRocks, createDust } from './environment.js';
import { createVegetation } from './vegetation.js';
import { createHatch, hatchContains, hatchHeight } from './hatch.js';
import { groundHeight } from './math.js';
import './style.css';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset=false;
renderer.setClearColor(0x716f58);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc5ce89, .014);
const camera = new THREE.PerspectiveCamera(48, window.innerWidth/window.innerHeight,.1,400);
const cameraHome = new THREE.Vector3(0, 3.4, 8.9);
const lookHome = new THREE.Vector3(0, 2.25, -2.5);
camera.position.copy(cameraHome); camera.lookAt(lookHome);
scene.add(new THREE.HemisphereLight(0xa9c1b2,0x172519,.60));
scene.add(new THREE.AmbientLight(0xdce6a4,.025));
const sun = new THREE.DirectionalLight(0xffe5a2,8.0);
sun.position.set(-13,12,-9); sun.target.position.set(0,0,-3);
sun.castShadow=true; sun.shadow.mapSize.set(4096,4096);
Object.assign(sun.shadow.camera,{left:-18,right:18,top:18,bottom:-18,near:.5,far:75});
sun.shadow.bias=-.00012; sun.shadow.normalBias=.020;
scene.add(sun,sun.target);
const fill=new THREE.DirectionalLight(0x9fafbf,.12); fill.position.set(8,6,8);scene.add(fill);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const atmosphere=createAtmospherePass(composer,camera,sun);
composer.addPass(atmosphere);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),.35,.50,1.15);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const environment=createEnvironment(scene);
// The sky glow, surface shadows and volumetric light share one sun direction.
sun.position.copy(environment.sunlightDirection).multiplyScalar(36).add(sun.target.position);
const pollen=createDust(scene);

const uniforms={
  time:{value:0},pointerWorld:{value:new THREE.Vector3(1000,0,1000)},pointerActive:{value:0},
  pointerRayOrigin:{value:new THREE.Vector3()},pointerRayDirection:{value:new THREE.Vector3(0,0,-1)},pointerPresence:{value:0},
};
const pointer=new THREE.Vector2(0,0), smoothPointer=new THREE.Vector2(0,0);
const targetWorld=new THREE.Vector3(1000,0,1000), raycaster=new THREE.Raycaster();
let pointerInside=false, pointerPresence=0, visible=true, assetsReady=false, lastTime=performance.now(),averageFrameMs=16.7;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function sceneSurfaceHeight(x,z) {
  const terrain=groundHeight(x,z);
  return hatchContains(x,z)?Math.max(terrain,hatchHeight(x,z)):terrain;
}

const ktx = new KTX2Loader().setTranscoderPath('/assets/decoders/basis/').detectSupport(renderer);
const draco = new DRACOLoader().setDecoderPath('/assets/decoders/draco/');
const gltf = new GLTFLoader().setDRACOLoader(draco);
const textureLoader=new THREE.TextureLoader();
const assets='/assets/reference/';
const loadTexture=async(name,color=false)=>{
  const tex=await (name.endsWith('.ktx2')?ktx:textureLoader).loadAsync(assets+name);
  if(color) tex.colorSpace=THREE.SRGBColorSpace;
  tex.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
  return tex;
};

function normalizedGeometry(mesh) {
  const g=mesh.geometry.clone(); g.computeBoundingBox(); const b=g.boundingBox;
  g.translate(-(b.min.x+b.max.x)/2,-b.min.y,-(b.min.z+b.max.z)/2);
  return g;
}

function enhanceStone(material) {
  material.bumpMap=environment.terrainMaterial.map;
  material.bumpScale=.015;
  material.onBeforeCompile=shader=>{
    shader.uniforms.uMossMap={value:environment.terrainMaterial.map};
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec3 vStonePosition;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      vStonePosition=position;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vStonePosition;
      uniform sampler2D uMossMap;
      float stoneHash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
      float stoneNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
      float detail=stoneNoise(vStonePosition*36.);
      float vein=stoneNoise(vStonePosition*7.);
      diffuseColor.rgb*=.78+detail*.40;
      float grayStone=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(grayStone)*vec3(.71,.85,1.05),.68);
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.74,.83,.56),smoothstep(.59,.75,vein)*.45);
      vec2 mossWorld=vec2(vStonePosition.x,vStonePosition.z+2.6);
      float mossPatch=stoneNoise(vec3(mossWorld*.38,3.7))*.72+stoneNoise(vec3(mossWorld*.93,7.2))*.28;
      float mossCoverage=smoothstep(.36,.54,mossPatch)*smoothstep(.21,.36,vStonePosition.y);
      float crackClearance=smoothstep(.11,.29,abs(vStonePosition.x));
      vec3 mossColor=texture2D(uMossMap,mossWorld*.85).rgb*vec3(.82,1.07,.65);
      mossColor*=.76+detail*.45;
      diffuseColor.rgb=mix(diffuseColor.rgb,mossColor,mossCoverage*crackClearance*.95);`)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        float mossHeight=texture2D(uMossMap,mossWorld*.85).g*.018;
        vec3 mossBumpNormal=perturbNormalArb(-vViewPosition,normal,vec2(dFdx(mossHeight),dFdy(mossHeight)),faceDirection);
        normal=normalize(mix(normal,mossBumpNormal,mossCoverage*.72));`);
  };
  material.customProgramCacheKey=()=> 'moss-covered-hatch-v2';
  return material;
}

async function populate() {
  const [rockMap,rockNormal,rockRough,fernMap,fernNormal,fernAO,atlas,rockModel,foliage,stoneMap,stoneNormal,stoneRough] = await Promise.all([
    loadTexture('otherlife-rocks-diffuse-2048.ktx2',true),
    loadTexture('otherlife-rocks-normal-2048.ktx2'),
    loadTexture('otherlife-rocks-roughness-2048.ktx2'),
    loadTexture('otherlife-ferns-diffuse-1024.jpg',true),
    loadTexture('otherlife-ferns-normal-1024.ktx2'),
    loadTexture('otherlife-ferns-ao-1024.ktx2'),
    loadTexture('gladeye-pool-summer.png',true),
    gltf.loadAsync(assets+'otherlife-large-rocks.glb'),
    gltf.loadAsync(assets+'otherlife-foliage.glb'),
    textureLoader.loadAsync('/assets/stone/rock_face_03_diff_1k.jpg'),
    textureLoader.loadAsync('/assets/stone/rock_face_03_nor_gl_1k.jpg'),
    textureLoader.loadAsync('/assets/stone/rock_face_03_rough_1k.jpg'),
  ]);
  fernMap.flipY=false; fernNormal.flipY=false; fernAO.flipY=false;
  rockMap.flipY=false;rockNormal.flipY=false;rockRough.flipY=false;
  const rockMaterial=new THREE.MeshStandardMaterial({map:rockMap,normalMap:rockNormal,roughnessMap:rockRough,roughness:.96,normalScale:new THREE.Vector2(1,1),color:0xc6c2a8});
  await MeshoptSimplifier.ready;
  const rocks=[];
  rockModel.scene.traverse(m=>{
    if(m.isMesh&&rocks.length<5) {
      const geometry=normalizedGeometry(m);
      const [index]=MeshoptSimplifier.simplify(new Uint32Array(geometry.index.array),geometry.attributes.position.array,3,4200,.012,['LockBorder']);
      geometry.setIndex(new THREE.BufferAttribute(index,1));
      rocks.push(geometry);
    }
  });
  const landscapeRocks=scatterRocks(scene,rocks,rockMaterial);

  stoneMap.colorSpace=THREE.SRGBColorSpace;
  for(const map of [stoneMap,stoneNormal,stoneRough]) {map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(.9,.9);map.anisotropy=8;map.needsUpdate=true;}
  const hatchMaterial=enhanceStone(new THREE.MeshStandardMaterial({map:stoneMap,normalMap:stoneNormal,roughnessMap:stoneRough,roughness:.95,normalScale:new THREE.Vector2(.85,.85),color:0xdddbd3}));
  const hatch=createHatch(hatchMaterial);scene.add(hatch.group);
  const fernMesh=foliage.scene.getObjectByName('_9857_Var3_LOD0');
  if(!fernMesh?.isMesh) throw new Error('Fern geometry is missing');
  const fernGeometry=normalizedGeometry(fernMesh);
  const fernMaterial=new THREE.MeshStandardMaterial({map:fernMap,alphaMap:fernMap,alphaTest:.045,normalMap:fernNormal,aoMap:fernAO,aoMapIntensity:.15,color:0xe2f0bc,roughness:.88,side:THREE.DoubleSide,normalScale:new THREE.Vector2(.25,.25)});
  const vegetation=createVegetation({scene,fernGeometry,fernMaterial,atlas,groundHeight:sceneSurfaceHeight,uniforms,hatch,rockSamples:landscapeRocks.surfaceSamples});
  renderer.compile(scene,camera);
  assetsReady=true;
  // Read-only diagnostics are exposed for browser QA; there is no on-screen UI.
  window.sceneDiagnostics={ready:true,plants:vegetation.counts,hatchHalves:2,referenceAssets:true,interaction:'rooted rise, bend and warm glow',reducedMotion};
  canvas.dataset.ready='true';canvas.dataset.plants=JSON.stringify(vegetation.counts);
  canvas.dataset.revision='lighting-depth-4';canvas.dataset.particles=String(pollen.points.geometry.attributes.position.count);
  canvas.dataset.lighting='4096 sun shadows, contact occlusion, shadowed volumetric sunlight';
  canvas.dataset.composition='wide moss hatch, continuous crack';canvas.dataset.blur='corners only';
  canvas.dataset.rocks=String(landscapeRocks.placements?.length||0);
  window.sceneRig={hatch:hatch.group,left:hatch.left,right:hatch.right,logoAnchor:hatch.logoAnchor,descentTarget:hatch.descentTarget,camera};
  ktx.dispose();draco.dispose();
}

window.addEventListener('pointermove',event=>{
  pointer.set(event.clientX/window.innerWidth*2-1,1-event.clientY/window.innerHeight*2);
  pointerInside=true;
},{passive:true});
document.addEventListener('pointerleave',()=>{pointerInside=false;});
window.addEventListener('blur',()=>{pointerInside=false;});
document.addEventListener('visibilitychange',()=>{visible=!document.hidden;lastTime=performance.now();});
window.addEventListener('resize',()=>{
  camera.aspect=window.innerWidth/window.innerHeight;camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth,window.innerHeight);composer.setSize(window.innerWidth,window.innerHeight);
  atmosphere.uniforms.aspect.value=camera.aspect;
});

function updatePointer(dt) {
  smoothPointer.lerp(pointer,1-Math.exp(-4*dt));
  pointerPresence=THREE.MathUtils.damp(pointerPresence,pointerInside?1:0,6,dt);
  uniforms.pointerPresence.value=pointerPresence;
  let hit=false;
  if(pointerInside) {
    raycaster.setFromCamera(smoothPointer,camera);
    const r=raycaster.ray;
    uniforms.pointerRayOrigin.value.copy(r.origin);
    uniforms.pointerRayDirection.value.copy(r.direction);
    const difference=t=>{
      const x=r.origin.x+r.direction.x*t,z=r.origin.z+r.direction.z*t;
      return r.origin.y+r.direction.y*t-sceneSurfaceHeight(x,z);
    };
    let lo=.1, previous=difference(lo);
    for(let hi=1.1;hi<=85;hi+=1) {
      const current=difference(hi);
      if(previous>0&&current<=0) {
        let upper=hi;
        for(let i=0;i<10;i++) {
          const middle=(lo+upper)*.5;
          if(difference(middle)>0)lo=middle;else upper=middle;
        }
        const t=(lo+upper)*.5;
        r.at(t,targetWorld);
        if(uniforms.pointerActive.value<.02)uniforms.pointerWorld.value.copy(targetWorld);
        else uniforms.pointerWorld.value.lerp(targetWorld,1-Math.exp(-8*dt));
        hit=true;break;
      }
      lo=hi;previous=current;
    }
  }
  uniforms.pointerActive.value=THREE.MathUtils.damp(uniforms.pointerActive.value,hit?1:0,6,dt);
}

function render(now) {
  requestAnimationFrame(render);
  const elapsed=now-lastTime,dt=Math.min(elapsed/1000,.05);lastTime=now;
  if(!visible) return;
  updatePointer(dt);
  if(!reducedMotion) {
    uniforms.time.value+=dt;
    const influence=pointerPresence;
    camera.position.set(cameraHome.x+smoothPointer.x*.22*influence,cameraHome.y+smoothPointer.y*.09*influence,cameraHome.z);
    camera.lookAt(lookHome.x+smoothPointer.x*.08*influence,lookHome.y+smoothPointer.y*.035*influence,lookHome.z);
    pollen.update(uniforms.time.value,camera);
  }
  atmosphere.uniforms.tDepth.value=composer.readBuffer.depthTexture;
  atmosphere.updateLight();
  renderer.info.reset();composer.render();
  if(assetsReady) {
    const d=window.sceneDiagnostics;
    d.hover=Number(uniforms.pointerActive.value.toFixed(3));
    d.pointer=uniforms.pointerWorld.value.toArray().map(v=>Number(v.toFixed(2)));
    d.drawCalls=renderer.info.render.calls;
    d.triangles=renderer.info.render.triangles;
    d.time=Number(uniforms.time.value.toFixed(2));
    canvas.dataset.hover=String(d.hover);canvas.dataset.pointer=JSON.stringify(d.pointer);
    canvas.dataset.pointerPresence=String(Number(pointerPresence.toFixed(3)));
    canvas.dataset.drawCalls=String(d.drawCalls);canvas.dataset.triangles=String(d.triangles);
    averageFrameMs=THREE.MathUtils.lerp(averageFrameMs,elapsed,.035);
    canvas.dataset.fps=String(Math.round(1000/Math.max(1,averageFrameMs)));
  }
}
requestAnimationFrame(render);
populate().catch(error=>{console.error('Scene assets failed to initialize',error);window.sceneDiagnostics={ready:false,error:error.message};canvas.dataset.error=error.message;});
