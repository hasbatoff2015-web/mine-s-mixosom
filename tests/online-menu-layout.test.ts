/**
 * @vitest-environment happy-dom
 *
 * Real Chrome geometry for the online menu. happy-dom does not lay out CSS Grid.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, get as httpGet, type Server } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, normalize, sep } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { GameUI } from '../src/ui/GameUI';
import { checkingServerStatuses } from '../src/net/AnarchyClient';

const tokens = readFileSync('src/uiTokens.css', 'utf8');
const style = readFileSync('src/style.css', 'utf8');
const publicRoot = join(process.cwd(), 'public');
const artifactDir = existsSync('/opt/cursor/artifacts')
  ? '/opt/cursor/artifacts/online-menu-layout'
  : join(tmpdir(), 'online-menu-layout');

interface Box {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

interface ButtonBox {
  text: string;
  disabled: boolean;
  hit: boolean;
  box: Box;
}

interface ScrollProbe {
  canScroll: boolean;
  toolbarMoved: boolean;
  cardMoved: boolean;
  lastInside: boolean;
}

interface LayoutSnapshot {
  viewport: { width: number; height: number };
  zoom: string;
  grid: string;
  scrollWidth: number;
  window: Box;
  header: Box;
  note: Box | null;
  noteHidden: boolean;
  footer: Box;
  panel: Box | null;
  toolbar: Box | null;
  refresh: Box | null;
  list: Box | null;
  cards: Box[];
  buttons: ButtonBox[];
  scroll: ScrollProbe | null;
  noteOverlapsButtons: boolean;
  toolbarOverlapsCards: boolean;
}

const VIEWPORTS = [
  [1920, 1080],
  [1366, 768],
  [1280, 720],
  [800, 600],
  [844, 390],
  [667, 375],
] as const;

interface LayoutChromeLookup {
  platform: NodeJS.Platform;
  home: string;
  exists: (file: string) => boolean;
  /** True when `executable --version` identifies Chrome or Chromium. No shell. */
  probe: (executable: string) => boolean;
}

type LayoutChromeResolution =
  | { status: 'found'; executable: string; source: string }
  | { status: 'missing'; message: string }
  | { status: 'invalid-path'; message: string };

const LINUX_CHROME_BINS = [
  '/usr/bin/google-chrome',
  '/usr/local/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/snap/bin/chromium',
];

const PATH_CHROME_COMMANDS = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
  'chrome.exe',
  'chromium.exe',
];

