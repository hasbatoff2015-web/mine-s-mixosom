import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { CROUCH_ICON, INVENTORY_ICON, JUMP_ICON } from '../src/input/touchIcons';

const style = readFileSync('src/style.css', 'utf8');
const icons = readFileSync('src/input/touchIcons.ts', 'utf8');

interface Box {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface LayoutSnapshot {
  readonly viewport: { readonly width: number; readonly height: number };
  readonly jump: Box;
  readonly crouch: Box;
  readonly inventory: Box;
  readonly hotbar: Box;
  readonly slot: Box;
  readonly offhand: Box;
  readonly corner: Box;
  readonly slotVar: string;
}

function chromeBinary(): string {
  const candidates = [
    '/usr/local/bin/google-chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  for (const path of candidates) {
    if (existsSync(path)) return path;
  }
  return candidates[0] ?? 'google-chrome';
}

function pageHtml(): string {
  const slots = Array.from({ length: 9 }, () => '<div class="slot"></div>').join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${style}</style></head><body>
<div id="app">
  <div id="hud">
    <div id="hotbar">${slots}</div>
    <div id="offhand-hud"><div class="slot"></div></div>
    <div id="status-bars"></div>
    <div id="hud-corner">
      <button type="button">Пауза</button>
      <button type="button">Чат</button>
      <button type="button">Меню</button>
    </div>
    <div id="play-info">Игроков: 1
X: 0  Y: 64  Z: 0</div>
  </div>
  <div id="touch-actions">
    <button type="button" data-action="jump" aria-label="Прыжок">${JUMP_ICON}</button>
    <button type="button" data-action="sneak" aria-label="Присесть">${CROUCH_ICON}</button>
    <button type="button" data-action="inventory" aria-label="Инвентарь" title="Инвентарь">${INVENTORY_ICON}</button>
  </div>
</div>
</body></html>`;
}

class Cdp {
  private next = 0;
  private readonly pending = new Map<number, {
    resolve: (value: Record<string, unknown>) => void;
    reject: (error: Error) => void;
  }>();

  constructor(private readonly socket: WebSocket) {
    socket.on('message', (raw) => {
      const message = JSON.parse(String(raw)) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: { message?: string };
      };
      if (message.id === undefined) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? 'cdp error'));
      else waiter.resolve(message.result ?? {});
    });
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.next;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
}

async function waitForJson(url: string): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* chrome is still booting */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not open ${url}`);
}

async function launchChrome(width: number, height: number, pageUrl: string): Promise<{
  chrome: ChildProcess;
  socket: WebSocket;
  cdp: Cdp;
  userData: string;
}> {
  const userData = mkdtempSync(join(tmpdir(), 'frontier-layout-'));
  const port = 9340 + width;
  const chrome = spawn(chromeBinary(), [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    // Headless Chrome 148's content height is 87px shorter than --window-size.
    `--window-size=${width},${height + 87}`,
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userData}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ], { stdio: 'ignore' });
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const pages = await fetch(`http://127.0.0.1:${port}/json/list`).then((response) => response.json()) as Array<{
    type: string;
    webSocketDebuggerUrl: string;
  }>;
  const page = pages.find((entry) => entry.type === 'page');
  if (!page) throw new Error('chrome opened no page');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  const cdp = new Cdp(socket);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
  await cdp.send('Page.navigate', { url: pageUrl });
  return { chrome, socket, cdp, userData };
}

