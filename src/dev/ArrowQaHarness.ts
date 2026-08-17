import * as THREE from 'three';
import { applyArrowDragAndGravity } from '../combat/ArrowPhysics';
import { ArrowVisualFactory } from '../rendering/ArrowVisualFactory';

interface QaArrow {
  readonly origin: THREE.Vector3;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly initialVelocity: THREE.Vector3;
  readonly visual: THREE.Object3D;
}

const FORWARD = new THREE.Vector3(0, 0, -1);

export function startArrowQaHarness(canvas: HTMLCanvasElement, uiRoot: HTMLElement): () => void {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x84b9d7);
  scene.add(new THREE.HemisphereLight(0xeaf5ff, 0x493e31, 1.65));
  const sun = new THREE.DirectionalLight(0xffedce, 2);
  sun.position.set(-4, 8, 5);
  scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(18, 8), new THREE.MeshLambertMaterial({ color: 0x668a4e }));
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 60);
  camera.position.set(0, 4.8, 10.5);
  camera.lookAt(0, 1.3, 0);
  const visuals = new ArrowVisualFactory();
  const arrows: QaArrow[] = [
    createArrow(-5, 1.2, -1.2, 1.0, visuals, scene),
    createArrow(-5, 2.1, 0, 2.0, visuals, scene),
    createArrow(-5, 3.0, 1.2, 3.0, visuals, scene),
  ];
  uiRoot.innerHTML = '<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:16px monospace;z-index:5">arrow QA · short / medium / full</div>';
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
  let previous = performance.now();
  let accumulator = 0;
  const render = (now: number): void => {
    accumulator += Math.min(0.1, (now - previous) / 1000);
    previous = now;
    while (accumulator >= 0.05) {
      accumulator -= 0.05;
      for (const arrow of arrows) {
        arrow.position.add(arrow.velocity);
        applyArrowDragAndGravity(arrow.velocity);
        if (arrow.position.y < 0.08 || arrow.position.x > 7) {
          arrow.position.copy(arrow.origin);
          arrow.velocity.copy(arrow.initialVelocity);
        }
        arrow.visual.position.copy(arrow.position);
        arrow.visual.quaternion.setFromUnitVectors(FORWARD, arrow.velocity.clone().normalize());
      }
    }
    renderer.render(scene, camera);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    for (const arrow of arrows) arrow.visual.removeFromParent();
    visuals.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    renderer.dispose();
  };
}

function createArrow(
  x: number, y: number, z: number, speed: number,
  visuals: ArrowVisualFactory, scene: THREE.Scene,
): QaArrow {
  const origin = new THREE.Vector3(x, y, z);
  const initialVelocity = new THREE.Vector3(speed, 0.08, 0);
  const visual = visuals.create();
  visual.position.copy(origin);
  scene.add(visual);
  return { origin, position: origin.clone(), velocity: initialVelocity.clone(), initialVelocity, visual };
}
