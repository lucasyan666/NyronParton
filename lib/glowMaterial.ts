import * as THREE from 'three';

/**
 * A soft halo that fades to nothing at its edges.
 *
 * A flat plane with uniform opacity reads as a solid rectangle no matter how
 * low you set it. This computes a rounded-rectangle distance field in UV space
 * and falls off smoothly outside the plate's silhouette, so the light appears
 * to spill from behind the print rather than sitting on the wall as a panel.
 *
 * Additive blending, no depth write: it only ever brightens what is behind it.
 */
/**
 * `blending` defaults to additive (a light). Pass NormalBlending with a dark
 * colour and the same falloff becomes a contact shadow.
 */
export function createGlowMaterial(color: string, blending: THREE.Blending = THREE.AdditiveBlending) {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      /** Half-extent of the plate inside this quad, in UV space. */
      uInner: { value: new THREE.Vector2(0.37, 0.37) },
      /** How far past the plate the falloff reaches. */
      uSoftness: { value: 0.34 },
      /** Quad width/height, so the falloff is even in world units. */
      uAspect: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3  uColor;
      uniform float uOpacity;
      uniform vec2  uInner;
      uniform float uSoftness;
      uniform float uAspect;
      varying vec2 vUv;

      void main() {
        // Distance outside a rounded rect centred in the quad. UV space is
        // square while the quad is not, so X is scaled by the aspect ratio —
        // otherwise the halo spreads further sideways on a landscape print.
        vec2 p = abs(vUv - 0.5);
        vec2 d = max(p - uInner, 0.0);
        d.x *= uAspect;
        float dist = length(d);

        /*
         * Quartic falloff. A linear or squared curve keeps too much energy out
         * at the edges and still reads as a shape; raising it to the fourth
         * concentrates what little brightness there is close to the plate and
         * lets the rest dissolve into the wall.
         */
        float falloff = 1.0 - smoothstep(0.0, uSoftness, dist);
        falloff *= falloff;
        falloff *= falloff;

        // Kill the centre: the plate covers it, and letting the glow build up
        // behind an opaque object only produces a bright rim on its edges.
        float centre = 1.0 - smoothstep(0.0, 0.02, dist);
        falloff *= 1.0 - centre * 0.9;

        float a = falloff * uOpacity;
        if (a < 0.002) discard;

        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}
