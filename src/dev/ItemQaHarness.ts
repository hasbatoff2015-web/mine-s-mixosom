import * as THREE from 'three';
import { isKnownItemId } from '../items';
import { FirstPersonRenderer, type FirstPersonFrameState } from '../rendering/FirstPersonRenderer';
import { ItemVisualFactory } from '../rendering/ItemVisualFactory';
import { TextureAtlas } from '../rendering/TextureAtlas';

export type ItemQaMode = 'empty' | 'drops' | string;

export async function startItemQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  mode: ItemQaMode,
): Promise<() => void> {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x80b5d4);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 50);
  camera.position.set(0, 2.2, 5.2);
  camera.lookAt(0, 0.8, 0);
  scene.add(new THREE.HemisphereLight(0xe7f3ff, 0x4c4233, 1.55));
  const light = new THREE.DirectionalLight(0xffe5be, 2);
  light.position.set(-3, 6, 4);
  scene.add(light);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(12, 12),
    new THREE.MeshLambertMaterial({ color: 0x668a4e }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);
  const atlas = await TextureAtlas.create(Math.min(renderer.capabilities.getMaxAnisotropy(), 8));
  const visuals = new ItemVisualFactory({ atlas });
  await visuals.preload();
  const viewmodel = new FirstPersonRenderer(visuals);
  const dropped: THREE.Group[] = [];
  const qaItem = mode !== 'empty' && mode !== 'drops' && isKnownItemId(mode) ? mode : undefined;
  const requestedPose = new URLSearchParams(location.search).get('pose');

  if (mode === 'drops') {
    const samples = [
      ['apple', 1], ['feather', 2], ['coal', 18], ['stick', 33], ['stone', 1],
    ] as const;
    samples.forEach(([itemId, count], index) => {
      const visual = visuals.createDroppedItemVisual(itemId, count);
      visual.position.set((index - 2) * 1.25, 0.48, 0);
      visual.userData.phase = index * 0.83;
      scene.add(visual);
      dropped.push(visual);
    });
  } else {
    viewmodel.setHeldItems(qaItem);
  }

  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:16px monospace;z-index:5">item QA · ${mode}</div>`;
  const resize = (): void => {
    const width = Math.max(1, innerWidth);
    const height = Math.max(1, innerHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    viewmodel.resize(width, height);
  };
  resize();
  addEventListener('resize', resize);

  const state: FirstPersonFrameState = {
    visible: mode !== 'drops', movementSpeed: 0, onGround: true, sprinting: false,
    mining: false, foodUseProgress: 0, bowCharge: 0, shieldRaised: false,
  };
  let frame = 0;
  let previous = performance.now();
  let elapsed = 0;
  const render = (now: number): void => {
    const delta = Math.min(0.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    elapsed += delta;
    if (mode === 'drops') {
      dropped.forEach((visual) => {
        const phase = Number(visual.userData.phase ?? 0);
        visual.rotation.y = elapsed * 1.15 + phase;
        visual.position.y = 0.48 + Math.sin(elapsed * 2.2 + phase) * 0.06;
      });
    } else {
      state.movementSpeed = requestedPose === 'idle' ? 0 : 1.8;
      state.foodUseProgress = qaItem === 'apple' ? (elapsed % 2.2) / 2.2 : 0;
      state.bowCharge = qaItem === 'bow'
        ? requestedPose === 'base' ? 0 : requestedPose === 'partial' ? 0.5 : requestedPose === 'full' ? 1 : (elapsed % 2.2) / 2.2
        : 0;
      state.shieldRaised = qaItem === 'shield';
      viewmodel.update(delta, state);
    }
    renderer.render(scene, camera);
    if (mode !== 'drops') viewmodel.render(renderer);
    frame = requestAnimationFrame(render);
  };
  frame = requestAnimationFrame(render);

  return () => {
    cancelAnimationFrame(frame);
    removeEventListener('resize', resize);
    viewmodel.dispose();
    visuals.dispose();
    atlas.dispose();
    ground.geometry.dispose();
    (ground.material as THREE.Material).dispose();
    renderer.dispose();
  };
}
