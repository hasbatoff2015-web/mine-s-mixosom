import * as THREE from 'three';
import { applyArrowDragAndGravity } from '../combat/ArrowPhysics';
import { ARROW_FORWARD, ArrowVisualFactory } from '../rendering/ArrowVisualFactory';

interface QaArrow {
  readonly origin: THREE.Vector3;
  readonly position: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  readonly initialVelocity: THREE.Vector3;
  readonly visual: THREE.Object3D;
}

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
  const wall = new THREE.Mesh(new THREE.BoxGeometry(3, 2, 0.2), new THREE.MeshBasicMaterial({ color: 0x858383 }));
  wall.position.set(0, 1, 0);
  scene.add(wall);
  const arrows: QaArrow[] = [];
  const search = new URLSearchParams(location.search);
  let mode = search.get('arrowScene') ?? 'wall';
  let angle = search.get('arrowView') ?? 'angle';
  let flaming = search.get('arrowFire') === '1';
  const focus = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const views: Record<string, readonly [number, number, number]> = {
    front: [0, 0.1, 2], back: [0, 0.1, -2], side: [2, 0.12, 0], top: [0.01, 2, 0], angle: [1.4, 0.8, -1.4],
  };
  const cameraView = (): void => {
    const offset = views[angle] ?? views.angle!;
    camera.position.copy(focus).add(new THREE.Vector3(...offset).multiplyScalar(mode === 'flying' ? 4 : mode === 'stress' ? 3 : 1));
    camera.lookAt(focus);
  };
  const populate = (): void => {
    for (const arrow of arrows) arrow.visual.removeFromParent();
    arrows.length = 0;
    wall.visible = mode === 'wall';
    ground.visible = mode !== 'inspect';
    focus.set(0, mode === 'ground' ? 0.35 : 1, -0.4);
    const count = mode === 'stress' ? 120 : mode === 'flying' ? 3 : 1;
    for (let i = 0; i < count; i++) {
      const arrow = createArrow(0, 1, -0.135, i + 1, visuals, scene, flaming);
      if (mode === 'flying') arrow.origin.set(-5, 1 + i, 0);
      else if (mode === 'ground') arrow.origin.set(0, 0.035, 0);
      else if (mode === 'stress') arrow.origin.set((i % 12 - 5.5) * 0.23, 0.5 + Math.floor(i / 12) * 0.15, 0);
      arrow.position.copy(arrow.origin);
      arrow.visual.position.copy(arrow.origin);
      if (mode !== 'flying') arrow.velocity.set(0, mode === 'ground' ? -1 : 0, mode === 'ground' ? 0 : 1);
      arrow.visual.quaternion.setFromUnitVectors(ARROW_FORWARD, direction.copy(arrow.velocity).normalize());
      arrows.push(arrow);
    }
    cameraView();
  };
  uiRoot.innerHTML = `<div style="position:fixed;left:12px;top:12px;background:#111e;color:white;padding:12px;pointer-events:auto;z-index:10;font:14px monospace">
    <div>Arrow QA · +Z forward · same player/skeleton factory</div>
    <div>${['inspect', 'wall', 'ground', 'flying', 'stress'].map((name) => `<button data-scene="${name}">${name}</button>`).join(' ')}</div>
    <div>${Object.keys(views).map((name) => `<button data-view="${name}">${name}</button>`).join(' ')} <button data-fire>normal / fire</button></div>
    <output></output></div>`;
  const click = (event: MouseEvent): void => {
    const element = event.target as HTMLElement;
    if (element.dataset.scene) { mode = element.dataset.scene; populate(); }
    if (element.dataset.view) { angle = element.dataset.view; cameraView(); }
    if (element.hasAttribute('data-fire')) { flaming = !flaming; populate(); }
  };
  uiRoot.addEventListener('click', click);
  populate();
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
  let lastStats = 0;
  const render = (now: number): void => {
    accumulator += Math.min(0.1, (now - previous) / 1000);
    previous = now;
    while (accumulator >= 0.05) {
      accumulator -= 0.05;
      if (mode !== 'flying') continue;
      for (const arrow of arrows) {
        arrow.position.add(arrow.velocity);
        applyArrowDragAndGravity(arrow.velocity);
        if (arrow.position.y < 0.08 || arrow.position.x > 7) {
          arrow.position.copy(arrow.origin);
          arrow.velocity.copy(arrow.initialVelocity);
        }
        arrow.visual.position.copy(arrow.position);
        arrow.visual.quaternion.setFromUnitVectors(ARROW_FORWARD, direction.copy(arrow.velocity).normalize());
      }
    }
    renderer.render(scene, camera);
    if (now - lastStats > 250) {
      lastStats = now;
      uiRoot.querySelector('output')!.textContent = `${mode} / ${angle} / ${flaming ? 'fire' : 'normal'} · arrows ${arrows.length} · geometries ${renderer.info.memory.geometries} · textures ${renderer.info.memory.textures} · calls ${renderer.info.render.calls} · triangles ${renderer.info.render.triangles}`;
    }
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);
  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    uiRoot.removeEventListener('click', click);
    for (const arrow of arrows) arrow.visual.removeFromParent();
    visuals.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    wall.geometry.dispose();
    wall.material.dispose();
    renderer.dispose();
  };
}

function createArrow(
  x: number, y: number, z: number, speed: number,
  visuals: ArrowVisualFactory, scene: THREE.Scene, flaming = false,
): QaArrow {
  const origin = new THREE.Vector3(x, y, z);
  const initialVelocity = new THREE.Vector3(speed, 0.08, 0);
  const visual = visuals.create(flaming);
  visual.position.copy(origin);
  scene.add(visual);
  return { origin, position: origin.clone(), velocity: initialVelocity.clone(), initialVelocity, visual };
}
