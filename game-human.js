import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";

// On-foot mode for Ankara: a KayKit character (assets/human, CC0) that
// walks on the terrain, roads and sidewalks and slides along buildings.
const HEIGHT = 1.75;
const WALK = 2.3;
const RUN = 6.5;
const BACK = 1.4;
const TURN = 2.4;
const GRAVITY = 16;
const JUMP = 5.2;
const RADIUS = 0.45;

export class Walker {
  constructor(parent) {
    this.group = new THREE.Group();
    this.group.visible = false;
    parent.add(this.group);
    this.ready = false;
    this.speed = 0;
    this.vy = 0;
    this.onGround = true;
    this.state = "";
    this.oneShot = null;
    this.probe = new THREE.Vector3();
  }

  load(url) {
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene;
      const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
      model.scale.setScalar(HEIGHT / size.y);
      // KayKit characters face +z; the player's forward is -z.
      model.rotation.y = Math.PI;
      model.traverse((o) => {
        if (o.isMesh) {
          o.castShadow = true;
          o.receiveShadow = true;
          // Skinned meshes animate outside their bind-pose bounds.
          o.frustumCulled = false;
        }
      });
      this.group.add(model);
      this.mixer = new THREE.AnimationMixer(model);
      this.actions = {};
      for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
      for (const name of ["Jump_Start", "Jump_Land", "Cheer", "Interact"]) {
        const a = this.actions[name];
        if (!a) continue;
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      this.mixer.addEventListener("finished", (e) => {
        if (e.action === this.actions.Jump_Start && !this.onGround) this.play("Jump_Idle", 0.1);
        if (e.action === this.oneShot) this.oneShot = null;
      });
      this.play("Idle", 0);
      this.ready = true;
    });
  }

  show(visible) {
    this.group.visible = visible;
    if (visible) {
      this.speed = 0;
      this.vy = 0;
      this.onGround = true;
      this.oneShot = null;
      this.play("Idle", 0);
    }
  }

  play(name, fade = 0.2) {
    const next = this.actions?.[name];
    if (!next || this.state === name) return;
    const prev = this.actions[this.state];
    next.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (prev) prev.fadeOut(fade);
    this.state = name;
  }

  jump() {
    if (!this.onGround) return;
    this.vy = JUMP;
    this.onGround = false;
    this.oneShot = null;
    this.play("Jump_Start", 0.08);
  }

  cheer() {
    if (!this.onGround) return;
    this.oneShot = this.actions.Cheer;
    this.play("Cheer", 0.15);
  }

  // input: forward -1..1, turn -1..1, run. Mutates pos, returns the heading.
  update(dt, { forward, turn, run }, world, pos, heading) {
    heading -= turn * TURN * dt;
    const target = forward > 0.05 ? forward * (run ? RUN : WALK) : forward < -0.05 ? forward * BACK : 0;
    // A one-shot emote holds the walker still until it ends or they move.
    if (this.oneShot && Math.abs(target) > 0.1) this.oneShot = null;
    this.speed = THREE.MathUtils.lerp(this.speed, this.oneShot ? 0 : target, Math.min(1, dt * 8));
    const dx = -Math.sin(heading) * this.speed * dt,
      dz = -Math.cos(heading) * this.speed * dt;
    // Slide along walls: try the full move, then each axis on its own.
    const blocked = (x, z) => {
      this.probe.set(x, pos.y + 1, z);
      return world.collides(this.probe, RADIUS) || world.trunkAt(x, z, RADIUS);
    };
    if (!blocked(pos.x + dx, pos.z + dz)) {
      pos.x += dx;
      pos.z += dz;
    } else if (!blocked(pos.x + dx, pos.z)) pos.x += dx;
    else if (!blocked(pos.x, pos.z + dz)) pos.z += dz;
    else this.speed *= 0.5;
    world.clampToBounds(pos);

    const floor = world.surfaceAt(pos.x, pos.z);
    if (this.onGround) {
      // Follow the ground; small steps (kerbs) are simply stepped onto.
      pos.y = floor;
    } else {
      this.vy -= GRAVITY * dt;
      pos.y += this.vy * dt;
      if (pos.y <= floor) {
        pos.y = floor;
        this.vy = 0;
        this.onGround = true;
        this.oneShot = this.actions.Jump_Land;
        this.play("Jump_Land", 0.05);
      }
    }

    if (this.onGround && !this.oneShot) {
      const s = this.speed;
      if (s > RUN * 0.55) this.play("Running_A");
      else if (s > 0.25) this.play("Walking_A");
      else if (s < -0.25) this.play("Walking_Backwards");
      else this.play("Idle");
      // Match the stride to the ground speed so feet don't slide.
      const cycle = this.state === "Running_A" ? s / RUN : this.state === "Walking_A" ? s / WALK : 1;
      this.mixer.timeScale = THREE.MathUtils.clamp(Math.abs(cycle) || 1, 0.6, 1.4);
    } else this.mixer.timeScale = 1;
    this.mixer.update(dt);
    return heading;
  }
}
