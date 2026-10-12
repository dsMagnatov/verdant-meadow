import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Merge these uniforms into the atmosphere pass; matrices reference the camera. */
export function createContactOcclusionUniforms(camera) {
  return {
    aoResolution: { value: new THREE.Vector2(1280, 720) },
    aoProjectionInverse: { value: camera.projectionMatrixInverse },
    aoProjection: { value: camera.projectionMatrix },
    aoStrength: { value: 0.48 },
    aoRadius: { value: 1.0 },
    aoBias: { value: 0.025 },
    aoMaxDarkening: { value: 0.42 },
  };
}

/**
 * Reuses the parent shader's tDepth declaration. getContactOcclusion(uv) returns
 * raw occlusion in [0, 1], without applying strength, a color tint, or the cap.
 * Apply min(getContactOcclusion(uv) * aoStrength, aoMaxDarkening) to color.
 */
export const contactOcclusionGLSL = /* glsl */ `
  uniform vec2 aoResolution;
  uniform mat4 aoProjectionInverse;
  uniform mat4 aoProjection;
  uniform float aoStrength;
  uniform float aoRadius;
  uniform float aoBias;
  uniform float aoMaxDarkening;

  vec3 aoViewPosition(vec2 uv, float depth) {
    vec4 projected = aoProjectionInverse
      * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return projected.xyz / projected.w;
  }

  vec3 aoNeighborPosition(vec2 uv) {
    vec2 safeUv = clamp(uv, vec2(0.0), vec2(1.0));
    return aoViewPosition(safeUv, texture2D(tDepth, safeUv).x);
  }

  vec3 aoDepthNormal(vec2 uv, vec3 center, vec2 texel, out float continuity) {
    vec3 left = aoNeighborPosition(uv - vec2(texel.x, 0.0));
    vec3 right = aoNeighborPosition(uv + vec2(texel.x, 0.0));
    vec3 down = aoNeighborPosition(uv - vec2(0.0, texel.y));
    vec3 up = aoNeighborPosition(uv + vec2(0.0, texel.y));

    // The closest depth gradient stays on the surface at silhouettes/leaf cuts.
    float leftGap = abs(left.z - center.z);
    float rightGap = abs(right.z - center.z);
    float downGap = abs(down.z - center.z);
    float upGap = abs(up.z - center.z);
    vec3 dx = rightGap < leftGap ? right - center : center - left;
    vec3 dy = upGap < downGap ? up - center : center - down;
    vec3 normal = cross(dx, dy);
    float lengthSquared = dot(normal, normal);
    float closestGap = max(min(leftGap, rightGap), min(downGap, upGap));
    float normalRadius = max(aoRadius, 0.01);
    continuity = 1.0 - smoothstep(0.35 * normalRadius, 0.95 * normalRadius, closestGap);
    if (lengthSquared < 0.0000000001) return vec3(0.0, 0.0, 1.0);
    normal *= inversesqrt(lengthSquared);
    return dot(normal, -center) < 0.0 ? -normal : normal;
  }

  float getContactOcclusion(vec2 uv) {
    float centerDepth = texture2D(tDepth, uv).x;
    if (centerDepth >= 0.9999) return 0.0;

    vec3 center = aoViewPosition(uv, centerDepth);
    vec2 texel = 1.0 / max(aoResolution, vec2(1.0));
    float continuity;
    vec3 normal = aoDepthNormal(uv, center, texel, continuity);
    vec2 projectionScale = vec2(aoProjection[0][0], aoProjection[1][1]);
    float viewDistance = max(-center.z, 0.1);
    float occlusion = 0.0;
    float weightSum = 0.0;

    // Sixteen deterministic horizon taps at four physical radii; no noise map.
    for (int i = 0; i < 16; i++) {
      float index = float(i);
      float ring = floor(index * 0.25);
      float worldRadius = 0.085;
      float weight = 1.0;
      if (ring > 0.5) { worldRadius = 0.22; weight = 0.95; }
      if (ring > 1.5) { worldRadius = 0.48; weight = 0.80; }
      if (ring > 2.5) { worldRadius = 1.10; weight = 0.62; }
      worldRadius *= max(aoRadius, 0.01);
      weightSum += weight;

      float angle = index * 2.39996323 + ring * 0.41;
      vec2 direction = vec2(cos(angle), sin(angle));
      vec2 sampleUv = uv + direction * projectionScale
        * worldRadius / (2.0 * viewDistance);
      if (sampleUv.x <= 0.0 || sampleUv.y <= 0.0
        || sampleUv.x >= 1.0 || sampleUv.y >= 1.0) continue;

      float sampleDepth = texture2D(tDepth, sampleUv).x;
      if (sampleDepth >= 0.9999) continue;
      vec3 delta = aoViewPosition(sampleUv, sampleDepth) - center;
      float distanceToSample = length(delta);
      float elevation = max(dot(normal, delta) - aoBias, 0.0)
        / max(distanceToSample, 0.005);
      // Detached depth steps cannot occlude this local hemisphere.
      float rangeWeight = 1.0 - smoothstep(worldRadius * 1.15,
        worldRadius * 2.25, distanceToSample);
      occlusion += elevation * rangeWeight * weight;
    }

    float average = occlusion / max(weightSum, 0.001);
    return clamp((1.0 - exp(-average * 3.0)) * continuity, 0.0, 1.0);
  }
`;

/** Standalone wrapper; merge the core above with atmosphere to avoid depth feedback. */
export function createContactOcclusionPass(camera) {
  const pass = new ShaderPass({
    name: 'MeadowContactOcclusion',
    uniforms: {
      tDiffuse: { value: null },
      tDepth: { value: null },
      ...createContactOcclusionUniforms(camera),
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = vec4(position.xy, 0.0, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform sampler2D tDepth;
      varying vec2 vUv;
      ${contactOcclusionGLSL}
      void main() {
        vec4 color = texture2D(tDiffuse, vUv);
        float amount = min(getContactOcclusion(vUv) * max(aoStrength, 0.0),
          clamp(aoMaxDarkening, 0.0, 0.45));
        vec3 shadowMultiplier = vec3(1.0) - amount * vec3(1.06, 0.96, 0.93);
        gl_FragColor = vec4(color.rgb * shadowMultiplier, color.a);
      }
    `,
  });

  // ShaderPass clones uniforms; restore the live camera matrix references.
  pass.uniforms.aoProjectionInverse.value = camera.projectionMatrixInverse;
  pass.uniforms.aoProjection.value = camera.projectionMatrix;
  pass.uniforms.resolution = pass.uniforms.aoResolution;
  pass.uniforms.projectionMatrixInverse = pass.uniforms.aoProjectionInverse;
  pass.uniforms.projectionMatrix = pass.uniforms.aoProjection;
  pass.uniforms.strength = pass.uniforms.aoStrength;
  pass.uniforms.radius = pass.uniforms.aoRadius;
  pass.uniforms.bias = pass.uniforms.aoBias;
  pass.uniforms.maxDarkening = pass.uniforms.aoMaxDarkening;
  pass.setSize = (width, height) => pass.uniforms.aoResolution.value.set(width, height);
  pass.updateCamera = () => {
    pass.uniforms.aoProjectionInverse.value.copy(camera.projectionMatrixInverse);
    pass.uniforms.aoProjection.value.copy(camera.projectionMatrix);
  };
  pass.material.depthTest = false;
  pass.material.depthWrite = false;
  return pass;
}
