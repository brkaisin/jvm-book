// A post-processing guard: replaces any NaN or infinite pixel with black and
// clamps extreme values before bloom. Without it, one bad pixel (a driver
// quirk, a degenerate normal) gets blurred by the bloom mip chain into black
// squares that can spread over the whole frame.

import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Upper bound for HDR colours entering bloom (half floats overflow at 65504). */
export const MAX_RADIANCE = 64.0;

export function sanitizePass(): ShaderPass {
  return new ShaderPass({
    name: 'SanitizeShader',
    uniforms: { tDiffuse: { value: null } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        bool bad = any(isnan(c)) || any(isinf(c));
        gl_FragColor = bad ? vec4(0.0, 0.0, 0.0, 1.0) : clamp(c, 0.0, ${MAX_RADIANCE.toFixed(1)});
      }`,
  });
}
