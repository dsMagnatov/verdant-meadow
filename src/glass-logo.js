import * as THREE from 'three';
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';

/** Bound raw opaque radiance before the transmission capture's HDR mip chain. */
export function prepareRefractionBackground(scene) {
  const prepared=new Set();
  scene.traverse(object=>{
    for(const material of (Array.isArray(object.material)?object.material:[object.material])) {
      if(!material || material.isShaderMaterial || prepared.has(material))continue;
      prepared.add(material);
      const compile=material.onBeforeCompile,cache=material.customProgramCacheKey.bind(material);
      material.onBeforeCompile=(shader,renderer)=>{
        compile.call(material,shader,renderer);
        shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
          if(!(outgoingLight.r>=0.0))outgoingLight.r=0.0;
          if(!(outgoingLight.g>=0.0))outgoingLight.g=0.0;
          if(!(outgoingLight.b>=0.0))outgoingLight.b=0.0;
          outgoingLight=min(outgoingLight,vec3(24.0));
          #include <opaque_fragment>`);
      };
      material.customProgramCacheKey=()=>cache()+'-finite-hdr';material.needsUpdate=true;
    }
  });
}

function createGlassReflections(renderer, sky) {
  const reflections=new THREE.Scene();reflections.add(sky.clone());
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(120,120),new THREE.MeshBasicMaterial({color:0x234527}));
  floor.rotation.x=-Math.PI/2;floor.position.y=-3;reflections.add(floor);
  const panels=[];
  for(const [position,size,color] of [
    [[-8,6,4],[4,15],[4.2,3.9,2.8]],[[7,2,-5],[2,12],[1.3,1.9,1.8]],
  ]) {
    const panel=new THREE.Mesh(new THREE.PlaneGeometry(...size),new THREE.MeshBasicMaterial({
      color:new THREE.Color(...color),side:THREE.DoubleSide,
    }));
    panel.position.set(...position);panel.lookAt(0,1,0);reflections.add(panel);panels.push(panel);
  }
  const generator=new THREE.PMREMGenerator(renderer);
  const map=generator.fromScene(reflections,.025,.1,400,{size:256});
  generator.dispose();floor.geometry.dispose();floor.material.dispose();
  for(const panel of panels){panel.geometry.dispose();panel.material.dispose();}
  return map;
}

export function createGlassLogo({parent,renderer,svg,sky,startTime=0,reducedMotion=false}) {
  const shapes=svg.paths.flatMap(path=>SVGLoader.createShapes(path));
  if(!shapes.length)throw new Error('The logo SVG contains no filled shapes');
  const depth=7;
  const geometry=new THREE.ExtrudeGeometry(shapes,{
    depth,steps:1,curveSegments:12,bevelEnabled:true,
    bevelSize:1.1,bevelThickness:1.05,bevelSegments:4,
  });
  geometry.computeBoundingBox();
  const box=geometry.boundingBox,center=box.getCenter(new THREE.Vector3());
  const scale=2.12/Math.max(box.max.x-box.min.x,box.max.y-box.min.y);
  geometry.translate(-center.x,-center.y,-center.z);geometry.scale(scale,scale,scale);
  geometry.rotateX(Math.PI);geometry.computeBoundingSphere();geometry.computeBoundingBox();
  const reflections=createGlassReflections(renderer,sky);
  const material=new THREE.MeshPhysicalMaterial({
    name:'Soft frosted meadow glass',color:0xeafff5,metalness:0,roughness:.40,
    transmission:.90,thickness:(depth+2.1)*scale,ior:1.48,
    attenuationColor:0xcdebdc,attenuationDistance:5,
    clearcoat:1,clearcoatRoughness:.04,specularIntensity:1,
    envMap:reflections.texture,envMapIntensity:1.2,
  });
  material.onBeforeCompile=shader=>{
    shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
      // Degenerate refraction directions must not poison the HDR bloom chain.
      if(!(outgoingLight.r>=0.0))outgoingLight.r=0.0;
      if(!(outgoingLight.g>=0.0))outgoingLight.g=0.0;
      if(!(outgoingLight.b>=0.0))outgoingLight.b=0.0;
      outgoingLight=min(outgoingLight,vec3(24.0));
      #include <opaque_fragment>`);
  };
  material.customProgramCacheKey=()=> 'finite-glass-refraction-v3';
  const mesh=new THREE.Mesh(geometry,material);
  mesh.name='Extruded four-part glass logo';mesh.castShadow=false;mesh.receiveShadow=false;
  const group=new THREE.Group();group.name='Slowly rotating glass logo';group.add(mesh);
  parent.name='glass-logo-anchor';parent.position.y=3.6;parent.add(group);
  const details={bounds:[geometry.boundingBox.min.toArray(),geometry.boundingBox.max.toArray()],parts:shapes.length,triangles:geometry.getAttribute('position').count/3,
    width:2.12,transmission:material.transmission,roughness:material.roughness,height:3.6,rotationPeriod:36};
  function update(elapsed,progress) {
    const time=Math.max(0,elapsed-startTime);
    group.visible=progress<.32;
    group.rotation.set(.075+(reducedMotion?0:Math.sin(time*.38)*.02),
      -.22+(reducedMotion?0:time*Math.PI*2/36),0);
    group.position.y=reducedMotion?0:Math.sin(time*.72)*.045;
  }
  update(startTime,0);
  const dispose=()=>{parent.remove(group);geometry.dispose();material.dispose();reflections.dispose();};
  return {group,mesh,details,update,dispose};
}
