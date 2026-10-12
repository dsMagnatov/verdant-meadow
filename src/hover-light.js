import * as THREE from 'three';

const hoverLightGLSL = /* glsl */ `
  uniform vec2 uHoverCenter;
  uniform vec2 uHoverResolution;
  uniform float uHoverPresence;
  uniform float uHoverRadius;

  float meadowHoverLight() {
    vec2 screenUv = gl_FragCoord.xy / max(uHoverResolution, vec2(1.0));
    vec2 delta = screenUv - uHoverCenter;
    delta.x *= uHoverResolution.x / max(uHoverResolution.y, 1.0);
    // One monotonic, aspect-correct circle for every visible plant layer.
    return (1.0 - smoothstep(0.0, uHoverRadius, length(delta))) * uHoverPresence;
  }
`;

export function bindHoverLight(shader, uniforms) {
  Object.assign(shader.uniforms, {
    uHoverCenter: uniforms.pointerScreen ?? { value: new THREE.Vector2(-2, -2) },
    uHoverResolution: uniforms.renderResolution ?? { value: new THREE.Vector2(1280, 720) },
    uHoverPresence: uniforms.pointerPresence ?? { value: 0 },
    uHoverRadius: uniforms.hoverRadius ?? { value: .225 },
  });
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${hoverLightGLSL}`);
}
