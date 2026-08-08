// Three.js GLB/GLTF viewer — rotate, zoom, pan, fullscreen, responsive.
import * as THREE from "https://unpkg.com/three@0.161.0/build/three.module.js";
import { OrbitControls } from "https://unpkg.com/three@0.161.0/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "https://unpkg.com/three@0.161.0/examples/jsm/loaders/GLTFLoader.js";

export function initViewer(canvas, url) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060606);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
  camera.position.set(4, 2, 6);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x111111, 1.1));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(5, 8, 6);
  scene.add(dir);
  const back = new THREE.DirectionalLight(0xffffff, 0.6);
  back.position.set(-6, 4, -5);
  scene.add(back);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enablePan = true;
  controls.zoomSpeed = 0.8;

  const resize = () => {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  new GLTFLoader().load(
    url,
    (gltf) => {
      const model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      model.position.sub(center);
      scene.add(model);
      const radius = Math.max(size.x, size.y, size.z) || 1;
      camera.position.set(radius * 1.4, radius * 0.8, radius * 1.8);
      camera.near = radius / 100;
      camera.far = radius * 100;
      camera.updateProjectionMatrix();
      controls.target.set(0, 0, 0);
      controls.update();
      canvas.dispatchEvent(new CustomEvent("model-loaded", { bubbles: true }));
    },
    undefined,
    (err) => {
      console.error("3D model failed to load", err);
      canvas.dispatchEvent(new CustomEvent("model-error", { bubbles: true }));
    }
  );

  let raf;
  const tick = () => {
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(tick);
  };
  tick();

  return {
    dispose() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}