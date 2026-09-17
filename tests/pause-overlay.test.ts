import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { openingPauseMenuPausesSimulation, worldSimulationActive } from '../src/core/gameplayModal';

const root = dirname(fileURLToPath(import.meta.url));
const GAME_UI = readFileSync(join(root, '../src/ui/GameUI.ts'), 'utf8');
const GAME = readFileSync(join(root, '../src/core/Game.ts'), 'utf8');
const STYLE = readFileSync(join(root, '../src/style.css'), 'utf8');
const HARNESS = readFileSync(join(root, '../src/dev/UiQaHarness.ts'), 'utf8');

function cssRule(selector: string): string {
  const start = STYLE.indexOf(`${selector} {`);
  expect(start, selector).toBeGreaterThanOrEqual(0);
  const end = STYLE.indexOf('\n}', start);
  expect(end, `${selector} end`).toBeGreaterThan(start);
  return STYLE.slice(start, end + 2);
}

describe('in-game pause overlay', () => {
  it('opens pause as a world overlay instead of the main-menu photo screen', () => {
    expect(GAME_UI).toContain('data-pause-overlay="world"');
    expect(GAME_UI).toContain('class="screen pause-overlay"');
    const pauseFn = GAME_UI.slice(GAME_UI.indexOf('showPause('), GAME_UI.indexOf('showSettings('));
    expect(pauseFn).not.toContain('menu-screen');
    expect(pauseFn).not.toContain('submenu-screen');
    expect(pauseFn).not.toContain('frontier-menu-background');
    expect(cssRule('.screen.pause-overlay')).toContain('background: rgba(4, 7, 10, 0.42);');
    expect(cssRule('.screen.pause-overlay')).toContain('backdrop-filter: none;');
    expect(cssRule('.screen.pause-overlay')).not.toContain('url(');
    expect(cssRule('.screen.pause-overlay')).not.toContain('frontier-menu-background');
  });

  it('keeps TAB pause freezing simulation and resume returning to PLAYING', () => {
    expect(openingPauseMenuPausesSimulation()).toBe(true);
    expect(worldSimulationActive('PAUSED')).toBe(false);
    expect(GAME).toContain('openingPauseMenuPausesSimulation()');
    expect(GAME).toContain('this.ui.showPause(');
    expect(GAME).toContain('this.resumeFromPause()');
    expect(GAME).toContain("this.screenBeforeSettings === 'pause'");
  });

  it('keeps settings from pause on the same world overlay', () => {
    expect(GAME).toContain('this.ui.showSettings(');
    expect(GAME).toContain("this.screenBeforeSettings === 'pause'");
    expect(GAME_UI).toContain('overlayWorld = false');
    expect(GAME_UI).toContain("overlayWorld ? 'screen pause-overlay'");
  });

  it('enlarges pause actions without stretching a photo background', () => {
    expect(cssRule('.pause-overlay .pause-actions .game-button')).toContain('min-height: clamp(64px, 13vh, 96px);');
    expect(cssRule('.pause-window')).toContain('width: min(560px, 92vw);');
    expect(cssRule('.pause-window')).toContain('overflow: visible;');
  });

  it('uses a non-menu canvas stand-in for the pause QA fixture', () => {
    expect(HARNESS).toContain("scene === 'pause'");
    expect(HARNESS).toContain('#6eb7ff');
    expect(HARNESS).toContain('#7bc15a');
  });
});
