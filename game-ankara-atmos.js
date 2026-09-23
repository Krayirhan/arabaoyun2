import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";
import { Sky } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/objects/Sky.js";
import { EffectComposer } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/OutputPass.js";
import { ShaderPass } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/postprocessing/ShaderPass.js";

// Lighting, sky, shadows and post-processing for the Ankara level.
const ANKARA = { lat: 39.9208, lon: 32.8541 };
// The daytime sky is used when the real sun is too low for a nice flight.
const MIN_ELEVATION = THREE.MathUtils.degToRad(12);
const SHADOW_SIZE = 700;

// Solar elevation/azimuth (NOAA approximation, accurate to ~0.5°).
export function solarPosition(date, lat, lon) {
  const rad = Math.PI / 180;
  const day = (date - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000;
  const hours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const g = ((2 * Math.PI) / 365) * (day - 1 + (hours - 12) / 24);
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);
  const eqTime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const solarTime = hours * 60 + eqTime + 4 * lon;
  // Hour angle: 0 at solar noon, positive in the afternoon (sun in the west).
  const H = (solarTime / 4 - 180) * rad;
  const phi = lat * rad;
  // Sun vector in local east/north/up coordinates.
  const east = -Math.cos(decl) * Math.sin(H);
  const north = Math.sin(decl) * Math.cos(phi) - Math.cos(decl) * Math.cos(H) * Math.sin(phi);
  const up = Math.sin(decl) * Math.sin(phi) + Math.cos(decl) * Math.cos(H) * Math.cos(phi);
  // Azimuth from north, clockwise (east = 90°).
  return { elevation: Math.asin(up), azimuth: Math.atan2(east, north) };
}

