import * as THREE from 'three';
import { MeshoptSimplifier } from 'meshoptimizer';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { createAtmospherePass, createForegroundBlurPass } from './postprocessing.js';
import { createEnvironment, scatterRocks, createDust } from './environment.js';
import { createVegetation } from './vegetation.js';
import { createHatch, hatchContains, hatchHeight } from './hatch.js';
import { createGlassLogo, prepareRefractionBackground } from './glass-logo.js';
import { createUnderground, openingContains } from './underground.js';
import { createUndergroundVegetation } from './underground-vegetation.js';
import { createScrollJourney, JOURNEY_SCROLL_VIEWPORTS } from './scroll-journey.js';
import { groundHeight } from './math.js';
import { createMenu } from './menu.js';
import { createTunnelStory } from './tunnel-story.js';
import { createFinaleGarden } from './finale-garden.js';
import { createViewport } from './responsive.js';
import { preloader } from './preloader.js';

const canvas = document.querySelector('#scene');
const viewport = createViewport();
const navigation = createMenu({ readViewportHeight: viewport.readJourneyHeight });
const heroCopy = document.querySelector('#hero-copy');
const logoLightTarget = new THREE.Vector3();
let lastHeroOpacity=-1;
const renderer = new THREE.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(viewport.state.pixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.02;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.transmissionResolutionScale=.5;
renderer.info.autoReset=false;
renderer.setClearColor(0x716f58);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc5ce89, .014);
const camera = new THREE.PerspectiveCamera(viewport.state.fov, window.innerWidth/window.innerHeight,.1,400);
scene.add(camera);
const cameraHome = new THREE.Vector3(0, 3.4, 8.9);
const lookHome = new THREE.Vector3(0, 2.25, -2.5);
camera.position.copy(cameraHome); camera.lookAt(lookHome);
const hemisphere=new THREE.HemisphereLight(0xa9c1b2,0x172519,.60);
const ambient=new THREE.AmbientLight(0xdce6a4,.025);
scene.add(hemisphere,ambient);
const sun = new THREE.DirectionalLight(0xffe5a2,8.0);
sun.position.set(-13,12,-9); sun.target.position.set(0,0,-3);
sun.castShadow=true;
let shadowSize = viewport.state.mobile ? 2048 : 4096;
sun.shadow.mapSize.set(shadowSize,shadowSize);
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
const foregroundBlur=createForegroundBlurPass(composer.renderTarget1.width,composer.renderTarget1.height);
composer.addPass(foregroundBlur);
composer.addPass(new OutputPass());
// Edge-only antialiasing keeps fine grass strands stable without a multisample
// HDR framebuffer. Run after tone mapping so contrast detection uses sRGB.
const antialiasing=new ShaderPass(FXAAShader);
antialiasing.uniforms.resolution.value.set(1/composer.renderTarget1.width,1/composer.renderTarget1.height);
composer.addPass(antialiasing);
const environment=createEnvironment(scene);
// The sky glow, surface shadows and volumetric light share one sun direction.
sun.position.copy(environment.sunlightDirection).multiplyScalar(36).add(sun.target.position);
const pollen=createDust(scene);
const cavePollen=createDust(scene);
cavePollen.group.name='Slow pollen below the stone opening';
cavePollen.group.position.y=-13.4;
cavePollen.group.position.z=-14;
cavePollen.group.scale.x=.18;
cavePollen.points.geometry.setDrawRange(0,320);
cavePollen.group.visible=false;
const surfaceFogColor=new THREE.Color(0xc5ce89), caveFogColor=new THREE.Color(0x102326);
const journey=createScrollJourney({heightMultiplier:JOURNEY_SCROLL_VIEWPORTS,readViewportHeight:viewport.readJourneyHeight,reducedMotion:window.matchMedia('(prefers-reduced-motion: reduce)').matches});
const pointerSurfaces=[environment.ground];
let hatchRig=null, underground=null, caveVegetation=null, grassField=null, glassLogo=null, finaleGarden=null;

