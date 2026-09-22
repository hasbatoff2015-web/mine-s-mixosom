import * as THREE from 'three';
import type { MobKind } from '../entities/mobDefinitions';
import { ThreeEntityHost } from '../entities/ThreeEntityHost';
import { isCatVariant, type CatVariant } from '../entities/petTypes';
import { petBodyTexturePath } from '../entities/petAppearance';

export type MobQaView = 'front' | 'side' | 'rear' | 'three-quarter';
export type MobQaPetState = 'wild' | 'angry' | 'tamed' | 'sitting';

export interface MobQaOptions {
  readonly petState?: string | null;
  readonly variant?: string | null;
  readonly walkPhase?: string | null;
}

const CAMERA_POSITIONS: Readonly<Record<MobQaView, readonly [number, number, number]>> = {
  front: [0, 1.05, -4],
  side: [4, 1.05, 0],
  rear: [0, 1.05, 4],
  'three-quarter': [3.2, 1.35, -3.2],
};

function resolvePetState(raw: string | null | undefined): MobQaPetState {
  if (raw === 'angry' || raw === 'tamed' || raw === 'sitting' || raw === 'wild') return raw;
  return 'wild';
}

export function startMobQaHarness(
  canvas: HTMLCanvasElement,
  uiRoot: HTMLElement,
  kind: MobKind,
  view: MobQaView,
  options: MobQaOptions = {},
): () => void {
  const petState = resolvePetState(options.petState);
  const variant: CatVariant | undefined = kind === 'cat' && isCatVariant(options.variant ?? undefined)
    ? options.variant as CatVariant
    : kind === 'cat' ? 'black' : undefined;
  const sitting = petState === 'sitting';
  const ownerId = petState === 'tamed' || petState === 'sitting' ? 'qa-owner' : undefined;
  const angry = petState === 'angry';
  const rawWalkPhase = options.walkPhase;
  const frozenWalkPhase = rawWalkPhase != null && rawWalkPhase !== '' ? Number(rawWalkPhase) : Number.NaN;
  const hasFrozenWalk = Number.isFinite(frozenWalkPhase);
  const texturePath = petBodyTexturePath({
    kind,
    ownerId,
    angry,
    variant,
  });
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
  const { visual, model } = host.createMob(kind, texturePath ? { texturePath } : undefined);
  scene.add(visual as THREE.Object3D);
  const labelBits: string[] = [kind, view, petState];
  if (variant) labelBits.push(variant);
  if (hasFrozenWalk) labelBits.push(`walkPhase=${frozenWalkPhase.toFixed(2)}`);
  uiRoot.innerHTML = `<div id="qa-label" style="position:fixed;left:16px;top:16px;padding:8px 12px;background:#111c;color:#fff;font:16px monospace;z-index:5">${labelBits.join(' · ')}</div>`;

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
    const walking = !sitting && (kind === 'chicken' || kind === 'wolf' || kind === 'cat');
    host.syncMob({
      kind,
      model,
      visual,
      x: 0,
      y: 0,
      z: 0,
      yaw: 0,
      walkPhase: sitting ? 0 : hasFrozenWalk ? frozenWalkPhase : elapsed * 5,
      visualAge: elapsed,
      locomotionSpeed: walking ? 2.2 : 0,
      state: kind === 'skeleton' ? 'attack' : 'idle',
      stateSeconds: elapsed,
      deathSeconds: 0,
      fuseSeconds: 0,
      onFire: false,
      width: kind === 'wolf' || kind === 'cat' ? 0.6 : 0.6,
      height: kind === 'cat' ? 0.7 : kind === 'wolf' ? 0.85 : 1.8,
      hurtFlashSeconds: 0,
      sitting,
      ownerId,
      variant,
      angry,
      health: kind === 'wolf' || kind === 'cat' ? 8 : 20,
      maxHealth: kind === 'wolf' || kind === 'cat' ? 8 : 20,
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
