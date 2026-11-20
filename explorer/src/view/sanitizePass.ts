// A post-processing guard: replaces any NaN or infinite pixel with black and
// clamps extreme values before bloom. Without it, one bad pixel (a driver
// quirk, a degenerate normal) gets blurred by the bloom mip chain into black
// squares that can spread over the whole frame.
//
// It also draws the focus spotlight for free (no extra full-screen pass):
// outside a soft circle around what is being explained, the image dims, before
// bloom, so the dimmed parts stop glowing too.

import { Vector3 } from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

/** Upper bound for HDR colours entering bloom (half floats overflow at 65504). */
export const MAX_RADIANCE = 64.0;

export function sanitizePass(): ShaderPass {
  return new ShaderPass({
    name: 'SanitizeShader',
    uniforms: {
      tDiffuse: { value: null },
      /** Spotlight centre (uv) and radius (fraction of the screen height). */
      spot: { value: new Vector3(0.5, 0.5, 0.3) },
      /** 0 = no spotlight, 1 = full. */
      spotAmount: { value: 0 },
      aspect: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec3 spot;
      uniform float spotAmount;
      uniform float aspect;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        bool bad = any(isnan(c)) || any(isinf(c));
        c = bad ? vec4(0.0, 0.0, 0.0, 1.0) : clamp(c, 0.0, ${MAX_RADIANCE.toFixed(1)});
        vec2 d = vUv - spot.xy;
        d.x *= aspect;
        float r = max(spot.z, 0.01);
        float outside = smoothstep(r * 0.6, r * 1.5, length(d));
        c.rgb *= 1.0 - spotAmount * 0.72 * outside;
        gl_FragColor = c;
      }`,
  });
}
