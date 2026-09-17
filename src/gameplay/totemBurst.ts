/** Nearby clients receive Totem HUD/particles. Independent of the sound catalog. */
export const TOTEM_PRESENTATION_DISTANCE = 32;

export const TOTEM_BURST_COUNT = 48;
export const TOTEM_BURST_LIFE_MIN = 0.55;
export const TOTEM_BURST_LIFE_MAX = 0.9;
export const TOTEM_BURST_MAX_EFFECTS = 4;
/** Spawn stays tight on the body; spread comes from velocity, not radius. */
export const TOTEM_BURST_SPAWN_RADIUS_FIRST_PERSON = 0.16;
export const TOTEM_BURST_SPAWN_RADIUS_THIRD_PERSON = 0.26;
/** About 2× the c319752 speeds so particles travel roughly twice as far. */
export const TOTEM_BURST_SPEED_FIRST_PERSON = 2.3;
export const TOTEM_BURST_SPEED_THIRD_PERSON = 3.1;

/** Lime, darker green, gold, pale yellow — Minecraft Totem palette, not fireworks. */
export const TOTEM_BURST_COLORS = [0xb5ff4a, 0x3dcc22, 0xf0c92a, 0xfff3a0] as const;

export interface TotemBurstParticle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  color: number;
}

export interface TotemBurstState {
  readonly particles: TotemBurstParticle[];
}

export function isTotemPaletteColor(color: number): boolean {
  return (TOTEM_BURST_COLORS as readonly number[]).includes(color);
}

function pickTotemColor(index: number): number {
  const bucket = index % 10;
  if (bucket <= 3) return TOTEM_BURST_COLORS[0];
  if (bucket <= 6) return TOTEM_BURST_COLORS[1];
  if (bucket <= 8) return TOTEM_BURST_COLORS[2];
  return TOTEM_BURST_COLORS[3];
}

export function createTotemBurst(
  x: number,
  y: number,
  z: number,
  options?: { readonly random?: () => number; readonly firstPerson?: boolean },
): TotemBurstState {
  const random = options?.random ?? Math.random;
  const firstPerson = options?.firstPerson === true;
  const radius = firstPerson
    ? TOTEM_BURST_SPAWN_RADIUS_FIRST_PERSON
    : TOTEM_BURST_SPAWN_RADIUS_THIRD_PERSON;
  const speed = firstPerson
    ? TOTEM_BURST_SPEED_FIRST_PERSON
    : TOTEM_BURST_SPEED_THIRD_PERSON;
  const particles: TotemBurstParticle[] = [];
  for (let index = 0; index < TOTEM_BURST_COUNT; index += 1) {
    const yaw = random() * Math.PI * 2;
    const pitch = random() * 0.80 + 0.26;
    const outward = speed * (0.72 + random() * 0.55);
    const horizontal = Math.cos(pitch) * outward;
    const life = TOTEM_BURST_LIFE_MIN
      + random() * (TOTEM_BURST_LIFE_MAX - TOTEM_BURST_LIFE_MIN);
    particles.push({
      x: x + (random() - 0.5) * radius * 2,
      y: y + (random() - 0.35) * 0.38,
      z: z + (random() - 0.5) * radius * 2,
      vx: Math.cos(yaw) * horizontal,
      vy: Math.sin(pitch) * outward + 0.72 + random() * 0.70,
      vz: Math.sin(yaw) * horizontal,
      life,
      maxLife: life,
      color: pickTotemColor(index),
    });
  }
  return { particles };
}

/** Returns true while any particle is still alive. */
export function stepTotemBurst(state: TotemBurstState, dt: number): boolean {
  let remaining = Math.max(0, dt);
  let alive = false;
  while (remaining > 0) {
    const seconds = Math.min(0.05, remaining);
    remaining -= seconds;
    const drag = Math.max(0, 1 - 2.8 * seconds);
    alive = false;
    for (const particle of state.particles) {
      particle.life -= seconds;
      if (particle.life <= 0) continue;
      alive = true;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.z += particle.vz * seconds;
      particle.vx *= drag;
      particle.vz *= drag;
      particle.vy = particle.vy * drag - 1.6 * seconds;
    }
    if (!alive) return false;
  }
  return alive;
}
