import * as THREE from 'three';
import type { MobKind } from '../entities/mobDefinitions';
import { ThreeEntityHost } from '../entities/ThreeEntityHost';

export type MobQaView = 'front' | 'side' | 'rear' | 'three-quarter';

const CAMERA_POSITIONS: Readonly<Record<MobQaView, readonly [number, number, number]>> = {
  front: [0, 1.05, -4],
  side: [4, 1.05, 0],
  rear: [0, 1.05, 4],
  'three-quarter': [3.2, 1.35, -3.2],
};

export function startMobQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  kind: MobKind,
  view: MobQaView,
): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x91b7ca);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.05, 50);
  camera.position.set(...CAMERA_POSITIONS[view]);
  camera.lookAt(0, 0.85, 0);
  scene.add(new THREE.HemisphereLight(0xdcefff, 0x4d4a42, 1.5));
  const key = new THREE.DirectionalLight(0xfff0d2, 2.2);
  key.position.set(-3, 6, -4);
  key.castShadow = true;
  scene.add(key);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(8, 8),
    new THREE.MeshLambertMaterial({ color: 0x668651 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const host = new ThreeEntityHost(scene);
  const { visual, model } = host.createMob(kind);
  scene.add(visual as THREE.Object3D);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:16px monospace;z-index:5">${kind} · ${view}</div>`;

  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };
  resize();
  addEventListener('resize', resize);
  let frame = 0;
  const startedAt = performance.now();
  const render = (now = performance.now()): void => {
    const elapsed = (now - startedAt) / 1000;
    host.syncMob({
      kind,
      model,
      visual,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      walkPhase: elapsed * 5,
      visualAge: elapsed,
      locomotionSpeed: kind === 'chicken' ? 2.2 : 0,
      state: kind === 'skeleton' ? 'attack' : 'idle',
      stateSeconds: elapsed,
      deathSeconds: 0,
      fuseSeconds: 0,
      onFire: false,
      width: 0.6,
      height: 1.8,
      hurtFlashSeconds: 0,
    });
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  render();
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    host.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    renderer.dispose();
  };
}
