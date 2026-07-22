import * as THREE from './vendor/three.module.min.js';

/* Процедурная модель наушника soundcore Sport X20 и управление вращением.
   Используется и всплывающим виджетом, и панелью настроек. */

const MAT = () => ({
  body: new THREE.MeshStandardMaterial({ color: 0x1b1b20, roughness: 0.42, metalness: 0.28 }),
  ring: new THREE.MeshStandardMaterial({ color: 0x4a4a55, roughness: 0.22, metalness: 0.85 }),
  tip:  new THREE.MeshStandardMaterial({ color: 0x3a3a42, roughness: 0.88, metalness: 0.02 }),
  hook: new THREE.MeshStandardMaterial({ color: 0x212127, roughness: 0.55, metalness: 0.18 }),
});

function buildEarbud(mat, led) {
  const inner = new THREE.Group();

  // Корпус: профиль вращения — скруглённая капсула
  const profile = [
    [0.00, -0.62], [0.20, -0.58], [0.33, -0.48], [0.41, -0.30],
    [0.45, -0.05], [0.455, 0.18], [0.43, 0.38], [0.36, 0.52],
    [0.24, 0.60], [0.10, 0.63], [0.00, 0.635],
  ].map(([x, y]) => new THREE.Vector2(x, y));
  inner.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 64), mat.body));

  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.452, 0.016, 12, 64), mat.ring);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.06;
  inner.add(ring);

  const dot = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 16), led);
  dot.position.set(0.30, 0.30, 0.30);
  inner.add(dot);

  const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.21, 0.30, 40), mat.body);
  nozzle.position.set(0, -0.72, 0);
  nozzle.rotation.z = 0.16;
  inner.add(nozzle);

  const tipGeo = new THREE.SphereGeometry(0.215, 32, 24);
  tipGeo.scale(1, 0.82, 1);
  const tip = new THREE.Mesh(tipGeo, mat.tip);
  tip.position.set(0.055, -0.90, 0);
  inner.add(tip);

  // Заушная дужка
  const hookPts = [
    [0.34, 0.30, 0.00], [0.62, 0.66, 0.04], [0.62, 1.02, 0.08],
    [0.28, 1.26, 0.10], [-0.22, 1.24, 0.09], [-0.58, 0.96, 0.05],
    [-0.70, 0.52, 0.01], [-0.66, 0.14, -0.02],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z));
  const curve = new THREE.CatmullRomCurve3(hookPts, false, 'catmullrom', 0.5);
  inner.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 96, 0.072, 16, false), mat.hook));

  // Набок — чтобы вращение вокруг мировой Y показывало модель со всех сторон
  inner.rotation.z = Math.PI / 2.35;
  inner.position.y = -0.05;

  const outer = new THREE.Group();
  outer.add(inner);
  return outer;
}

/**
 * Ставит сцену на canvas.
 * В покое requestAnimationFrame ОСТАНОВЛЕН — нулевая нагрузка на GPU;
 * последний кадр остаётся в canvas, картинка не пропадает.
 */
export function mountEarbud(canvas, opts = {}) {
  const camZ = opts.distance || 3.95;
  const speed = opts.speed || 1.05;

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
  camera.position.set(0, 0.35, camZ);
  camera.lookAt(0, 0.02, 0);

  scene.add(new THREE.HemisphereLight(0x9fb4ff, 0x0a0a10, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 2.1);
  key.position.set(2.2, 3.0, 2.4);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x7fd7ff, 1.5);
  rim.position.set(-2.6, 0.8, -2.0);
  scene.add(rim);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35);
  fill.position.set(-1.0, -1.4, 1.6);
  scene.add(fill);

  const led = new THREE.MeshBasicMaterial({ color: 0x6ee7a8 });
  const model = buildEarbud(MAT(), led);
  model.rotation.x = 0.16;
  scene.add(model);

  let velocity = 0, target = 0, rafId = null, lastT = 0;

  function resize() {
    const w = canvas.clientWidth || 132;
    const h = canvas.clientHeight || 132;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  function frame(t) {
    const dt = Math.min((t - lastT) / 1000, 0.05);
    lastT = t;
    velocity += (target - velocity) * Math.min(dt * 3.2, 1);
    model.rotation.y += velocity * dt;
    renderer.render(scene, camera);
    if (target === 0 && Math.abs(velocity) < 0.004) {
      velocity = 0;
      rafId = null;              // полная остановка цикла
      return;
    }
    rafId = requestAnimationFrame(frame);
  }

  function pump() {
    if (rafId === null) {
      lastT = performance.now();
      rafId = requestAnimationFrame(frame);
    }
  }

  resize();
  window.addEventListener('resize', () => { resize(); pump(); });
  renderer.render(scene, camera);

  return {
    spinUp()   { target = speed; pump(); },
    spinDown() { target = 0; pump(); },
    pump,
    resize() { resize(); pump(); },
    setLedColor(hex) { led.color.set(hex); pump(); },
  };
}
