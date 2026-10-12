import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Reuse the actual color pass depth. Alpha cutouts and plant deformation are
// already represented, so the camera blur needs no second geometry render.
export function createDepthOfField(composer, camera) {
  for(const target of [composer.renderTarget1,composer.renderTarget2]) {
    target.depthTexture=new THREE.DepthTexture(target.width,target.height,THREE.UnsignedIntType);
  }
  return new ShaderPass({
    uniforms:{
      tDiffuse:{value:null},tDepth:{value:null},
      near:{value:camera.near},far:{value:camera.far},aspect:{value:camera.aspect},
      focus:{value:9.5},aperture:{value:.00065},maxBlur:{value:.005},
    },
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`
      uniform sampler2D tDiffuse,tDepth;
      uniform float near,far,focus,aperture,maxBlur,aspect;
      varying vec2 vUv;
      #include <packing>
      void main(){
        float distance=-perspectiveDepthToViewZ(texture2D(tDepth,vUv).x,near,far);
        float radius=min(abs(distance-focus)*aperture,maxBlur);
        vec2 blur=vec2(radius/aspect,radius);
        vec4 color=texture2D(tDiffuse,vUv)*2.;
        for(int i=0;i<12;i++) {
          float angle=float(i)*2.399963;
          float r=sqrt((float(i)+.5)/12.);
          vec2 offset=vec2(cos(angle),sin(angle))*r*blur;
          vec2 sampleUv=clamp(vUv+offset,vec2(.001),vec2(.999));
          color+=texture2D(tDiffuse,sampleUv);
        }
        gl_FragColor=color/14.;
      }`,
  });
}
