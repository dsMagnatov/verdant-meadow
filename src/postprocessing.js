import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { contactOcclusionGLSL, createContactOcclusionUniforms } from './contact-occlusion.js';

export function createAtmospherePass(composer, camera, sun) {
  for (const target of [composer.renderTarget1, composer.renderTarget2]) {
    target.depthTexture = new THREE.DepthTexture(target.width, target.height, THREE.UnsignedIntType);
  }
  const clearShadow = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
  clearShadow.needsUpdate = true;
  const pass = new ShaderPass({
    name: 'MeadowLightAndDepth',
    uniforms: {
      tDiffuse: { value: null }, tDepth: { value: null },
      aspect: { value: camera.aspect }, maxBlur: { value: .008 },
      sunShadowMap: { value: clearShadow }, sunShadowMatrix: { value: sun.shadow.matrix },
      cameraWorld: { value: camera.matrixWorld },
      lightToSun: { value: new THREE.Vector3() },
      airDensity: { value: .007 }, scatterStrength: { value: .48 },
      ...createContactOcclusionUniforms(camera),
    },
    vertexShader:`varying vec2 vUv;
      void main(){vUv=uv;gl_Position=vec4(position.xy,0.,1.);}`,
    fragmentShader:`
      #include <packing>
      uniform sampler2D tDiffuse,tDepth,sunShadowMap;
      uniform float aspect,maxBlur,airDensity,scatterStrength;
      uniform mat4 sunShadowMatrix,cameraWorld;
      uniform vec3 lightToSun;
      varying vec2 vUv;
      ${contactOcclusionGLSL}

      float sunlightAt(vec3 worldPosition) {
        vec4 projected=sunShadowMatrix*vec4(worldPosition,1.);
        vec3 shadow=projected.xyz/projected.w;
        if(any(lessThan(shadow,vec3(0.))) || any(greaterThan(shadow,vec3(1.)))) return 1.;
        float storedDepth=unpackRGBAToDepth(texture2D(sunShadowMap,shadow.xy));
        return smoothstep(shadow.z-.0012,shadow.z+.0012,storedDepth);
      }

      vec3 scatteredSunlight(vec2 uv) {
        float depth=texture2D(tDepth,uv).r;
        vec3 viewPosition=aoViewPosition(uv,depth);
        vec3 origin=cameraWorld[3].xyz;
        vec3 surface=(cameraWorld*vec4(viewPosition,1.)).xyz;
        vec3 ray=normalize(surface-origin);
        float travel=min(length(surface-origin),36.);
        float stepLength=travel/24.;
        float scattered=0.;
        // Sunlight is blocked by the same geometry that shadows the surfaces.
        for(int i=0;i<24;i++) {
          float distanceAlongRay=(float(i)+.5)*stepLength;
          vec3 samplePosition=origin+ray*distanceAlongRay;
          float density=airDensity*exp(-max(samplePosition.y-1.,0.)*.09);
          scattered+=sunlightAt(samplePosition)*density*stepLength*exp(-airDensity*distanceAlongRay);
        }
        float forwardGlow=.55+.9*pow(max(dot(ray,lightToSun),0.),5.);
        return vec3(1.,.82,.43)*scattered*scatterStrength*forwardGlow;
      }
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
        float contactShade=min(getContactOcclusion(vUv)*aoStrength,aoMaxDarkening);
        color.rgb*=vec3(1.)-contactShade*vec3(1.06,.96,.93);
        color.rgb+=scatteredSunlight(vUv);
        gl_FragColor=color;
      }`,
  });
  // ShaderPass clones its uniform inputs. Rebind live matrices so RenderPass
  // updates the shadow projection and camera before this fullscreen pass.
  pass.uniforms.cameraWorld.value = camera.matrixWorld;
  pass.uniforms.sunShadowMatrix.value = sun.shadow.matrix;
  pass.uniforms.aoProjectionInverse.value = camera.projectionMatrixInverse;
  pass.uniforms.aoProjection.value = camera.projectionMatrix;
  pass.material.depthTest = false;
  pass.material.depthWrite = false;
  pass.setSize = (width, height) => pass.uniforms.aoResolution.value.set(width, height);
  pass.updateLight = () => {
    pass.uniforms.sunShadowMap.value = sun.shadow.map?.texture || clearShadow;
    pass.uniforms.lightToSun.value.subVectors(sun.position, sun.target.position).normalize();
  };
  pass.setSize(composer.renderTarget1.width, composer.renderTarget1.height);
  return pass;
}
