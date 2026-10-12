import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { createDepthOfField } from './postprocessing.js';
import { createEnvironment, scatterRocks, createDust } from './environment.js';
import { createVegetation } from './vegetation.js';
import { createHatch } from './hatch.js';
import { groundHeight } from './math.js';
import './style.css';

const canvas = document.querySelector('#scene');
const renderer = new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.6));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.22;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset=false;
renderer.setClearColor(0x716f58);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb2ae94, .013);
const camera = new THREE.PerspectiveCamera(48, window.innerWidth/window.innerHeight,.1,400);
const cameraHome = new THREE.Vector3(0, 3.5, 8.9);
const lookHome = new THREE.Vector3(0, 1.7, -2.0);
camera.position.copy(cameraHome); camera.lookAt(lookHome);
scene.add(new THREE.HemisphereLight(0xc9daf0,0x606633,2.15));
scene.add(new THREE.AmbientLight(0xffe8cf,.22));
const sun = new THREE.DirectionalLight(0xffd5a3,3.5);
sun.position.set(-15,10,-8); sun.target.position.set(0,0,-3);
sun.castShadow=true; sun.shadow.mapSize.set(2048,2048);
Object.assign(sun.shadow.camera,{left:-20,right:20,top:20,bottom:-20,near:.5,far:60});
sun.shadow.bias=-.0004; sun.shadow.normalBias=.055; sun.shadow.radius=3;
scene.add(sun,sun.target);
const fill=new THREE.DirectionalLight(0xbacddc,.55); fill.position.set(8,6,8);scene.add(fill);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene,camera));
const depthOfField=createDepthOfField(composer,camera);
composer.addPass(depthOfField);
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth,window.innerHeight),.24,.45,1.1);
composer.addPass(bloom);
composer.addPass(new OutputPass());
const environment=createEnvironment(scene);
const pollen=createDust(scene);

const uniforms={time:{value:0},pointerWorld:{value:new THREE.Vector3(1000,0,1000)},pointerActive:{value:0}};
const pointer=new THREE.Vector2(0,0), smoothPointer=new THREE.Vector2(0,0);
const targetWorld=new THREE.Vector3(1000,0,1000), raycaster=new THREE.Raycaster();
let pointerInside=false, pointerPresence=0, visible=true, assetsReady=false, lastTime=performance.now(),averageFrameMs=16.7;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      varying vec3 vStonePosition;`).replace('#include <begin_vertex>',`#include <begin_vertex>
      vStonePosition=position;`);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
      varying vec3 vStonePosition;
      float stoneHash(vec3 p){return fract(sin(dot(p,vec3(12.9898,78.233,37.719)))*43758.5453);}
      float stoneNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
      return mix(mix(mix(stoneHash(i),stoneHash(i+vec3(1,0,0)),f.x),mix(stoneHash(i+vec3(0,1,0)),stoneHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(stoneHash(i+vec3(0,0,1)),stoneHash(i+vec3(1,0,1)),f.x),mix(stoneHash(i+vec3(0,1,1)),stoneHash(i+vec3(1,1,1)),f.x),f.y),f.z);}`)
      .replace('#include <color_fragment>',`#include <color_fragment>
      float detail=stoneNoise(vStonePosition*36.);
      float vein=stoneNoise(vStonePosition*7.);
      diffuseColor.rgb*=.78+detail*.40;
      diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*vec3(.74,.83,.56),smoothstep(.59,.75,vein)*.45);`);
  };
  material.customProgramCacheKey=()=> 'weathered-hatch-v1';
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
  scatterRocks(scene,rocks,rockMaterial);

  stoneMap.colorSpace=THREE.SRGBColorSpace;
  for(const map of [stoneMap,stoneNormal,stoneRough]) {map.wrapS=map.wrapT=THREE.RepeatWrapping;map.repeat.set(.9,.9);map.anisotropy=8;map.needsUpdate=true;}
  const hatchMaterial=enhanceStone(new THREE.MeshStandardMaterial({map:stoneMap,normalMap:stoneNormal,roughnessMap:stoneRough,roughness:.95,normalScale:new THREE.Vector2(.85,.85),color:0xdddbd3}));
  const hatch=createHatch(hatchMaterial);scene.add(hatch.group);
  const fernMesh=foliage.scene.getObjectByName('_9857_Var3_LOD0');
  if(!fernMesh?.isMesh) throw new Error('Fern geometry is missing');
  const fernGeometry=normalizedGeometry(fernMesh);
  const fernMaterial=new THREE.MeshStandardMaterial({map:fernMap,alphaMap:fernMap,alphaTest:.045,normalMap:fernNormal,aoMap:fernAO,aoMapIntensity:.15,color:0xe2f0bc,roughness:.88,side:THREE.DoubleSide,normalScale:new THREE.Vector2(.25,.25)});
  const vegetation=createVegetation({scene,fernGeometry,fernMaterial,atlas,groundHeight,uniforms});
  renderer.compile(scene,camera);
  assetsReady=true;
  // Read-only diagnostics are exposed for browser QA; there is no on-screen UI.
  window.sceneDiagnostics={ready:true,plants:vegetation.counts,hatchHalves:2,referenceAssets:true,interaction:'breeze, cursor bend, scale and glow',reducedMotion};
  canvas.dataset.ready='true';canvas.dataset.plants=JSON.stringify(vegetation.counts);
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
  depthOfField.uniforms.aspect.value=camera.aspect;
});

function updatePointer(dt) {
  smoothPointer.lerp(pointer,1-Math.exp(-4*dt));
  pointerPresence=THREE.MathUtils.damp(pointerPresence,pointerInside?1:0,6,dt);
  let hit=false;
  if(pointerInside) {
    raycaster.setFromCamera(smoothPointer,camera);
    const r=raycaster.ray;
    const difference=t=>{
      const x=r.origin.x+r.direction.x*t,z=r.origin.z+r.direction.z*t;
      return r.origin.y+r.direction.y*t-groundHeight(x,z);
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
    pollen.rotation.y=uniforms.time.value*.008;
    pollen.position.y=Math.sin(uniforms.time.value*.2)*.035;
  }
  depthOfField.uniforms.tDepth.value=composer.readBuffer.depthTexture;
  renderer.info.reset();composer.render();
  if(assetsReady) {
    const d=window.sceneDiagnostics;
    d.hover=Number(uniforms.pointerActive.value.toFixed(3));
    d.pointer=uniforms.pointerWorld.value.toArray().map(v=>Number(v.toFixed(2)));
    d.drawCalls=renderer.info.render.calls;
    d.triangles=renderer.info.render.triangles;
    d.time=Number(uniforms.time.value.toFixed(2));
    canvas.dataset.hover=String(d.hover);canvas.dataset.pointer=JSON.stringify(d.pointer);
    canvas.dataset.drawCalls=String(d.drawCalls);canvas.dataset.triangles=String(d.triangles);
    averageFrameMs=THREE.MathUtils.lerp(averageFrameMs,elapsed,.035);
    canvas.dataset.fps=String(Math.round(1000/Math.max(1,averageFrameMs)));
  }
}
requestAnimationFrame(render);
populate().catch(error=>{console.error('Scene assets failed to initialize',error);window.sceneDiagnostics={ready:false,error:error.message};canvas.dataset.error=error.message;});
