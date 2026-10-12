import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

export function createAtmospherePass(composer, camera) {
  for (const target of [composer.renderTarget1, composer.renderTarget2]) {
    target.depthTexture = new THREE.DepthTexture(target.width, target.height, THREE.UnsignedIntType);
  }
  return new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null },
      aspect: { value: camera.aspect }, time: { value: 0 },
      sunPosition: { value: new THREE.Vector2(-.08, 1.18) },
      maxBlur: { value: .008 }, shaftStrength: { value: .12 },
    },
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
    fragmentShader:`
      uniform sampler2D tDiffuse,tDepth;
      uniform float aspect,time,maxBlur,shaftStrength;
      uniform vec2 sunPosition;
      varying vec2 vUv;
      float hash(float x){return fract(sin(x*127.1)*43758.5453);}
      float noise(float x){float i=floor(x),f=fract(x);return mix(hash(i),hash(i+1.),f*f*(3.-2.*f));}
      void main(){
        vec2 edge=abs(vUv-.5)*2.;
        float corner=smoothstep(.36,.92,edge.x*edge.y);
        float radius=corner*maxBlur;
        vec2 blur=vec2(radius/aspect,radius);
        vec4 color=texture2D(tDiffuse,vUv)*2.;
        for(int i=0;i<12;i++) {
          float angle=float(i)*2.399963;
          float r=sqrt((float(i)+.5)/12.);
          vec2 offset=vec2(cos(angle),sin(angle))*r*blur;
          vec2 sampleUv=clamp(vUv+offset,vec2(.001),vec2(.999));
          color+=texture2D(tDiffuse,sampleUv);
        }
        color/=14.;
        vec2 direction=sunPosition-vUv;
        vec2 projected=direction*vec2(aspect,1.);
        float angle=atan(projected.y,projected.x);
        float bands=pow(noise(angle*52.+noise(angle*13.)*3.+time*.006),2.4);
        float visibility=0.;
        for(int i=0;i<20;i++){
          float progress=(float(i)+.5)/20.;
          vec2 uv=clamp(vUv+direction*progress*.93,vec2(.001),vec2(.999));
          float depth=texture2D(tDepth,uv).x;
          visibility+=smoothstep(.9988,.9997,depth)*(1.-progress*.36);
        }
        visibility/=20.;
        float distance=length(projected);
        float falloff=exp(-distance*.60);
        float shafts=visibility*(.18+bands*.82)*falloff*shaftStrength;
        color.rgb+=vec3(1.0,.88,.40)*shafts;
        gl_FragColor=color;
      }`,
  });
}
