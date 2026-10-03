import { DAY_TICKS, clamp } from '../core/constants';

export interface SkyRgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface SkySample {
  readonly zenith: SkyRgb;
  readonly horizon: SkyRgb;
  readonly band: SkyRgb;
  readonly bandStrength: number;
  readonly starOpacity: number;
  readonly fog: SkyRgb;
  readonly sunHeight: number;
  readonly rising: boolean;
}

const DAY_ZENITH: SkyRgb = { r: 0.43, g: 0.67, b: 0.93 };
const DAY_HORIZON: SkyRgb = { r: 0.74, g: 0.86, b: 0.96 };
const NIGHT_ZENITH: SkyRgb = { r: 0.015, g: 0.02, b: 0.07 };
const NIGHT_HORIZON: SkyRgb = { r: 0.07, g: 0.09, b: 0.16 };
const DUSK_ZENITH: SkyRgb = { r: 0.15, g: 0.18, b: 0.46 };
const DAWN_ZENITH: SkyRgb = { r: 0.28, g: 0.24, b: 0.50 };
const DUSK_HORIZON: SkyRgb = { r: 0.99, g: 0.30, b: 0.07 };
const DAWN_HORIZON: SkyRgb = { r: 1, g: 0.44, b: 0.16 };
const DUSK_BAND: SkyRgb = { r: 1, g: 0.20, b: 0.03 };
const DAWN_BAND: SkyRgb = { r: 1, g: 0.38, b: 0.10 };

/** Weak warm share of the whole horizon. The strong orange stays in the sun-facing band. */
const HORIZON_WARM = 0.28;
/** Fog has no direction, so it takes an even smaller share of the dusk color. */
const FOG_WARM = 0.16;

function mix(a: SkyRgb, b: SkyRgb, t: number): SkyRgb {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  };
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0;
  if (span === 0) return x >= edge1 ? 1 : 0;
  const t = clamp((x - edge0) / span, 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Visual sky only. `daylightFactor` and the sunlight intensities stay on their
 * existing curve; this palette does not feed the light engine.
 */
export function skySample(timeOfDay: number): SkySample {
  const time = Number.isFinite(timeOfDay) ? timeOfDay : 0;
  const phase = (time / DAY_TICKS) * Math.PI * 2;
  const sunHeight = Math.sin(phase);
  const rising = Math.cos(phase) >= 0;
  const night = smoothstep(0.08, -0.5, sunHeight);
  const low = 1 - smoothstep(0, 0.34, Math.abs(sunHeight));
  const bandStrength = clamp(low * (1 - night * 0.28), 0, 1);
  const dayMix = 1 - night;
  const zenithBase = mix(NIGHT_ZENITH, DAY_ZENITH, dayMix);
  const horizonBase = mix(NIGHT_HORIZON, DAY_HORIZON, dayMix);
  const warm = clamp(bandStrength, 0, 1);
  const duskOrDawnHorizon = rising ? DAWN_HORIZON : DUSK_HORIZON;
  const zenith = mix(zenithBase, rising ? DAWN_ZENITH : DUSK_ZENITH, bandStrength * 0.26);
  const horizon = mix(horizonBase, duskOrDawnHorizon, warm * HORIZON_WARM);
  const fogHorizon = mix(horizonBase, duskOrDawnHorizon, warm * FOG_WARM);
  const starOpacity = smoothstep(0.02, -0.42, sunHeight);
  return {
    zenith,
    horizon,
    band: rising ? DAWN_BAND : DUSK_BAND,
    bandStrength,
    starOpacity,
    fog: mix(fogHorizon, zenith, 0.15),
    sunHeight,
    rising,
  };
}

/** Same phase that places the sun mesh: (cos θ, sin θ, 15/70). */
export function sunDirection(timeOfDay: number): { readonly x: number; readonly y: number; readonly z: number } {
  const time = Number.isFinite(timeOfDay) ? timeOfDay : 0;
  const phase = (time / DAY_TICKS) * Math.PI * 2;
  const x = Math.cos(phase);
  const y = Math.sin(phase);
  const z = 15 / 70;
  const length = Math.hypot(x, y, z) || 1;
  return { x: x / length, y: y / length, z: z / length };
}

/**
 * Matches the SkyDome sunset weight.
 * `verticalBand * mix(0.16, 1, sunFacing²) * bandStrength`.
 * `sunFacing` is the clamped dot of the horizontal view and sun directions.
 */
export function sunsetGlowWeight(dirY: number, sunFacing: number, bandStrength: number): number {
  const vertical = Math.exp(-Math.pow((dirY - 0.035) * 8.6, 2));
  const facing = clamp(sunFacing, 0, 1);
  const local = 0.16 + 0.84 * facing * facing;
  return vertical * bandStrength * local;
}
