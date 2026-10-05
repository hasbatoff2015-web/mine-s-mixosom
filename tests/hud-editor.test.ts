import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  formatHudEditorValues,
  hudEditorPairGap,
  hudEditorReadout,
} from '../src/dev/hudEditorMetrics';

const root = dirname(fileURLToPath(import.meta.url));
const MAIN = readFileSync(join(root, '../src/main.ts'), 'utf8');

describe('HUD editor coordinates', () => {
  const tab = { left: 1240, top: 110, width: 139, height: 133 };
  const chatOn = { left: 1265, top: 243, width: 115, height: 104 };

  it('reports left, top, right, and size from the viewport', () => {
    expect(hudEditorReadout(tab, 1400)).toEqual({
      x: 1240, y: 110, right: 21, top: 110, width: 139, height: 133,
    });
  });

  it('keeps the TAB to CHAT ON gap when both boxes move by the same delta', () => {
    const before = hudEditorPairGap(tab, chatOn);
    const after = hudEditorPairGap(
      { ...tab, top: tab.top + 16 },
      { ...chatOn, top: chatOn.top + 16 },
    );
    expect(after).toEqual(before);
    expect(before.vertical).toBe(0);
  });

  it('copies RIGHT/TOP CSS and the live readout', () => {
    const text = formatHudEditorValues({
      origin: 'right-top',
      viewportWidth: 1400,
      viewportHeight: 900,
      tab,
      chatOn,
    });
    expect(text).toContain('RIGHT: 21');
    expect(text).toContain('TOP: 110');
    expect(text).toContain('right: 21px;');
    expect(text).toContain('CHAT ON');
    expect(text).toContain('GAP vertical: 0');
  });

  it('opens only through ?hudEditor=1 and leaves the normal game path in place', () => {
    expect(MAIN).toContain("search.get('hudEditor') === '1'");
    expect(MAIN).toContain('startHudEditorHarness');
    expect(MAIN).toContain('if (!runningDevHarness)');
    expect(MAIN).toContain('new Game(canvas, uiRoot)');
  });
});