// Remove the ground itself beneath the opening, so the camera crosses a real
// aperture rather than disappearing through a solid heightfield.
const terrainGeometry=environment.ground.geometry;
const terrainPositions=terrainGeometry.attributes.position;
const terrainIndices=terrainGeometry.index.array;
const keptIndices=[];
for(let i=0;i<terrainIndices.length;i+=3) {
  const a=terrainIndices[i],b=terrainIndices[i+1],c=terrainIndices[i+2];
  const x=(terrainPositions.getX(a)+terrainPositions.getX(b)+terrainPositions.getX(c))/3;
  const z=(terrainPositions.getZ(a)+terrainPositions.getZ(b)+terrainPositions.getZ(c))/3;
  if(!openingContains(x,z))keptIndices.push(a,b,c);
}
terrainGeometry.setIndex(keptIndices);

const uniforms={
  time:{value:0},pointerWorld:{value:new THREE.Vector3(1000,0,1000)},pointerActive:{value:0},
  pointerRayOrigin:{value:new THREE.Vector3()},pointerRayDirection:{value:new THREE.Vector3(0,0,-1)},pointerPresence:{value:0},
  pointerScreen:{value:new THREE.Vector2(-2,-2)},
  renderResolution:{value:new THREE.Vector2(composer.renderTarget1.width,composer.renderTarget1.height)},
  hoverRadius:{value:.225},
};
const pointer=new THREE.Vector2(0,0), smoothPointer=new THREE.Vector2(0,0);
const targetWorld=new THREE.Vector3(1000,0,1000), raycaster=new THREE.Raycaster();
let pointerInside=false, pointerPresence=0, visible=true, assetsReady=false, lastTime=performance.now(),averageFrameMs=16.7;
let firstFrameRendered=false;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const tunnelStory=createTunnelStory({reducedMotion});

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
  const tex=await preloader.track(onProgress=>(name.endsWith('.ktx2')?ktx:textureLoader).loadAsync(assets+name,onProgress));
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
  preloader.beginAssets(13);
  const [rockMap,rockNormal,rockRough,fernMap,fernNormal,fernAO,atlas,rockModel,foliage,stoneMap,stoneNormal,stoneRough,logoSvg] = await Promise.all([
    loadTexture('otherlife-rocks-diffuse-2048.ktx2',true),
    loadTexture('otherlife-rocks-normal-2048.ktx2'),
    loadTexture('otherlife-rocks-roughness-2048.ktx2'),
    loadTexture('otherlife-ferns-diffuse-1024.jpg',true),
    loadTexture('otherlife-ferns-normal-1024.ktx2'),
    loadTexture('otherlife-ferns-ao-1024.ktx2'),
    loadTexture('gladeye-pool-summer.png',true),
    preloader.track(onProgress=>gltf.loadAsync(assets+'otherlife-large-rocks.glb',onProgress)),
    preloader.track(onProgress=>gltf.loadAsync(assets+'otherlife-foliage.glb',onProgress)),
    preloader.track(onProgress=>textureLoader.loadAsync('/assets/stone/rock_face_03_diff_1k.jpg',onProgress)),
    preloader.track(onProgress=>textureLoader.loadAsync('/assets/stone/rock_face_03_nor_gl_1k.jpg',onProgress)),
    preloader.track(onProgress=>textureLoader.loadAsync('/assets/stone/rock_face_03_rough_1k.jpg',onProgress)),
    preloader.track(onProgress=>new SVGLoader().loadAsync('/assets/logo/logo.svg',onProgress)),
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
  hatchRig=hatch;
  glassLogo=createGlassLogo({parent:hatch.logoAnchor,renderer,svg:logoSvg,sky:environment.sky,
    startTime:uniforms.time.value,reducedMotion});
  pointerSurfaces.push(hatch.left.children[0],hatch.right.children[0]);
  const fernMesh=foliage.scene.getObjectByName('_9857_Var3_LOD0');
  if(!fernMesh?.isMesh) throw new Error('Fern geometry is missing');
  const fernGeometry=normalizedGeometry(fernMesh);
  finaleGarden=createFinaleGarden({camera,fernGeometry,fernMap,atlas,time:uniforms.time,reducedMotion});
  const fernMaterial=new THREE.MeshStandardMaterial({map:fernMap,alphaMap:fernMap,alphaTest:.045,normalMap:fernNormal,aoMap:fernAO,aoMapIntensity:.15,color:0xe2f0bc,roughness:.88,side:THREE.DoubleSide,normalScale:new THREE.Vector2(.25,.25)});
  const vegetation=createVegetation({scene,fernGeometry,fernMaterial,atlas,groundHeight:sceneSurfaceHeight,uniforms,hatch,rockSamples:landscapeRocks.surfaceSamples,terrainHoleContains:openingContains});
  grassField=vegetation.grassField;
  const caveStone=new THREE.MeshStandardMaterial({map:stoneMap,normalMap:stoneNormal,roughnessMap:stoneRough,roughness:.98,normalScale:new THREE.Vector2(1.2,1.2),color:0xb2bcad});
  underground=createUnderground({scene,stoneMaterial:caveStone,mossMap:environment.terrainMaterial.map});
  caveVegetation=createUndergroundVegetation({scene,fernGeometry,fernMaterial,atlas,uniforms,rootSamples:underground.rootSamples});
  pointerSurfaces.push(...(underground.pointerSurfaces||[]));
  prepareRefractionBackground(scene);
  preloader.mark('geometry');
  await renderer.compileAsync(scene,camera);
  preloader.mark('shaders');
  assetsReady=true;
  // Read-only scene diagnostics are exposed for browser QA.
  window.sceneDiagnostics={ready:true,plants:vegetation.counts,hatchHalves:2,referenceAssets:true,interaction:'rooted rise, bend and warm glow',reducedMotion};
  canvas.dataset.ready='true';canvas.dataset.plants=JSON.stringify(vegetation.counts);
  canvas.dataset.revision='animated-scene-preloader-19';canvas.dataset.particles=String(pollen.points.geometry.attributes.position.count);
  canvas.dataset.finalePlants=String(finaleGarden.count);
  canvas.dataset.logo=JSON.stringify(glassLogo.details);
  resizeScene();
  canvas.dataset.composition='wide moss hatch, continuous crack';canvas.dataset.blur='broad lower corners and soft bottom center';
  canvas.dataset.hoverLight='single screen circle, radius 22.5% of viewport height';
  canvas.dataset.rocks=String(landscapeRocks.placements?.length||0);
  canvas.dataset.cavePlants=JSON.stringify(caveVegetation.counts);
  window.sceneRig={hatch:hatch.group,left:hatch.left,right:hatch.right,logoAnchor:hatch.logoAnchor,descentTarget:hatch.descentTarget,camera,underground:underground.group};
  ktx.dispose();draco.dispose();
}

let touchPointer=false;
function readPointer(event) {
  pointer.set(event.clientX/window.innerWidth*2-1,1-event.clientY/window.innerHeight*2);
  uniforms.pointerScreen.value.set(event.clientX/window.innerWidth,1-event.clientY/window.innerHeight);
  touchPointer=event.pointerType==='touch';
  pointerInside=!navigation.isOpen&&!preloader.blocking;
}
window.addEventListener('pointermove',readPointer,{passive:true});
window.addEventListener('pointerdown',readPointer,{passive:true});
const releaseTouch=event=>{if(event.pointerType==='touch'){pointerInside=false;pointer.set(0,0);}};
window.addEventListener('pointerup',releaseTouch,{passive:true});
window.addEventListener('pointercancel',releaseTouch,{passive:true});
document.addEventListener('pointerleave',()=>{pointerInside=false;});
window.addEventListener('blur',()=>{pointerInside=false;});
document.addEventListener('visibilitychange',()=>{visible=!document.hidden;lastTime=performance.now();});
function resizeScene() {
  const view=viewport.sync();
  camera.aspect=view.width/view.height;camera.fov=view.fov;camera.updateProjectionMatrix();
  if(glassLogo)glassLogo.group.scale.setScalar(view.mobile ? (camera.aspect<1 ? .82 : .72) : 1);
  finaleGarden?.resize();
  if(renderer.getPixelRatio()!==view.pixelRatio){renderer.setPixelRatio(view.pixelRatio);composer.setPixelRatio(view.pixelRatio);}
  const nextShadowSize=view.mobile?2048:4096;
  if(nextShadowSize!==shadowSize){
    shadowSize=nextShadowSize;sun.shadow.mapSize.set(shadowSize,shadowSize);
    sun.shadow.map?.dispose();sun.shadow.map=null;sun.shadow.needsUpdate=true;
  }
  renderer.setSize(view.width,view.height);composer.setSize(view.width,view.height);
  uniforms.renderResolution.value.set(composer.renderTarget1.width,composer.renderTarget1.height);
  antialiasing.uniforms.resolution.value.set(1/composer.renderTarget1.width,1/composer.renderTarget1.height);
  canvas.dataset.layout=view.mobile?'mobile':'desktop';
  canvas.dataset.viewport=`${view.width}x${view.height}`;
  canvas.dataset.uiScale=view.scale.toFixed(4);
  canvas.dataset.fov=view.fov.toFixed(2);
  canvas.dataset.pixelRatio=String(view.pixelRatio);
  canvas.dataset.lighting=`${shadowSize} sun shadows, contact occlusion, shadowed volumetric sunlight`;
}
window.addEventListener('resize',resizeScene);

function updatePointer(dt) {
  smoothPointer.lerp(pointer,1-Math.exp(-4*dt));
  const interacting=pointerInside&&!navigation.isOpen;
  pointerPresence=THREE.MathUtils.damp(pointerPresence,interacting?1:0,6,dt);
  uniforms.pointerPresence.value=pointerPresence;
  let hit=false;
  if(interacting) {
    raycaster.setFromCamera(smoothPointer,camera);
    const r=raycaster.ray;
    uniforms.pointerRayOrigin.value.copy(r.origin);
    uniforms.pointerRayDirection.value.copy(r.direction);
    // Actual moved slabs and cave walls anchor the hover point during descent.
    const intersection=raycaster.intersectObjects(pointerSurfaces,false)[0];
    if(intersection) {
      targetWorld.copy(intersection.point);
      if(uniforms.pointerActive.value<.02)uniforms.pointerWorld.value.copy(targetWorld);
      else uniforms.pointerWorld.value.lerp(targetWorld,1-Math.exp(-8*dt));
      hit=true;
    }
  }
  uniforms.pointerActive.value=THREE.MathUtils.damp(uniforms.pointerActive.value,hit?1:0,6,dt);
}

function render(now) {
  requestAnimationFrame(render);
  const elapsed=now-lastTime,dt=Math.min(elapsed/1000,.05);lastTime=now;
  if(!visible||!assetsReady||preloader.failed) return;
  const pose=journey.update(dt);
  const narrative=tunnelStory.update(pose.progress,dt,navigation.isOpen);
  finaleGarden?.setProgress(narrative.finale);
  const heroOpacity=1-THREE.MathUtils.smoothstep(pose.descentProgress,.015,.14);
  if(heroOpacity!==lastHeroOpacity) {
    heroCopy.style.opacity=heroOpacity.toFixed(3);
    heroCopy.style.transform=`translateY(${((1-heroOpacity)*-26*(viewport.state.mobile?1:viewport.state.scale)).toFixed(2)}px)`;
    heroCopy.style.visibility=heroOpacity===0?'hidden':'visible';
    lastHeroOpacity=heroOpacity;
  }
  if(hatchRig) {
    hatchRig.left.position.x=-pose.openingDistance;
    hatchRig.right.position.x=pose.openingDistance;
    hatchRig.crackBed.visible=pose.opening<.005;
    hatchRig.group.updateMatrixWorld(true);
  }
  underground?.setProgress(pose.depthProgress,pose.opening);
  caveVegetation?.setProgress(pose.depthProgress);
  cavePollen.group.visible=pose.opening>.03;
  const interior=THREE.MathUtils.smoothstep(pose.depthProgress,0,.65);
  scene.fog.color.copy(surfaceFogColor).lerp(caveFogColor,interior);
  scene.fog.density=THREE.MathUtils.lerp(.014,.026,interior);
  hemisphere.intensity=THREE.MathUtils.lerp(.60,.18,interior);
  fill.intensity=THREE.MathUtils.lerp(.12,.055,interior);
  ambient.intensity=THREE.MathUtils.lerp(.025,.018,interior);
  atmosphere.uniforms.scatterStrength.value=.48*(1-interior*.93);
  atmosphere.uniforms.beamStrength.value=1.520875*(1-THREE.MathUtils.smoothstep(pose.descentProgress,.10,.30));
  // Follow the visible opening with the shadow volume. The sun direction stays
  // fixed; the cave roof must still block sunlight at the far end of the tunnel.
  const shadowFocus=THREE.MathUtils.smoothstep(pose.descentProgress,.12,.45);
  sun.target.position.set(0,-6*shadowFocus,-3-10*shadowFocus);
  sun.position.copy(environment.sunlightDirection).multiplyScalar(36).add(sun.target.position);
  const influence=reducedMotion||touchPointer?0:pointerPresence;
  camera.position.copy(pose.position);
  camera.position.x+=smoothPointer.x*.22*influence;
  camera.position.y+=smoothPointer.y*.09*influence;
  const portraitAim=viewport.state.mobile&&camera.aspect<1 ? .45*(1-THREE.MathUtils.smoothstep(pose.descentProgress,.05,.3)) : 0;
  camera.lookAt(pose.target.x+smoothPointer.x*.08*influence,pose.target.y-portraitAim+smoothPointer.y*.035*influence,pose.target.z);
  camera.updateMatrixWorld();
  grassField?.update(camera);
  updatePointer(dt);
  if(!reducedMotion) {
    uniforms.time.value+=dt;
    pollen.update(uniforms.time.value,camera);
    cavePollen.update(uniforms.time.value,camera);
  }
  atmosphere.uniforms.tDepth.value=composer.readBuffer.depthTexture;
  glassLogo?.update(uniforms.time.value,pose.descentProgress);
  if(glassLogo)glassLogo.group.getWorldPosition(logoLightTarget);
  atmosphere.updateLight(glassLogo?logoLightTarget:undefined);
  renderer.info.reset();composer.render();
  if(!firstFrameRendered) {
    firstFrameRendered=true;
    canvas.dataset.firstFrame='true';
    requestAnimationFrame(()=>preloader.mark('frame'));
  }
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
    canvas.dataset.scrollProgress=pose.progress.toFixed(4);
    canvas.dataset.descentProgress=pose.descentProgress.toFixed(4);
    canvas.dataset.storyCard=narrative.activeCard;
    canvas.dataset.finale=String(narrative.finale);
    canvas.dataset.opening=pose.opening.toFixed(4);
    canvas.dataset.phase=pose.phase;
    canvas.dataset.camera=JSON.stringify(camera.position.toArray().map(v=>Number(v.toFixed(3))));
    canvas.dataset.leaves=JSON.stringify([hatchRig.left.position.x,hatchRig.right.position.x].map(v=>Number(v.toFixed(3))));
    if(glassLogo){canvas.dataset.logoAngle=glassLogo.group.rotation.y.toFixed(3);canvas.dataset.logoVisible=String(glassLogo.group.visible);}
    if(grassField?.stats)canvas.dataset.grass=JSON.stringify(grassField.stats);
    averageFrameMs=THREE.MathUtils.lerp(averageFrameMs,elapsed,.035);
    canvas.dataset.fps=String(Math.round(1000/Math.max(1,averageFrameMs)));
  }
}
requestAnimationFrame(render);
populate().catch(error=>{console.error('Scene assets failed to initialize',error);window.sceneDiagnostics={ready:false,error:error.message};canvas.dataset.error=error.message;preloader.fail();});
