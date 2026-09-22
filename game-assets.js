import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.161.0/build/three.module.js";
import { GLTFLoader } from "https://cdn.jsdelivr.net/npm/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";

export function loadNormalized(path, targetSize, onLoad, onError) {
  const handleError = (error) => {
    if (onError) onError(error);
    else window.dispatchEvent(new CustomEvent("asseterror", { detail: { path, error } }));
  };
  new GLTFLoader().load(
    path,
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scale = targetSize / Math.max(size.x, size.y, size.z, 0.001);
      model.scale.setScalar(scale);
      const center = box.getCenter(new THREE.Vector3()).multiplyScalar(scale);
      model.position.sub(center);
      onLoad(model, gltf);
    },
    undefined,
    handleError,
  );
}
