#!/usr/bin/env node
/**
 * Generate original Frontier Cubes core SFX (procedural, not Minecraft).
 *
 * Writes short mono MP3 (or WAV fallback) into public/audio/sfx/.
 * Deterministic seeded synthesis so the pack is reproducible.
 */
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'audio', 'sfx');
const SAMPLE_RATE = 22050;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value, min = -1, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function env(t, attack, decay) {
  if (t < 0) return 0;
  if (t < attack) return t / Math.max(1e-5, attack);
  const u = (t - attack) / Math.max(1e-5, decay);
  return Math.exp(-4.5 * u);
}

function writeWav(samples) {
  const dataSize = samples.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(SAMPLE_RATE, 24);
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i += 1) {
    const s = clamp(samples[i]);
    buffer.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  return buffer;
}

function render(seconds, fn) {
  const n = Math.max(1, Math.floor(seconds * SAMPLE_RATE));
  const samples = new Float64Array(n);
  let peak = 1e-6;
  for (let i = 0; i < n; i += 1) {
    const t = i / SAMPLE_RATE;
    const v = fn(t, i);
    samples[i] = v;
    peak = Math.max(peak, Math.abs(v));
  }
  const gain = 0.72 / peak;
  for (let i = 0; i < n; i += 1) samples[i] *= gain;
  return samples;
}

function noise(rng) {
  return rng() * 2 - 1;
}

function tone(t, freq, phase = 0) {
  return Math.sin(2 * Math.PI * freq * t + phase);
}

function makeLowpass() {
  let y = 0;
  return (x, cutoff) => {
    const a = Math.min(0.99, Math.max(0.01, cutoff));
    y += a * (x - y);
    return y;
  };
}

function makeHighpass() {
  let prevX = 0;
  let prevY = 0;
  return (x, cutoff) => {
    const a = Math.min(0.99, Math.max(0.01, cutoff));
    const y = a * (prevY + x - prevX);
    prevX = x;
    prevY = y;
    return y;
  };
}

