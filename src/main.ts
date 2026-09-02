import './style.css';
import { Game } from './core/Game';
import type { MobKind } from './entities/mobDefinitions';
import type { MobQaView } from './dev/MobQaHarness';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiRoot = document.querySelector<HTMLElement>('#ui-root');

if (!canvas || !uiRoot) throw new Error('Required application roots are missing.');

let disposeApplication = (): void => {};
let runningDevHarness = false;

if (import.meta.env.DEV) {
  const search = new URLSearchParams(location.search);
  const qaMob = search.get('qaMob');
  const qaItem = search.get('qaItem');
  const qaPoseCompare = search.get('qaPoseCompare') === '1' || search.get('qaPoseCompare') === 'true';
  const qaBiome = search.get('qaBiome');
  const qaLighting = search.get('qaLighting');
  const qaBreaking = search.get('qaBreaking') === '1' || search.get('qaBreaking') === 'true';
  const lightingScenes = ['room', 'closed', 'hole', 'cave', 'forest', 'sources', 'high'];
  const qaTime = search.get('qaTime') === 'night' ? 'night' : 'day';
  const qaArrow = search.has('qaArrow');
  const qaPlayer = search.get('qaPlayer') === '1';
  const requestedView = search.get('view');
  const mobKinds = new Set<MobKind>(['cow', 'pig', 'chicken', 'sheep', 'zombie', 'skeleton', 'creeper', 'spider']);
  const qaViews = new Set<MobQaView>(['front', 'side', 'rear', 'three-quarter']);
  if (qaPlayer) {
    runningDevHarness = true;
    void import('./dev/PlayerQaHarness').then(async ({ startPlayerQaHarness }) => {
      disposeApplication = await startPlayerQaHarness(canvas, uiRoot);
    });
  } else if (qaArrow) {
    runningDevHarness = true;
    void import('./dev/ArrowQaHarness').then(({ startArrowQaHarness }) => {
      disposeApplication = startArrowQaHarness(canvas, uiRoot);
    });
  } else if (qaBreaking) {
    runningDevHarness = true;
    void import('./dev/BreakingQaHarness').then(async ({ startBreakingQaHarness }) => {
      disposeApplication = await startBreakingQaHarness(canvas, uiRoot);
    });
  } else if ((qaBiome && ['plains', 'forest', 'desert'].includes(qaBiome)) || (qaLighting && lightingScenes.includes(qaLighting))) {
    runningDevHarness = true;
    void import('./dev/VegetationQaHarness').then(async ({ startVegetationQaHarness }) => {
      disposeApplication = await startVegetationQaHarness(
        canvas,
        uiRoot,
        (qaBiome ?? 'plains') as 'plains' | 'forest' | 'desert',
        qaTime,
        qaLighting && lightingScenes.includes(qaLighting) ? qaLighting as import('./dev/lightingQaScenes').LightingQaScene : undefined,
      );
    });
  } else if (qaItem || qaPoseCompare) {
    runningDevHarness = true;
    void import('./dev/ItemQaHarness').then(async ({ startItemQaHarness }) => {
      disposeApplication = await startItemQaHarness(canvas, uiRoot, qaItem || 'iron_pickaxe');
    });
  } else if (qaMob && mobKinds.has(qaMob as MobKind)) {
    runningDevHarness = true;
    const view = qaViews.has(requestedView as MobQaView) ? requestedView as MobQaView : 'three-quarter';
    void import('./dev/MobQaHarness').then(({ startMobQaHarness }) => {
      disposeApplication = startMobQaHarness(canvas, uiRoot, qaMob as MobKind, view);
    });
  }
}

if (!runningDevHarness) {
  const game = new Game(canvas, uiRoot);
  disposeApplication = () => game.dispose();
  void game.initialize().catch((error) => {
    console.error(error);
    uiRoot.innerHTML = `<section class="screen"><div class="menu-card"><h1>Не удалось запустить игру</h1><p>${String(error instanceof Error ? error.message : error)}</p><button class="game-button primary" onclick="location.reload()">Перезагрузить</button></div></section>`;
  });
}

if (import.meta.hot) import.meta.hot.dispose(() => disposeApplication());
