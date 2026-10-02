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
  const zenith = mix(zenithBase, rising ? DAWN_ZENITH : DUSK_ZENITH, bandStrength * 0.26);
  const horizon = mix(horizonBase, rising ? DAWN_HORIZON : DUSK_HORIZON, clamp(bandStrength * 1.08, 0, 1));
  const starOpacity = smoothstep(0.02, -0.42, sunHeight);
  return {
    zenith,
    horizon,
    band: rising ? DAWN_BAND : DUSK_BAND,
    bandStrength,
    starOpacity,
    fog: mix(horizon, zenith, 0.15),
    sunHeight,
    rising,
  };
}
