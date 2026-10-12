import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
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
      uniform float airDensity,scatterStrength;
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
        vec4 color=texture2D(tDiffuse,vUv);
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

/** Soft foreground defocus after lighting, so sharp AO cannot cut through it. */
export function createForegroundBlurPass(width, height) {
  const pass = new ShaderPass({
    name: 'MeadowForegroundDefocus',
    uniforms: {
      tDiffuse: { value: null },
      tBlurred: { value: null },
      maxBlur: { value: .021 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv=uv; gl_Position=vec4(position.xy,0.0,1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse,tBlurred;
      varying vec2 vUv;

      void main() {
        vec4 sharp=texture2D(tDiffuse,vUv);
        vec2 edge=abs(vUv-.5)*2.;
        float upperCorners=.38*smoothstep(.36,.92,edge.x*edge.y)*smoothstep(.5,1.,vUv.y);
        float lowerCorners=(1.-smoothstep(0.,.44,vUv.y))*smoothstep(.20,.92,edge.x);
        float lowerCenter=.82*(1.-smoothstep(0.,.25,vUv.y))*(1.-smoothstep(0.,.72,edge.x));
        float mask=max(upperCorners,max(lowerCorners,lowerCenter));
        float amount=smoothstep(0.,.85,mask);
        gl_FragColor=vec4(mix(sharp.rgb,texture2D(tBlurred,vUv).rgb,amount),sharp.a);
      }
    `,
  });
  pass.material.depthTest=false;
  pass.material.depthWrite=false;
  const downsample=new THREE.ShaderMaterial({
    name:'ForegroundPrefilter',depthTest:false,depthWrite:false,
    uniforms:{tSource:{value:null},texel:{value:new THREE.Vector2(1/width,1/height)}},
    vertexShader:pass.material.vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform vec2 texel;
      varying vec2 vUv;
      void main() {
        // Four bilinear taps average the full 4x4 source footprint before blur.
        gl_FragColor=(texture2D(tSource,vUv+texel*vec2(-1.,-1.))
          +texture2D(tSource,vUv+texel*vec2(1.,-1.))
          +texture2D(tSource,vUv+texel*vec2(-1.,1.))
          +texture2D(tSource,vUv+texel*vec2(1.,1.)))*.25;
      }
    `,
  });
  const gaussian=new THREE.ShaderMaterial({
    name:'ForegroundSeparableGaussian',depthTest:false,depthWrite:false,
    uniforms:{tSource:{value:null},direction:{value:new THREE.Vector2()}},
    vertexShader:pass.material.vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tSource;
      uniform vec2 direction;
      varying vec2 vUv;
      void main() {
        // Contiguous low-resolution taps avoid repeated silhouettes in fine grass.
        vec4 color=vec4(0.);
        float weightSum=0.;
        for(int i=-7;i<=7;i++) {
          float offset=float(i);
          float weight=exp(-offset*offset/18.);
          vec2 uv=clamp(vUv+direction*offset,vec2(.001),vec2(.999));
          color+=texture2D(tSource,uv)*weight;
          weightSum+=weight;
        }
        gl_FragColor=color/weightSum;
      }
    `,
  });
  const first=new THREE.WebGLRenderTarget(Math.ceil(width/4),Math.ceil(height/4),{
    type:THREE.HalfFloatType,minFilter:THREE.LinearFilter,magFilter:THREE.LinearFilter,
    depthBuffer:false,stencilBuffer:false,
  });
  const second=first.clone();
  first.texture.name='Foreground blur quarter-resolution A';
  second.texture.name='Foreground blur quarter-resolution B';
  const quad=new FullScreenQuad(downsample);
  const compositeRender=pass.render.bind(pass);
  const compositeDispose=pass.dispose.bind(pass);
  let fullWidth=width,fullHeight=height;
  pass.render=(renderer,writeBuffer,readBuffer,deltaTime,maskActive)=>{
    downsample.uniforms.tSource.value=readBuffer.texture;
    quad.material=downsample;
    renderer.setRenderTarget(first);quad.render(renderer);
    quad.material=gaussian;
    gaussian.uniforms.tSource.value=first.texture;
    gaussian.uniforms.direction.value.set(pass.uniforms.maxBlur.value*fullHeight/fullWidth/7,0);
    renderer.setRenderTarget(second);quad.render(renderer);
    gaussian.uniforms.tSource.value=second.texture;
    gaussian.uniforms.direction.value.set(0,pass.uniforms.maxBlur.value/7);
    renderer.setRenderTarget(first);quad.render(renderer);
    pass.uniforms.tBlurred.value=first.texture;
    compositeRender(renderer,writeBuffer,readBuffer,deltaTime,maskActive);
  };
  pass.setSize=(newWidth,newHeight)=>{
    fullWidth=newWidth;fullHeight=newHeight;
    downsample.uniforms.texel.value.set(1/newWidth,1/newHeight);
    first.setSize(Math.ceil(newWidth/4),Math.ceil(newHeight/4));
    second.setSize(Math.ceil(newWidth/4),Math.ceil(newHeight/4));
  };
  pass.dispose=()=>{
    first.dispose();second.dispose();downsample.dispose();gaussian.dispose();quad.dispose();compositeDispose();
  };
  return pass;
}