const SYNTH = {
  stone_1: (rng) => render(0.18, (t) => {
    const lp = makeLowpass();
    const click = env(t, 0.002, 0.04) * (tone(t, 190) * 0.4 + tone(t, 420) * 0.2);
    const grit = lp(noise(rng), 0.18) * env(t, 0.004, 0.14);
    return click + grit * 0.85;
  }),
  stone_2: (rng) => render(0.2, (t) => {
    const lp = makeLowpass();
    const click = env(t, 0.002, 0.05) * (tone(t, 160) * 0.45 + tone(t, 510) * 0.15);
    const grit = lp(noise(rng), 0.22) * env(t, 0.005, 0.16);
    return click * 0.9 + grit * 0.9;
  }),
  wood_1: (rng) => render(0.22, (t) => {
    const lp = makeLowpass();
    const body = env(t, 0.003, 0.16) * (tone(t, 95) + 0.35 * tone(t, 190) + 0.12 * tone(t, 380));
    const hollow = lp(noise(rng), 0.12) * env(t, 0.006, 0.18);
    return body * 0.7 + hollow * 0.55;
  }),
  wood_2: (rng) => render(0.24, (t) => {
    const lp = makeLowpass();
    const body = env(t, 0.004, 0.18) * (tone(t, 82) + 0.4 * tone(t, 164) + 0.1 * tone(t, 330));
    const hollow = lp(noise(rng), 0.1) * env(t, 0.008, 0.2);
    return body * 0.72 + hollow * 0.5;
  }),
  dirt_1: (rng) => render(0.2, (t) => {
    const lp = makeLowpass();
    return lp(noise(rng), 0.08) * env(t, 0.008, 0.16) + tone(t, 70) * 0.12 * env(t, 0.01, 0.12);
  }),
  dirt_2: (rng) => render(0.22, (t) => {
    const lp = makeLowpass();
    return lp(noise(rng), 0.1) * env(t, 0.01, 0.18) + tone(t, 62) * 0.1 * env(t, 0.012, 0.14);
  }),
  sand_1: (rng) => render(0.2, (t) => {
    const hp = makeHighpass();
    const lp = makeLowpass();
    const grain = hp(lp(noise(rng), 0.55), 0.35);
    return grain * env(t, 0.004, 0.16);
  }),
  sand_2: (rng) => render(0.22, (t) => {
    const hp = makeHighpass();
    const lp = makeLowpass();
    const grain = hp(lp(noise(rng), 0.6), 0.3);
    return grain * env(t, 0.005, 0.18) + tone(t, 240) * 0.04 * env(t, 0.003, 0.08);
  }),
  wool_1: (rng) => render(0.16, (t) => {
    const lp = makeLowpass();
    return lp(noise(rng), 0.05) * env(t, 0.012, 0.12);
  }),
  wool_2: (rng) => render(0.18, (t) => {
    const lp = makeLowpass();
    return lp(noise(rng), 0.06) * env(t, 0.014, 0.14);
  }),
  glass_1: (rng) => render(0.28, (t) => {
    const hp = makeHighpass();
    const sparkle = hp(noise(rng), 0.45) * env(t, 0.001, 0.08);
    const ping = env(t, 0.001, 0.22) * (tone(t, 1840) * 0.35 + tone(t, 2760) * 0.2 + tone(t, 920) * 0.15);
    return sparkle * 0.55 + ping;
  }),
  explosion: (rng) => render(0.7, (t) => {
    const lp = makeLowpass();
    const rumble = lp(noise(rng), 0.07) * env(t, 0.01, 0.55);
    const boom = env(t, 0.004, 0.35) * (tone(t, 42) * 0.8 + tone(t, 68) * 0.4);
    const crack = env(t, 0.001, 0.08) * noise(rng) * 0.45;
    return rumble * 0.9 + boom * 0.85 + crack;
  }),
  bow_shoot: (rng) => render(0.22, (t) => {
    const hp = makeHighpass();
    const whoosh = hp(noise(rng), 0.25) * env(t, 0.004, 0.14);
    const snap = env(t, 0.001, 0.05) * (tone(t, 620) + 0.4 * tone(t, 1240));
    return whoosh * 0.7 + snap * 0.55;
  }),
  arrow_hit: (rng) => render(0.16, (t) => {
    const tick = env(t, 0.001, 0.05) * (tone(t, 880) * 0.5 + tone(t, 440) * 0.3);
    const wood = env(t, 0.002, 0.1) * noise(rng) * 0.35;
    return tick + wood;
  }),
  combat_hit: (rng) => render(0.2, (t) => {
    const lp = makeLowpass();
    const thud = env(t, 0.002, 0.12) * (tone(t, 110) + 0.4 * tone(t, 70));
    const slap = lp(noise(rng), 0.2) * env(t, 0.002, 0.1);
    return thud * 0.75 + slap * 0.6;
  }),
  player_hurt: (rng) => render(0.24, (t) => {
    const lp = makeLowpass();
    const thud = env(t, 0.003, 0.16) * (tone(t, 86) + 0.35 * tone(t, 54));
    const air = lp(noise(rng), 0.12) * env(t, 0.004, 0.14);
    return thud * 0.8 + air * 0.45;
  }),
  item_pickup: () => render(0.14, (t) => {
    const a = env(t, 0.002, 0.08) * tone(t, 980);
    const b = env(t - 0.04, 0.002, 0.08) * tone(t, 1320) * (t > 0.04 ? 1 : 0);
    return a * 0.55 + b * 0.5;
  }),
  food_eat: (rng) => render(0.18, (t) => {
    const lp = makeLowpass();
    const crunch = lp(noise(rng) * (noise(rng) > 0.15 ? 1 : 0.2), 0.28) * env(t, 0.004, 0.12);
    return crunch + tone(t, 180) * 0.08 * env(t, 0.006, 0.1);
  }),
  potion_drink: (rng) => render(0.28, (t) => {
    const lp = makeLowpass();
    const gulp = env(t, 0.02, 0.18) * (tone(t, 140 + 30 * Math.sin(t * 18)) * 0.5);
    const wet = lp(noise(rng), 0.15) * env(t, 0.01, 0.22);
    return gulp + wet * 0.45;
  }),
  door_open: (rng) => render(0.32, (t) => {
    const lp = makeLowpass();
    const creak = env(t, 0.02, 0.24) * tone(t, 210 + t * 40);
    const wood = lp(noise(rng), 0.1) * env(t, 0.01, 0.26);
    return creak * 0.55 + wood * 0.5;
  }),
  door_close: (rng) => render(0.28, (t) => {
    const lp = makeLowpass();
    const creak = env(t, 0.015, 0.16) * tone(t, 190 - t * 50);
    const thump = env(t - 0.12, 0.002, 0.08) * tone(t, 90) * (t > 0.12 ? 1 : 0);
    const wood = lp(noise(rng), 0.11) * env(t, 0.01, 0.2);
    return creak * 0.45 + thump * 0.6 + wood * 0.4;
  }),
  chest_open: (rng) => render(0.36, (t) => {
    const lp = makeLowpass();
    const lid = env(t, 0.02, 0.28) * (tone(t, 160 + t * 70) + 0.25 * tone(t, 320));
    const wood = lp(noise(rng), 0.09) * env(t, 0.015, 0.3);
    return lid * 0.5 + wood * 0.5;
  }),
  chest_close: (rng) => render(0.3, (t) => {
    const lp = makeLowpass();
    const lid = env(t, 0.015, 0.18) * tone(t, 200 - t * 80);
    const thump = env(t - 0.1, 0.002, 0.1) * (tone(t, 80) + noise(rng) * 0.2) * (t > 0.1 ? 1 : 0);
    return lid * 0.45 + thump * 0.7;
  }),
  click: () => render(0.08, (t) => env(t, 0.001, 0.04) * (tone(t, 1400) * 0.5 + tone(t, 2100) * 0.25)),
  fire_ignite: (rng) => render(0.28, (t) => {
    const hp = makeHighpass();
    const spark = hp(noise(rng), 0.4) * env(t, 0.001, 0.06);
    const hiss = hp(noise(rng), 0.2) * env(t, 0.01, 0.22);
    return spark * 0.7 + hiss * 0.5;
  }),
  water_splash: (rng) => render(0.32, (t) => {
    const hp = makeHighpass();
    const lp = makeLowpass();
    const splash = hp(lp(noise(rng), 0.45), 0.12) * env(t, 0.006, 0.22);
    const bubble = env(t - 0.06, 0.01, 0.14) * tone(t, 420 + 80 * Math.sin(t * 40)) * (t > 0.06 ? 0.25 : 0);
    return splash + bubble;
  }),
};