// World direction towards the sun: x east, y up, -z north.
function sunDirection({ elevation, azimuth }) {
  return new THREE.Vector3(
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    -Math.cos(elevation) * Math.cos(azimuth),
  ).normalize();
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    contrast: { value: 1.06 },
    saturation: { value: 1.1 },
    vignette: { value: 0.22 },
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform float vignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, saturation);
      c.rgb = (c.rgb - 0.5) * contrast + 0.5;
      float d = distance(vUv, vec2(0.5));
      c.rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, d);
      gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
    }`,
};

export class Atmosphere {
  constructor(renderer, scene, camera, sun, hemi) {
    Object.assign(this, { renderer, scene, camera, sun, hemi });
    this.active = false;
    this.sky = new Sky();
    this.sky.scale.setScalar(900);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 5;
    u.rayleigh.value = 1.4;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.8;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.saved = null;
    this.focus = new THREE.Vector3();
    this.forward = new THREE.Vector3();
  }

  // Real sun position for "now" in Ankara, or this afternoon if it is night
  // or the sun is too low (the GECE button is for night flights).
  computeSun() {
    let pos = solarPosition(new Date(), ANKARA.lat, ANKARA.lon);
    this.realSun = pos.elevation >= MIN_ELEVATION;
    if (!this.realSun) {
      const d = new Date();
      // 15:00 Türkiye time (UTC+3).
      d.setUTCHours(12, 0, 0, 0);
      pos = solarPosition(d, ANKARA.lat, ANKARA.lon);
    }
    this.sunInfo = pos;
    this.sunDir.copy(sunDirection(pos));
  }

  enable({ lowQuality }) {
    const { renderer, scene, sun, hemi } = this;
    if (!this.saved)
      this.saved = {
        exposure: renderer.toneMappingExposure,
        background: scene.background,
        sunIntensity: sun.intensity,
        hemiIntensity: hemi.intensity,
        shadow: {
          size: sun.shadow.mapSize.x,
          left: sun.shadow.camera.left,
          far: sun.shadow.camera.far,
          bias: sun.shadow.bias,
          normalBias: sun.shadow.normalBias,
        },
      };
    this.active = true;
    this.lowQuality = lowQuality;
    this.computeSun();
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    scene.add(this.sky);
    scene.background = null;
    // Reflections and ambient light from the same sky the player sees.
    const skyScene = new THREE.Scene();
    const skyCopy = new Sky();
    skyCopy.scale.setScalar(900);
    for (const k of ["turbidity", "rayleigh", "mieCoefficient", "mieDirectionalG"])
      skyCopy.material.uniforms[k].value = this.sky.material.uniforms[k].value;
    skyCopy.material.uniforms.sunPosition.value.copy(this.sunDir);
    skyScene.add(skyCopy);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(skyScene);
    scene.environment = this.envTarget.texture;
    renderer.toneMappingExposure = 0.62;
    // Warmer, weaker sun near the horizon.
    const elev = this.sunInfo.elevation;
    sun.color.setHSL(0.09, 0.6, 0.62 + Math.min(0.3, elev * 0.4));
    sun.intensity = 3.4 + Math.min(1.6, elev * 2);
    hemi.intensity = 0.25;
    hemi.color.set(0xbfd8ff);
    hemi.groundColor.set(0x7a6d5a);
    // Aerial perspective: fog takes the colour of the hazy horizon.
    scene.fog.color.set(0xb8cadb);
    // One large shadow map following the camera: ~17 cm per texel over
    // 700 m, and the fog hides everything beyond it.
    sun.castShadow = !lowQuality && renderer.shadowMap.enabled;
    const cam = sun.shadow.camera;
    const size = lowQuality ? 2048 : 4096;
    if (sun.shadow.mapSize.x !== size) {
      sun.shadow.mapSize.set(size, size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    cam.left = cam.bottom = -SHADOW_SIZE / 2;
    cam.right = cam.top = SHADOW_SIZE / 2;
    cam.near = 1;
    cam.far = 2400;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.6;
    this.setupComposer();
  }

  disable() {
    if (!this.active) return;
    const { renderer, scene, sun, hemi, saved } = this;
    this.active = false;
    scene.remove(this.sky);
    scene.environment = null;
    renderer.toneMappingExposure = saved.exposure;
    sun.intensity = saved.sunIntensity;
    hemi.intensity = saved.hemiIntensity;
    const cam = sun.shadow.camera;
    if (sun.shadow.mapSize.x !== saved.shadow.size) {
      sun.shadow.mapSize.set(saved.shadow.size, saved.shadow.size);
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
    }
    cam.left = cam.bottom = saved.shadow.left;
    cam.right = cam.top = -saved.shadow.left;
    cam.far = saved.shadow.far;
    cam.updateProjectionMatrix();
    sun.shadow.bias = saved.shadow.bias;
    sun.shadow.normalBias = saved.shadow.normalBias;
    this.saved = null;
  }

  // Night keeps the lit windows and bloom, drops the sky and sunlight.
  setNight(night) {
    if (!this.active) return;
    const { scene, sun, hemi } = this;
    if (night) {
      scene.remove(this.sky);
      scene.background = new THREE.Color(0x07101d);
      scene.environment = null;
      scene.fog.color.set(0x0b1522);
      sun.intensity = 0.35;
      sun.color.set(0x8aa2d8);
      hemi.intensity = 0.5;
      this.renderer.toneMappingExposure = 0.9;
    } else this.enable({ lowQuality: this.lowQuality });
    if (this.bloom) this.bloom.enabled = night;
  }

  setupComposer() {
    if (this.composer) return;
    const { renderer, scene, camera } = this;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    // MSAA target: anti-aliasing survives the post-processing chain.
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.addPass(new RenderPass(scene, camera));
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.updateGtaoMaterial({ radius: 3, distanceExponent: 1.5, thickness: 2, scale: 1.2 });
    this.gtao.blendIntensity = 0.85;
    // GTAO redraws the scene with a normal/depth override material, which
    // turns sprites (labels), points and lines into opaque quads. Hide them
    // for that pass, along with trees, cars and birds (noAO), whose AO is
    // barely visible but would double the most expensive geometry.
    const renderGtao = this.gtao.render.bind(this.gtao);
    const hidden = [];
    this.gtao.render = (...args) => {
      this.scene.traverseVisible((o) => {
        if (o.isSprite || o.isPoints || o.isLine || o.userData.noAO) hidden.push(o);
      });
      hidden.forEach((o) => (o.visible = false));
      renderGtao(...args);
      hidden.forEach((o) => (o.visible = true));
      hidden.length = 0;
    };
    this.composer.addPass(this.gtao);
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.4, 0.92);
    this.bloom.enabled = false;
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    // Colour grade in display space, after tone mapping.
    this.composer.addPass(new ShaderPass(GradeShader));
    const css = this.renderer.getSize(new THREE.Vector2());
    this.resize(css.x, css.y);
  }

  resize(w, h) {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // GTAO costs ~3 ms per megapixel here; past ~2.2 MP (e.g. 1080p on a
    // HiDPI screen) it would eat the frame budget, so skip it there.
    const pr = this.renderer.getPixelRatio();
    this.gtao.enabled = w * h * pr * pr <= 2.2e6;
  }

  // Keeps the sky around the camera and the shadow box ahead of it.
  update(dragonPos, heading) {
    if (!this.active) return;
    this.camera.getWorldPosition(this.sky.position);
    this.forward.set(-Math.sin(heading), 0, -Math.cos(heading));
    this.focus.copy(dragonPos).addScaledVector(this.forward, SHADOW_SIZE * 0.3);
    this.focus.y = Math.max(0, dragonPos.y - 60);
    // Snap to shadow texels so edges don't shimmer while flying.
    const texel = SHADOW_SIZE / this.sun.shadow.mapSize.x;
    this.focus.x = Math.round(this.focus.x / texel) * texel;
    this.focus.z = Math.round(this.focus.z / texel) * texel;
    this.sun.position.copy(this.focus).addScaledVector(this.sunDir, 1200);
    this.sun.target.position.copy(this.focus);
  }

  render(lowQuality) {
    if (lowQuality || !this.composer) this.renderer.render(this.scene, this.camera);
    else this.composer.render();
  }
}
