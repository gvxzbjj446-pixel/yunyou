// 后期：MSAA HDR 渲染 → 泛光 → 电影调色（对比/饱和/色温/暗角/颗粒）→ ACES + sRGB 输出。
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.06 },
    uSaturation: { value: 1.08 },
    uWarmth: { value: 0.0 },
    uVignette: { value: 0.28 },
    uGrain: { value: 0.025 },
    uTime: { value: 0 },
    uLift: { value: new THREE.Vector3(0, 0, 0) },
    uAberration: { value: 0.0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uContrast, uSaturation, uWarmth, uVignette, uGrain, uTime, uAberration; uniform vec3 uLift;
    varying vec2 vUv;
    float rand(vec2 co){ return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 dc = vUv - 0.5;
      vec3 c;
      if (uAberration > 0.0) {
        vec2 off = dc * uAberration;
        c = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      } else c = texture2D(tDiffuse, vUv).rgb;
      // 在对数空间做对比度，保持中灰
      vec3 lc = log2(max(c, vec3(1e-5)) / 0.18);
      c = 0.18 * exp2(lc * uContrast);
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c *= vec3(1.0 + uWarmth * 0.08, 1.0, 1.0 - uWarmth * 0.1);
      c += uLift * (1.0 - clamp(l * 4.0, 0.0, 1.0));
      float v = smoothstep(0.85, 0.2, length(dc * vec2(1.0, 0.8)));
      c *= mix(1.0 - uVignette, 1.0, v);
      c += (rand(vUv * 1000.0 + uTime) - 0.5) * uGrain * (0.3 + l);
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.25, 0.55, 0.92);
    this.grade = new ShaderPass(GradeShader);
    this.output = new OutputPass();
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.output);
  }
  setCamera(camera) {
    this.renderPass.camera = camera;
  }
  setSize(w, h, pixelRatio) {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(w, h);
  }
  /** 按夜景程度与运镜状态调整风格 */
  setLook({ night = 0, cinematic = false, warmth = 0 }) {
    const u = this.grade.uniforms;
    this.bloom.strength = 0.18 + night * 0.9;
    this.bloom.threshold = night > 0.5 ? 0.45 : 0.92;
    u.uContrast.value = cinematic ? 1.12 : 1.05;
    u.uSaturation.value = (cinematic ? 1.12 : 1.06) - night * 0.15;
    u.uVignette.value = cinematic ? 0.42 : 0.22;
    u.uGrain.value = cinematic ? 0.035 : 0.015;
    u.uWarmth.value = warmth;
    u.uAberration.value = cinematic ? 0.0012 : 0.0;
    u.uLift.value.set(0.0, 0.004 * night, 0.012 * night);
  }
  render(dt) {
    this.grade.uniforms.uTime.value = (this.grade.uniforms.uTime.value + dt) % 1000;
    this.composer.render(dt);
  }
}