describe('coarse mobile layout rects', () => {
  let server: Server | undefined;
  const chromeJobs: Array<{ chrome: ChildProcess; userData: string }> = [];

  afterAll(async () => {
    server?.close();
    for (const job of chromeJobs) job.chrome.kill();
    await new Promise((resolve) => setTimeout(resolve, 250));
    for (const job of chromeJobs) {
      try {
        rmSync(job.userData, { recursive: true, force: true });
      } catch {
        /* Chrome can still be flushing the profile. */
      }
    }
  });

  async function measure(width: number, height: number, pageUrl: string): Promise<LayoutSnapshot> {
    const launched = await launchChrome(width, height, pageUrl);
    chromeJobs.push(launched);
    const { cdp } = launched;
    await cdp.send('Page.navigate', { url: `${pageUrl}?w=${width}&h=${height}` });
    let sized = false;
    for (let attempt = 0; attempt < 30 && !sized; attempt += 1) {
      const probe = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'JSON.stringify({ w: window.innerWidth, h: window.innerHeight })',
      });
      const raw = (probe.result as { value?: string } | undefined)?.value;
      const size = raw ? JSON.parse(raw) as { w: number; h: number } : undefined;
      sized = size?.w === width && size?.h === height;
      if (!sized) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!sized) throw new Error(`viewport did not settle at ${width}x${height}`);
    let ready = false;
    for (let attempt = 0; attempt < 30 && !ready; attempt += 1) {
      const probe = await cdp.send('Runtime.evaluate', {
        returnByValue: true,
        expression: '!!document.querySelector(\'[data-action="jump"]\')',
      });
      ready = (probe.result as { value?: boolean } | undefined)?.value === true;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error(`layout page did not render at ${width}x${height}`);
    const evaluated = await cdp.send('Runtime.evaluate', {
      returnByValue: true,
      expression: `(() => {
        const box = (el) => {
          const r = el.getBoundingClientRect();
          return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        };
        const app = document.querySelector('#app');
        const slot = document.querySelector('#hotbar .slot');
        return {
          viewport: { width: window.innerWidth, height: window.innerHeight },
          visual: window.visualViewport ? { width: window.visualViewport.width, height: window.visualViewport.height } : null,
          coarse: matchMedia('(pointer: coarse)').matches,
          jump: box(document.querySelector('[data-action="jump"]')),
          crouch: box(document.querySelector('[data-action="sneak"]')),
          inventory: box(document.querySelector('[data-action="inventory"]')),
          hotbar: box(document.querySelector('#hotbar')),
          slot: box(slot),
          offhand: box(document.querySelector('#offhand-hud')),
          corner: box(document.querySelector('#hud-corner')),
          slotVar: getComputedStyle(app).getPropertyValue('--hotbar-slot').trim(),
          inventoryLabel: document.querySelector('[data-action="inventory"]')?.getAttribute('aria-label'),
          backpack: document.querySelector('[data-action="inventory"] svg')?.getAttribute('shape-rendering'),
        };
      })()`,
    });
    const result = evaluated.result as { value?: LayoutSnapshot & {
      coarse?: boolean;
      visual?: { width: number; height: number } | null;
      inventoryLabel?: string;
      backpack?: string;
    } };
    const value = result.value;
    if (!value) throw new Error(`layout probe returned no value: ${JSON.stringify(evaluated)}`);
    expect(value.coarse, `touch emulation should make the pointer coarse (${JSON.stringify(value.viewport)} visual ${JSON.stringify(value.visual)})`).toBe(true);
    expect(value.viewport.width, JSON.stringify(value)).toBe(width);
    expect(value.viewport.height).toBe(height);
    expect(value.visual?.width).toBe(width);
    expect(value.visual?.height).toBe(height);
    expect(value.inventoryLabel).toBe('Инвентарь');
    expect(value.backpack).toBe('crispEdges');
    return value;
  }

  it('stacks jump over crouch and enlarges the hotbar at 844x390 and 800x360', async () => {
    expect(icons).toContain('shape-rendering="crispEdges"');
    expect(icons).not.toContain('🎒');
    expect(icons).not.toContain('▦');
    const html = pageHtml();
    server = createServer((_req, response) => {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(html);
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('layout server has no port');
    const pageUrl = `http://127.0.0.1:${address.port}/`;
    const wide = await measure(844, 390, pageUrl);
    const narrow = await measure(800, 360, pageUrl);
    assertStack(wide, 40);
    assertStack(narrow, 38);
  }, 60_000);
});

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
}

function assertStack(layout: LayoutSnapshot, minSlot: number): void {
  const center = (box: Box): number => (box.left + box.right) / 2;
  expect(Math.abs(center(layout.jump) - center(layout.crouch))).toBeLessThanOrEqual(1);
  expect(layout.jump.bottom).toBeLessThanOrEqual(layout.crouch.top);
  const gap = layout.crouch.top - layout.jump.bottom;
  expect(gap).toBeGreaterThanOrEqual(7);
  expect(gap).toBeLessThanOrEqual(10);
  expect(layout.jump.top).toBeGreaterThanOrEqual(0);
  expect(layout.crouch.bottom).toBeLessThanOrEqual(layout.viewport.height + 0.5);
  expect(layout.jump.right).toBeLessThanOrEqual(layout.viewport.width + 0.5);
  expect(layout.slot.width).toBeGreaterThanOrEqual(minSlot);
  expect(layout.slot.height).toBeGreaterThanOrEqual(minSlot);
  expect(layout.slot.width).toBeLessThanOrEqual(42.5);
  expect(layout.inventory.width).toBeGreaterThanOrEqual(layout.slot.width - 0.5);
  expect(layout.inventory.height).toBeGreaterThanOrEqual(layout.slot.height - 0.5);
  const rightGap = layout.inventory.left - layout.hotbar.right;
  const leftGap = layout.hotbar.left - layout.offhand.right;
  expect(rightGap).toBeGreaterThan(18);
  expect(rightGap).toBeLessThan(23);
  expect(Math.abs(rightGap - leftGap)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(layout.inventory.bottom - layout.hotbar.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(layout.offhand.bottom - layout.hotbar.bottom)).toBeLessThanOrEqual(1);
  expect(overlaps(layout.jump, layout.crouch)).toBe(false);
  expect(overlaps(layout.jump, layout.hotbar)).toBe(false);
  expect(overlaps(layout.crouch, layout.hotbar)).toBe(false);
  expect(overlaps(layout.jump, layout.inventory)).toBe(false);
  expect(overlaps(layout.crouch, layout.inventory)).toBe(false);
  expect(overlaps(layout.jump, layout.corner)).toBe(false);
  expect(overlaps(layout.crouch, layout.corner)).toBe(false);
  expect(overlaps(layout.inventory, layout.hotbar)).toBe(false);
  expect(overlaps(layout.offhand, layout.hotbar)).toBe(false);
}
