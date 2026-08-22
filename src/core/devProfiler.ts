import { RollingTimingWindow, type TimingSnapshot } from './PerformanceStats';

export interface FrameCostBreakdown {
  frameMs: number;
  tickMs: number;
  generateMs: number;
  lightMs: number;
  meshMs: number;
  entityMs: number;
  renderMs: number;
  otherMs: number;
}

export interface PerfSnapshot {
  readonly fps: number;
  readonly frame: TimingSnapshot & { readonly p99Ms: number };
  readonly tick: TimingSnapshot & { readonly p99Ms: number };
  readonly renderMs: number;
  readonly generateJobs: number;
  readonly meshJobs: number;
  readonly waitingMesh: number;
  readonly waitingGenerate: number;
  readonly lightingJobs: number;
  readonly dirtyChunks: number;
  readonly blockMutations: number;
  readonly mobCount: number;
  readonly entityUpdateMs: number;
  readonly heapMb?: number;
  readonly lastSpike?: FrameCostBreakdown & { readonly category: string };
}

export function isPerfQueryEnabled(search = typeof location === 'undefined' ? '' : location.search): boolean {
  if (!search) return false;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const value = params.get('perf');
  return value === '1' || value === 'true';
}

export function readPerfScenario(search = typeof location === 'undefined' ? '' : location.search): string | undefined {
  if (!search) return undefined;
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  return params.get('perfScenario') ?? undefined;
}

export function classifySpike(cost: FrameCostBreakdown): string {
  const ranked: Array<[keyof FrameCostBreakdown, number]> = [
    ['meshMs', cost.meshMs],
    ['generateMs', cost.generateMs],
    ['lightMs', cost.lightMs],
    ['tickMs', cost.tickMs],
    ['entityMs', cost.entityMs],
    ['renderMs', cost.renderMs],
  ];
  ranked.sort((a, b) => b[1] - a[1]);
  const [name, value] = ranked[0] ?? ['otherMs', cost.otherMs];
  if (value < 2) return 'frame';
  return String(name).replace(/Ms$/, '');
}

export function readJsHeapMb(): number | undefined {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
  if (!memory?.usedJSHeapSize) return undefined;
  return memory.usedJSHeapSize / (1024 * 1024);
}

/** DEV/QA rolling profiler. No-ops when disabled so production skips p99 work. */
export class DevProfiler {
  readonly enabled: boolean;
  private readonly frames = new RollingTimingWindow(180);
  private readonly ticks = new RollingTimingWindow(120);
  private readonly renders = new RollingTimingWindow(120);
  private lastSpike?: FrameCostBreakdown & { category: string };
  private fps = 0;
  private fpsFrames = 0;
  private fpsTimer = 0;
  private overlay?: HTMLElement;
  private lastPaint = 0;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  addFrame(cost: FrameCostBreakdown, elapsedSeconds: number): void {
    if (!this.enabled) return;
    this.frames.add(cost.frameMs);
    if (cost.tickMs > 0) this.ticks.add(cost.tickMs);
    this.renders.add(cost.renderMs);
    this.fpsFrames += 1;
    this.fpsTimer += elapsedSeconds;
    if (this.fpsTimer >= 0.5) {
      this.fps = Math.round(this.fpsFrames / this.fpsTimer);
      this.fpsFrames = 0;
      this.fpsTimer = 0;
    }
    if (cost.frameMs >= 33) {
      this.lastSpike = { ...cost, category: classifySpike(cost) };
    }
  }

  snapshot(world: {
    generateJobs: number;
    meshJobs: number;
    waitingMesh: number;
    waitingGenerate: number;
    lightingJobs: number;
    dirtyChunks: number;
    blockMutations: number;
    mobCount: number;
    entityUpdateMs: number;
  }): PerfSnapshot | undefined {
    if (!this.enabled) return undefined;
    const frame = this.frames.snapshot();
    const tick = this.ticks.snapshot();
    const render = this.renders.snapshot();
    return {
      fps: this.fps,
      frame,
      tick,
      renderMs: render.averageMs,
      generateJobs: world.generateJobs,
      meshJobs: world.meshJobs,
      waitingMesh: world.waitingMesh,
      waitingGenerate: world.waitingGenerate,
      lightingJobs: world.lightingJobs,
      dirtyChunks: world.dirtyChunks,
      blockMutations: world.blockMutations,
      mobCount: world.mobCount,
      entityUpdateMs: world.entityUpdateMs,
      heapMb: readJsHeapMb(),
      lastSpike: this.lastSpike,
    };
  }

  paint(root: HTMLElement, snapshot: PerfSnapshot): void {
    if (!this.enabled) return;
    const now = performance.now();
    if (now - this.lastPaint < 200 && this.overlay) return;
    this.lastPaint = now;
    if (!this.overlay) {
      this.overlay = document.createElement('pre');
      this.overlay.id = 'perf-overlay';
      root.append(this.overlay);
    }
    const spike = snapshot.lastSpike;
    const heap = snapshot.heapMb !== undefined ? `${snapshot.heapMb.toFixed(1)} MB` : 'n/a';
    this.overlay.textContent = [
      `PERF  fps ${snapshot.fps}  frame ${snapshot.frame.averageMs.toFixed(1)} / p95 ${snapshot.frame.p95Ms.toFixed(1)} / p99 ${snapshot.frame.p99Ms.toFixed(1)} / max ${snapshot.frame.maximumMs.toFixed(1)}`,
      `TICK  ${snapshot.tick.averageMs.toFixed(2)} / p95 ${snapshot.tick.p95Ms.toFixed(2)}   RENDER ${snapshot.renderMs.toFixed(2)}`,
      `JOBS  gen ${snapshot.generateJobs} mesh ${snapshot.meshJobs} waitG ${snapshot.waitingGenerate} waitM ${snapshot.waitingMesh} light ${snapshot.lightingJobs} dirty ${snapshot.dirtyChunks} mut ${snapshot.blockMutations}`,
      `ENT   mobs ${snapshot.mobCount} update ${snapshot.entityUpdateMs.toFixed(2)} ms   HEAP ${heap}`,
      spike
        ? `SPIKE ${spike.frameMs.toFixed(1)} ms  ${spike.category}  mesh ${spike.meshMs.toFixed(1)} light ${spike.lightMs.toFixed(1)} gen ${spike.generateMs.toFixed(1)} sim ${spike.tickMs.toFixed(1)} render ${spike.renderMs.toFixed(1)}`
        : 'SPIKE  —',
    ].join('\n');
  }

  dispose(): void {
    this.overlay?.remove();
    this.overlay = undefined;
  }
}
