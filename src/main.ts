import './style.css';
import { Game } from './core/Game';

const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
const uiRoot = document.querySelector<HTMLElement>('#ui-root');

if (!canvas || !uiRoot) throw new Error('Required application roots are missing.');

const game = new Game(canvas, uiRoot);
void game.initialize().catch((error) => {
  console.error(error);
  uiRoot.innerHTML = `<section class="screen"><div class="menu-card"><h1>Не удалось запустить игру</h1><p>${String(error instanceof Error ? error.message : error)}</p><button class="game-button primary" onclick="location.reload()">Перезагрузить</button></div></section>`;
});

if (import.meta.hot) import.meta.hot.dispose(() => game.dispose());
