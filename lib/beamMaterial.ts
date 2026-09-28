import * as THREE from 'three';

/**
 * A stage light's beam: an open cone, additive, brightest at the lamp and
 * fading toward the print, softer at its silhouette than through its middle
 * so it reads as light in air rather than a painted funnel.
 */
export function createBeamMaterial(color: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        vUv = uv;
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uOpacity;
      varying vec2 vUv;
      varying vec3 vNormal;
      varying vec3 vView;
      void main() {
        // uv.y runs base → apex on a cone; the lamp is at the apex.
        float along = vUv.y;
        float body = pow(along, 1.6);
        // Through the middle the beam is dense, at the edge it thins.
        float rim = abs(dot(normalize(vNormal), normalize(vView)));
        float a = body * (0.18 + 0.82 * rim) * uOpacity;
        gl_FragColor = vec4(uColor * a, a);
      }
    `,
  });
}