export const SFX_STEMS = Object.keys(SYNTH);

function ffmpegAvailable() {
  return new Promise((resolvePromise) => {
    const child = spawn('ffmpeg', ['-version'], { stdio: 'ignore' });
    child.on('error', () => resolvePromise(false));
    child.on('exit', (code) => resolvePromise(code === 0));
  });
}

function encodeMp3(wavPath, mp3Path) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('ffmpeg', [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-i', wavPath,
      '-ac', '1', '-ar', String(SAMPLE_RATE),
      '-codec:a', 'libmp3lame', '-b:a', '48k',
      mp3Path,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (chunk) => { err += chunk.toString(); });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(err || `ffmpeg exit ${code}`));
    });
  });
}

export async function generateCoreSfx({ outDir = OUT_DIR, preferMp3 = true } = {}) {
  await mkdir(outDir, { recursive: true });
  const hasFfmpeg = preferMp3 && await ffmpegAvailable();
  const written = [];
  let seed = 0xC0FFEE;
  for (const stem of SFX_STEMS) {
    const rng = mulberry32(seed);
    seed += 97;
    const samples = SYNTH[stem](rng);
    const wavPath = join(outDir, `${stem}.wav`);
    const mp3Path = join(outDir, `${stem}.mp3`);
    await writeFile(wavPath, writeWav(samples));
    if (hasFfmpeg) {
      await encodeMp3(wavPath, mp3Path);
      await unlink(wavPath);
      written.push(`${stem}.mp3`);
    } else {
      written.push(`${stem}.wav`);
    }
  }
  return { outDir, format: hasFfmpeg ? 'mp3' : 'wav', written };
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  generateCoreSfx().then((result) => {
    process.stdout.write(`Wrote ${result.written.length} ${result.format} files to ${result.outDir}\n`);
    if (result.format === 'wav') {
      process.stderr.write('ffmpeg not found; shipped WAV. Install ffmpeg and re-run for MP3.\n');
    }
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}
