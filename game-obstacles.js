import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";

// Procedural models for the moving drones and the fly-through rings, so they
// need no extra asset downloads.
const bodyMat = new THREE.MeshStandardMaterial({ color: 0x2b3240, roughness: 0.5, metalness: 0.4 });
const armMat = new THREE.MeshStandardMaterial({ color: 0x151a22, roughness: 0.7 });
const rotorMat = new THREE.MeshStandardMaterial({
  color: 0xb8c4d6,
  transparent: true,
  opacity: 0.55,
  roughness: 0.3,
});
const lightMat = new THREE.MeshStandardMaterial({
  color: 0xff3b2f,
  emissive: 0xff2a1a,
  emissiveIntensity: 2,
});

export const DRONE_HALF = { x: 2.3, y: 1, z: 2.3 };

export function createDrone() {
  const drone = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 0.7, 2), bodyMat);
  body.castShadow = true;
  drone.add(body);
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), lightMat);
  light.position.set(0, 0.1, 1.05);
  drone.add(light);
  const rotors = [];
  for (const [x, z] of [
    [1.6, 1.6],
    [-1.6, 1.6],
    [1.6, -1.6],
    [-1.6, -1.6],
  ]) {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.2, 2.3), armMat);
    arm.position.set(x / 2, 0, z / 2);
    arm.rotation.y = Math.atan2(x, z);
    drone.add(arm);
    const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 16), rotorMat);
    rotor.position.set(x, 0.42, z);
    drone.add(rotor);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.18), armMat);
    blade.position.copy(rotor.position);
    drone.add(blade);
    rotors.push(blade);
  }
  drone.userData.rotors = rotors;
  drone.userData.light = light;
  drone.scale.setScalar(1.15);
  return drone;
}

export function animateDrone(drone, time) {
  drone.userData.rotors.forEach((r, i) => (r.rotation.y = time * 40 + i));
  drone.userData.light.visible = Math.sin(time * 9) > -0.2;
}

const ringMat = new THREE.MeshStandardMaterial({
  color: 0x5de1e6,
  emissive: 0x2bd9e0,
  emissiveIntensity: 1.4,
  roughness: 0.3,
});
const ringGeo = new THREE.TorusGeometry(3.4, 0.32, 10, 36);
export const RING_RADIUS = 3.4;

export function createRing() {
  const ring = new THREE.Mesh(ringGeo, ringMat);
  return ring;
}