function chromeAcceptsVersion(executable: string): boolean {
  try {
    const result = spawnSync(executable, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: false,
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return false;
    return /Chrome|Chromium/i.test(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
  } catch {
    return false;
  }
}

function windowsChromeBins(env: NodeJS.ProcessEnv): string[] {
  const roots = [env.ProgramFiles, env['ProgramFiles(x86)'], env.LOCALAPPDATA].filter((value): value is string => Boolean(value && value.trim()));
  const tails = [
    join('Google', 'Chrome', 'Application', 'chrome.exe'),
    join('Chromium', 'Application', 'chrome.exe'),
    join('Chromium', 'Application', 'chromium.exe'),
  ];
  return roots.flatMap((root) => tails.map((tail) => join(root, tail)));
}

function macChromeBins(home: string): string[] {
  const apps = [
    join('Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome'),
    join('Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  ];
  return [
    ...apps.map((app) => join('/Applications', app)),
    ...apps.map((app) => join(home, 'Applications', app)),
  ];
}

function explicitChrome(env: NodeJS.ProcessEnv, lookup: LayoutChromeLookup): LayoutChromeResolution | undefined {
  const specified = [
    ['CHROME_PATH', env.CHROME_PATH],
    ['CHROME_BIN', env.CHROME_BIN],
  ] as const;
  for (const [name, value] of specified) {
    if (value === undefined || value.trim() === '') continue;
    const executable = value.trim();
    if (!lookup.exists(executable)) {
      return {
        status: 'invalid-path',
        message: `${name} does not point to a file (${executable}). The layout test does not switch to another browser.`,
      };
    }
    if (!lookup.probe(executable)) {
      return {
        status: 'invalid-path',
        message: `${name} is not a Chrome or Chromium binary that accepts --version (${executable}). The layout test does not switch to another browser.`,
      };
    }
    return { status: 'found', executable, source: name };
  }
  return undefined;
}

function resolveLayoutChrome(env: NodeJS.ProcessEnv = process.env, lookup: Partial<LayoutChromeLookup> = {}): LayoutChromeResolution {
  if (env.LAYOUT_CHROME_FIXTURE === 'missing' && !env.CHROME_PATH?.trim() && !env.CHROME_BIN?.trim()) {
    return {
      status: 'missing',
      message: 'No Chrome or Chromium executable was found. Install one or set CHROME_PATH. Without RUN_BROWSER_LAYOUT_TESTS=1 this geometry check is skipped, not passed.',
    };
  }
  const full: LayoutChromeLookup = {
    platform: lookup.platform ?? process.platform,
    home: lookup.home ?? homedir(),
    exists: lookup.exists ?? existsSync,
    probe: lookup.probe ?? chromeAcceptsVersion,
  };
  const explicit = explicitChrome(env, full);
  if (explicit) return explicit;
  const native = full.platform === 'win32'
    ? windowsChromeBins(env)
    : full.platform === 'darwin'
      ? macChromeBins(full.home)
      : LINUX_CHROME_BINS;
  const extra = [
    ...(full.platform === 'win32' ? [] : windowsChromeBins(env)),
    ...(full.platform === 'darwin' ? [] : macChromeBins(full.home)),
    ...(full.platform === 'linux' ? [] : LINUX_CHROME_BINS),
  ];
  const seen = new Set<string>();
  for (const candidate of [...native, ...extra]) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (!full.exists(candidate)) continue;
    if (full.probe(candidate)) return { status: 'found', executable: candidate, source: 'installed' };
  }
  for (const command of PATH_CHROME_COMMANDS) {
    if (full.probe(command)) return { status: 'found', executable: command, source: 'PATH' };
  }
  return {
    status: 'missing',
    message: 'No Chrome or Chromium executable was found. Install one or set CHROME_PATH. Without RUN_BROWSER_LAYOUT_TESTS=1 this geometry check is skipped, not passed.',
  };
}

function freeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = address && typeof address === 'object' ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

const layoutChrome = resolveLayoutChrome();
const browserLayoutRequired = process.env.RUN_BROWSER_LAYOUT_TESTS === '1';
const skipGeometry = layoutChrome.status === 'missing' && !browserLayoutRequired;

function screenHtml(render: (ui: GameUI) => void): string {
  const root = document.createElement('div');
  document.body.append(root);
  const ui = new GameUI(root);
  render(ui);
  const html = root.querySelector('.screen')?.outerHTML ?? '';
  root.remove();
  return html;
}

function page(body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${tokens}\n${style}</style></head><body><div id="app"><div id="ui-root">${body}</div></div></body></html>`;
}

function menuActions() {
  return {
    back: () => undefined,
    connect: () => undefined,
    retry: () => undefined,
    saveNickname: (raw: string) => ({ ok: true as const, name: raw }),
  };
}

const pages: Record<string, string> = {
  '/list': page(screenHtml((ui) => ui.showOnlineServers(menuActions(), {
    anarchy: { phase: 'unavailable', reason: 'network' },
    survival: { phase: 'unavailable', reason: 'network' },
    peaceful: { phase: 'not_configured' },
  }, 'anarchy', 'Steve'))),
  '/ok': page(screenHtml((ui) => ui.showOnlineServers(menuActions(), {
    anarchy: { phase: 'available', online: 3, maxPlayers: 300 },
    survival: { phase: 'available', online: 1, maxPlayers: 300 },
    peaceful: { phase: 'available', online: 0, maxPlayers: 300 },
  }, 'anarchy', 'Steve'))),
  '/error': page(screenHtml((ui) => ui.showOnlineConnectError({
    retry: () => undefined,
    back: () => undefined,
  }))),
};

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

function getText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = httpGet(url, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          return;
        }
        resolve(Buffer.concat(chunks).toString('utf8'));
      });
    });
    request.on('error', reject);
  });
}

async function waitForJson(url: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await getText(url);
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Chrome did not open ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

function contentType(path: string): string {
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}

const MEASURE = `(() => {
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const round = (value) => Math.round(value * 10) / 10;
    return { top: round(r.top), left: round(r.left), right: round(r.right), bottom: round(r.bottom), width: round(r.width), height: round(r.height) };
  };
  const overlaps = (a, b) => !!a && !!b && a.width > 0 && b.width > 0 && a.bottom > b.top + 1 && a.top < b.bottom - 1 && a.right > b.left + 1 && a.left < b.right - 1;
  const windowEl = document.querySelector('.menu-window');
  const list = document.querySelector('.server-list');
  const toolbar = document.querySelector('.server-list-toolbar');
  const cards = [...document.querySelectorAll('.server-row')];
  const note = document.querySelector('.server-connect-error, [data-server-note]');
  const buttons = [...document.querySelectorAll('.server-menu-actions .game-button')].map((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(r.height / 2, 24));
    return { text: el.textContent.trim(), disabled: el.disabled, hit: !!hit && (hit === el || el.contains(hit)), box: box(el) };
  });
  let scroll = null;
  if (list && toolbar && cards.length) {
    const beforeToolbar = toolbar.getBoundingClientRect().top;
    const beforeCard = cards[0].getBoundingClientRect().top;
    list.scrollTop = list.scrollHeight;
    const afterToolbar = toolbar.getBoundingClientRect().top;
    const afterCard = cards[0].getBoundingClientRect().top;
    const last = cards[cards.length - 1].getBoundingClientRect();
    const listBox = list.getBoundingClientRect();
    scroll = {
      canScroll: list.scrollHeight > list.clientHeight + 1,
      toolbarMoved: Math.abs(afterToolbar - beforeToolbar) > 0.5,
      cardMoved: beforeCard - afterCard > 1,
      lastInside: last.bottom <= listBox.bottom + 2 && last.top >= listBox.top - 2,
    };
    list.scrollTop = 0;
  }
  const noteBox = box(note);
  const cardBoxes = cards.map(box);
  return {
    viewport: { width: window.innerWidth, height: window.innerHeight },
    zoom: getComputedStyle(windowEl).zoom,
    grid: getComputedStyle(windowEl).gridTemplateRows,
    scrollWidth: document.documentElement.scrollWidth,
    window: box(windowEl),
    header: box(document.querySelector('.menu-heading')),
    note: noteBox,
    noteHidden: !note || note.hasAttribute('hidden') || getComputedStyle(note).display === 'none',
    footer: box(document.querySelector('.menu-footer')),
    panel: box(document.querySelector('.server-list-panel')),
    toolbar: box(toolbar),
    refresh: box(document.querySelector('.server-refresh-button')),
    list: box(list),
    cards: cardBoxes,
    buttons,
    scroll,
    noteOverlapsButtons: !!noteBox && !(!note || note.hasAttribute('hidden') || getComputedStyle(note).display === 'none') && buttons.some((button) => overlaps(noteBox, button.box)),
    toolbarOverlapsCards: !!toolbar && cardBoxes.some((card) => overlaps(box(toolbar), card)),
  };
})()`;

describe('layout chrome discovery', () => {
  const chromeAt = (file: string) => ({
    exists: (candidate: string) => candidate === file,
    probe: (candidate: string) => candidate === file,
  });

  it('uses CHROME_PATH before an installed browser', () => {
    const explicit = join('/opt', 'Google Chrome', 'chrome');
    const installed = '/usr/bin/google-chrome';
    const probed: string[] = [];
    const found = resolveLayoutChrome({
      CHROME_PATH: explicit,
      CHROME_BIN: '/elsewhere/chrome',
    }, {
      exists: (candidate) => candidate === explicit || candidate === installed,
      probe: (candidate) => {
        probed.push(candidate);
        return candidate === explicit || candidate === installed;
      },
    });
    expect(found).toEqual({ status: 'found', executable: explicit, source: 'CHROME_PATH' });
    expect(probed).toEqual([explicit]);
  });

  it('uses CHROME_BIN when CHROME_PATH is unset', () => {
    const explicit = join('/Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
    const found = resolveLayoutChrome({ CHROME_BIN: explicit }, chromeAt(explicit));
    expect(found).toEqual({ status: 'found', executable: explicit, source: 'CHROME_BIN' });
  });

  it('reports a missing CHROME_PATH instead of searching further', () => {
    const missing = join('/missing', 'chrome with spaces');
    const probed: string[] = [];
    const found = resolveLayoutChrome({ CHROME_PATH: missing }, {
      exists: () => false,
      probe: (candidate) => {
        probed.push(candidate);
        return true;
      },
    });
    expect(found.status).toBe('invalid-path');
    if (found.status === 'invalid-path') expect(found.message).toContain(missing);
    expect(probed).toEqual([]);
  });

  it('reports a CHROME_PATH that is not Chrome instead of searching further', () => {
    const file = '/tmp/not-chrome';
    const probed: string[] = [];
    const found = resolveLayoutChrome({ CHROME_PATH: file }, {
      exists: (candidate) => candidate === file || candidate === '/usr/bin/google-chrome',
      probe: (candidate) => {
        probed.push(candidate);
        return candidate === '/usr/bin/google-chrome';
      },
    });
    expect(found.status).toBe('invalid-path');
    expect(probed).toEqual([file]);
  });

  it('finds Chrome under Program Files without a hardcoded user name', () => {
    const executable = join('C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe');
    const found = resolveLayoutChrome({ ProgramFiles: 'C:\\Program Files' }, {
      platform: 'win32',
      exists: (candidate) => candidate === executable,
      probe: (candidate) => candidate === executable,
    });
    expect(found).toEqual({ status: 'found', executable, source: 'installed' });
  });

  it('finds the macOS application binary', () => {
    const executable = join('/Applications', 'Google Chrome.app', 'Contents', 'MacOS', 'Google Chrome');
    const found = resolveLayoutChrome({}, {
      platform: 'darwin',
      home: '/Users/player',
      exists: (candidate) => candidate === executable,
      probe: (candidate) => candidate === executable,
    });
    expect(found).toEqual({ status: 'found', executable, source: 'installed' });
  });

  it('uses a browser command from PATH when no installed file answers', () => {
    const found = resolveLayoutChrome({}, {
      platform: 'linux',
      exists: () => false,
      probe: (candidate) => candidate === 'chromium',
    });
    expect(found).toEqual({ status: 'found', executable: 'chromium', source: 'PATH' });
  });

  it('returns missing when nothing answers --version', () => {
    const found = resolveLayoutChrome({ ProgramFiles: 'D:\\Programs' }, {
      platform: 'win32',
      exists: () => false,
      probe: () => false,
    });
    expect(found.status).toBe('missing');
  });
});

describe('online menu geometry in Chrome', () => {
  let server: Server | undefined;
  let chrome: ChildProcess | undefined;
  let socket: WebSocket | undefined;
  let userData = '';
  let cdp: Cdp | undefined;
  const shots: string[] = [];

  afterAll(async () => {
    server?.close();
    socket?.close();
    try {
      chrome?.kill();
    } catch {
      /* The browser may already have exited. */
    }
    cdp = undefined;
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (userData) rmSync(userData, { recursive: true, force: true });
  });

  async function browser(): Promise<Cdp> {
    if (cdp) return cdp;
    server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1');
      const path = decodeURIComponent(url.pathname);
      if (pages[path]) {
        response.setHeader('content-type', 'text/html; charset=utf-8');
        response.end(pages[path]);
        return;
      }
      if (path.startsWith('/fonts/') || path.startsWith('/ui/')) {
        const file = normalize(join(publicRoot, path));
        if (file.startsWith(publicRoot + sep) && existsSync(file)) {
          response.setHeader('content-type', contentType(file));
          response.end(readFileSync(file));
          return;
        }
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server?.listen(0, '127.0.0.1', () => resolve()));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('layout server has no port');
    if (layoutChrome.status !== 'found') {
      throw new Error(layoutChrome.message);
    }
    userData = mkdtempSync(join(tmpdir(), 'online-menu-layout-'));
    const port = await freeTcpPort();
    const executable = layoutChrome.executable;
    chrome = spawn(executable, [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1920,1080',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userData}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ], { stdio: 'ignore', shell: false, windowsHide: true });
    let debuggerReady = false;
    const launchFailed = new Promise<never>((_, reject) => {
      chrome?.once('error', (error) => {
        if (!debuggerReady) reject(new Error(`Failed to start ${executable}: ${error.message}`));
      });
      chrome?.once('exit', (code, signal) => {
        if (!debuggerReady) {
          reject(new Error(`Chrome exited before remote debugging opened (code ${code ?? 'none'}, signal ${signal ?? 'none'}, port ${port}).`));
        }
      });
    });
    await Promise.race([
      waitForJson(`http://127.0.0.1:${port}/json/version`).then(() => {
        debuggerReady = true;
      }),
      launchFailed,
    ]);
    debuggerReady = true;
    const pagesOnBrowser = JSON.parse(await getText(`http://127.0.0.1:${port}/json/list`)) as Array<{
      type: string;
      webSocketDebuggerUrl: string;
    }>;
    const pageInfo = pagesOnBrowser.find((entry) => entry.type === 'page');
    if (!pageInfo) throw new Error(`chrome opened no page on port ${port}`);
    const opened = new WebSocket(pageInfo.webSocketDebuggerUrl);
    socket = opened;
    await new Promise<void>((resolve, reject) => {
      opened.once('open', () => resolve());
      opened.once('error', reject);
    });
    cdp = new Cdp(opened);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    return cdp;
  }

  async function measure(scene: '/list' | '/ok' | '/error', width: number, height: number): Promise<LayoutSnapshot> {
    const client = await browser();
    const address = server?.address();
    if (!address || typeof address === 'string') throw new Error('layout server has no port');
    const url = `http://127.0.0.1:${address.port}${scene}?w=${width}&h=${height}`;
    await client.send('Page.navigate', { url });
    let ready = false;
    for (let attempt = 0; attempt < 40 && !ready; attempt += 1) {
      const probe = await client.send('Runtime.evaluate', {
        returnByValue: true,
        expression: '!!document.querySelector(".menu-window")',
      });
      ready = (probe.result as { value?: boolean } | undefined)?.value === true;
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!ready) throw new Error(`${scene} did not render`);
    await client.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await client.send('Runtime.evaluate', {
      expression: 'document.fonts.ready.then(() => true)',
      awaitPromise: true,
      returnByValue: true,
    });
    let sized = false;
    for (let attempt = 0; attempt < 30 && !sized; attempt += 1) {
      const probe = await client.send('Runtime.evaluate', {
        returnByValue: true,
        expression: 'JSON.stringify({ w: window.innerWidth, h: window.innerHeight })',
      });
      const raw = (probe.result as { value?: string } | undefined)?.value;
      const size = raw ? JSON.parse(raw) as { w: number; h: number } : undefined;
      sized = size?.w === width && size?.h === height;
      if (!sized) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    if (!sized) throw new Error(`viewport did not settle at ${width}x${height} for ${scene}`);
    const evaluated = await client.send('Runtime.evaluate', { returnByValue: true, expression: MEASURE });
    const value = (evaluated.result as { value?: LayoutSnapshot } | undefined)?.value;
    if (!value) throw new Error(`layout probe returned no value for ${scene} ${width}x${height}`);
    mkdirSync(artifactDir, { recursive: true });
    const shot = await client.send('Page.captureScreenshot', { format: 'png' });
    const data = shot.data;
    if (typeof data === 'string') {
      const file = join(artifactDir, `${scene.slice(1)}-${width}x${height}.png`);
      writeFileSync(file, Buffer.from(data, 'base64'));
      shots.push(file);
    }
    return value;
  }

  it.skipIf(skipGeometry)(skipGeometry
    ? 'keeps server-list and connection-error controls inside the window — skipped, Chrome was not found'
    : 'keeps server-list and connection-error controls inside the window', async () => {
    if (layoutChrome.status !== 'found') {
      const detail = layoutChrome.status === 'invalid-path'
        ? layoutChrome.message
        : 'No Chrome or Chromium executable was found. Install one or set CHROME_PATH.';
      throw new Error(browserLayoutRequired
        ? `${detail}\nRUN_BROWSER_LAYOUT_TESTS=1 requires a browser and does not skip this check.`
        : detail);
    }
    mkdirSync(artifactDir, { recursive: true });
    const results: Array<{ scene: string; width: number; height: number; snapshot: LayoutSnapshot }> = [];
    for (const [width, height] of VIEWPORTS) {
      for (const scene of ['/list', '/ok', '/error'] as const) {
        const snapshot = await measure(scene, width, height);
        results.push({ scene, width, height, snapshot });
        const label = `${scene} ${width}x${height}`;
        const zoomed = height <= 520;
        expect(snapshot.viewport, label).toEqual({ width, height });
        expect(snapshot.scrollWidth, label).toBeLessThanOrEqual(width + 1);
        expect(snapshot.window.bottom, label).toBeLessThanOrEqual(height + 1);
        expect(snapshot.window.right, label).toBeLessThanOrEqual(width + 1);
        if (!snapshot.noteHidden && snapshot.note) {
          expect(snapshot.header.bottom, label).toBeLessThanOrEqual(snapshot.note.top + 1);
        }
        expect(snapshot.footer.top, label).toBeGreaterThanOrEqual(snapshot.window.top);
        expect(snapshot.footer.bottom, label).toBeLessThanOrEqual(snapshot.window.bottom + 1);
        expect(snapshot.footer.bottom, label).toBeLessThanOrEqual(height + 1);
        expect(snapshot.buttons, label).toHaveLength(2);
        expect(Math.abs((snapshot.buttons[0]?.box.width ?? 0) - (snapshot.buttons[1]?.box.width ?? 0)), label).toBeLessThan(2);
        expect(Math.abs((snapshot.buttons[0]?.box.height ?? 0) - (snapshot.buttons[1]?.box.height ?? 0)), label).toBeLessThan(1.5);
        for (const button of snapshot.buttons) {
          expect(button.hit, `${label} ${button.text}`).toBe(true);
          expect(button.box.height, `${label} ${button.text}`).toBeGreaterThan(zoomed ? 16 : 46);
          expect(button.box.height, `${label} ${button.text}`).toBeLessThan(zoomed ? 48 : 60);
          expect(button.box.top, `${label} ${button.text}`).toBeGreaterThanOrEqual(snapshot.footer.top - 1);
          expect(button.box.bottom, `${label} ${button.text}`).toBeLessThanOrEqual(snapshot.footer.bottom + 1);
        }
        expect(snapshot.noteOverlapsButtons, label).toBe(false);

        if (scene === '/error') {
          expect(snapshot.buttons.map((button) => button.text), label).toEqual(['Повторить', 'К списку серверов']);
          expect(snapshot.refresh, label).toBeNull();
          expect(snapshot.noteHidden, label).toBe(false);
          expect(snapshot.footer.top - (snapshot.note?.bottom ?? 0), label).toBeGreaterThan(8);
          expect(snapshot.note?.bottom ?? 0, label).toBeLessThanOrEqual(snapshot.footer.top + 1);
        } else {
          expect(snapshot.buttons.map((button) => button.text), label).toEqual(['Подключиться', 'Назад']);
          expect(snapshot.panel, label).toBeTruthy();
          expect(snapshot.toolbar, label).toBeTruthy();
          expect(snapshot.refresh, label).toBeTruthy();
          expect(snapshot.cards, label).toHaveLength(3);
          expect(snapshot.toolbarOverlapsCards, label).toBe(false);
          expect(snapshot.refresh!.bottom, label).toBeLessThanOrEqual((snapshot.list?.top ?? 0) + 1);
          expect(snapshot.toolbar!.bottom, label).toBeLessThanOrEqual((snapshot.cards[0]?.top ?? 0) + 1);
          expect(snapshot.refresh!.right, label).toBeLessThanOrEqual((snapshot.toolbar?.right ?? 0) + 1);
          expect(snapshot.refresh!.height, label).toBeGreaterThan(zoomed ? 16 : 34);
          expect(snapshot.refresh!.height, label).toBeLessThanOrEqual(zoomed ? 32 : 40);
          expect(snapshot.refresh!.height, label).toBeLessThan(snapshot.buttons[0]!.box.height);
          expect(snapshot.refresh!.width, label).toBeGreaterThan(zoomed ? 60 : 110);
          expect(snapshot.refresh!.width, label).toBeLessThan(zoomed ? 100 : 150);
          expect(snapshot.scroll?.toolbarMoved, label).toBe(false);
          if (snapshot.scroll?.canScroll) {
            expect(snapshot.scroll.cardMoved, label).toBe(true);
            expect(snapshot.scroll.lastInside, label).toBe(true);
          } else {
            expect(snapshot.cards[2]!.bottom, label).toBeLessThanOrEqual((snapshot.list?.bottom ?? 0) + 2);
          }
          if (scene === '/ok') {
            expect(snapshot.noteHidden, label).toBe(true);
            expect(snapshot.footer.height, label).toBeLessThan(zoomed ? 70 : 100);
          } else {
            expect(snapshot.noteHidden, label).toBe(false);
            expect(snapshot.note?.bottom ?? 0, label).toBeLessThanOrEqual(snapshot.buttons[0]!.box.top + 1);
            expect(snapshot.footer.height, label).toBeLessThan(zoomed ? 120 : 180);
          }
        }
      }
    }
    if (shots.length > 0) writeFileSync(join(artifactDir, 'measurements.json'), JSON.stringify(results.map((entry) => ({
      scene: entry.scene,
      width: entry.width,
      height: entry.height,
      zoom: entry.snapshot.zoom,
      grid: entry.snapshot.grid,
      refresh: entry.snapshot.refresh,
      buttons: entry.snapshot.buttons.map((button) => ({ text: button.text, height: button.box.height, width: button.box.width })),
      footer: entry.snapshot.footer,
      note: entry.snapshot.note,
      scroll: entry.snapshot.scroll,
      window: { height: entry.snapshot.window.height, bottom: entry.snapshot.window.bottom },
    })), null, 2));
  }, 180000);
});
