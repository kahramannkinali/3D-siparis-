// STL dosyalarını tarayıcıda 3B olarak gösteren küçük görüntüleyici (three.js)
import * as THREE from 'three';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const active = new WeakMap();

/**
 * container: görüntüleyicinin çizileceği eleman
 * buffer: STL dosyasının ArrayBuffer'ı
 * Döndürür: { size: {x,y,z} mm, triangles }
 */
export function showSTL(container, buffer) {
  disposeViewer(container);

  const geometry = new STLLoader().parse(buffer);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);
  geometry.translate(-center.x, -center.y, -box.min.z); // tablaya oturt

  const w = container.clientWidth || 400;
  const h = container.clientHeight || 300;

  const scene = new THREE.Scene();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  container.appendChild(renderer.domElement);

  // Z ekseni yukarı (dilimleyicilerdeki gibi)
  const camera = new THREE.PerspectiveCamera(40, w / h, 0.1, 100000);
  camera.up.set(0, 0, 1);
  const r = Math.max(size.x, size.y, size.z) || 1;
  camera.position.set(r * 1.4, -r * 1.8, r * 1.3);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, size.z / 2);
  controls.enableDamping = true;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8a8a, 2.2));
  const dir = new THREE.DirectionalLight(0xffffff, 1.6);
  dir.position.set(r, -r, r * 2);
  scene.add(dir);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ color: 0xe8692c, roughness: 0.55, metalness: 0.05 })
  );
  scene.add(mesh);

  // Baskı tablası ızgarası
  const gridSize = Math.ceil((Math.max(size.x, size.y) * 1.6) / 10) * 10 || 100;
  const grid = new THREE.GridHelper(gridSize, Math.min(40, gridSize / 10), 0x9a9a9a, 0xd0d0d0);
  grid.rotation.x = Math.PI / 2;
  scene.add(grid);

  let raf;
  const loop = () => {
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(loop);
  };
  loop();

  const ro = new ResizeObserver(() => {
    const nw = container.clientWidth, nh = container.clientHeight;
    if (!nw || !nh) return;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
  ro.observe(container);

  active.set(container, () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    controls.dispose();
    geometry.dispose();
    mesh.material.dispose();
    renderer.dispose();
    renderer.domElement.remove();
  });

  return {
    size: { x: size.x, y: size.y, z: size.z },
    triangles: geometry.attributes.position.count / 3,
  };
}

export function disposeViewer(container) {
  const fn = active.get(container);
  if (fn) { fn(); active.delete(container); }
}
