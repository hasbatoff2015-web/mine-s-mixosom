/**
 * Public referral rules shared by the server and the menu.
 * The server owns codes, time, and rewards. These helpers only recognize
 * a code and describe state the server already decided.
 */

export const REFERRAL_CODE_LENGTH = 8;
export const REFERRAL_ACTIVE_SECONDS = 3 * 60 * 60;
export const REFERRAL_AFK_MS = 5 * 60 * 1000;
export const REFERRAL_REWARD_MS = 7 * 24 * 60 * 60 * 1000;
export const REFERRAL_KIT_NAME = 'referral_starter';
export const REFERRAL_PAGE_SIZE = 20;

/** No 0/O or 1/I. 32 symbols, so a byte modulo 32 has no bias. */
export const REFERRAL_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const CODE_PATTERN = new RegExp(`^[${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}}$`);
const PAYLOAD_PATTERN = new RegExp(`^ref_([${REFERRAL_CODE_ALPHABET}]{${REFERRAL_CODE_LENGTH}})$`, 'i');

export type ReferralMilestone = '3_confirmed' | '5_confirmed';
export type ReferralRelationStatus = 'pending' | 'qualified';
export type ReferralKitMenuState = 'none' | 'awaiting_setup' | 'available' | 'claimed' | 'inventory_full';

export interface ReferralMenuInvitee {
  readonly name: string;
  readonly activeSeconds: number;
  readonly progressLabel: string;
  readonly status: ReferralRelationStatus;
}

export interface ReferralMenuReward {
  readonly milestone: ReferralMilestone;
  readonly title: string;
  readonly detail: string;
}

export interface ReferralMenuKit {
  readonly state: ReferralKitMenuState;
  readonly detail: string;
}

export interface ReferralMenuState {
  readonly available: boolean;
  readonly activityNote: string;
  readonly unavailableReason?: string;
  readonly code?: string;
  readonly link?: string;
  readonly codeDraft?: string;
  readonly guestWarning?: string;
  readonly qualifiedCount: number;
  readonly invitedCount: number;
  readonly invitees: readonly ReferralMenuInvitee[];
  readonly page: number;
  readonly pageCount: number;
  readonly rewards: readonly ReferralMenuReward[];
  readonly kit: ReferralMenuKit;
  readonly invitedBy?: string;
  readonly inviteeProgress?: string;
  readonly rankNote?: string;
}

export function parseReferralCode(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const code = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(code)) return undefined;
  return code;
}

/** `ref_CODE` from `ysdk.environment.payload`. Anything else is ignored. */
export function parseReferralPayload(raw: string | undefined | null): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  if (trimmed.length === 0 || trimmed.length > 32) return undefined;
  const match = PAYLOAD_PATTERN.exec(trimmed);
  return match ? match[1]!.toUpperCase() : undefined;
}

export function referralPayload(code: string): string | undefined {
  const parsed = parseReferralCode(code);
  if (!parsed) return undefined;
  return `ref_${parsed}`;
}

/** Official Yandex Games app id, digits only. Never a guessed value. */
export function yandexGameBaseUrl(appId: string | undefined | null): string | undefined {
  if (typeof appId !== 'string' || !/^\d{1,20}$/.test(appId)) return undefined;
  return `https://yandex.ru/games/app/${appId}`;
}

/**
 * Keeps an official Yandex Games URL and sets `payload=ref_CODE`.
 * Other query parameters are removed so a configured URL cannot carry a secret.
 */
export function referralPublicUrl(base: string | undefined | null, code: string): string | undefined {
  const payload = referralPayload(code);
  if (!base || !payload) return undefined;
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return undefined;
  const host = url.hostname.toLowerCase();
  const official = host === 'yandex.ru' || host === 'yandex.com' || host.endsWith('.yandex.ru') || host.endsWith('.yandex.com');
  if (!official) return undefined;
  if (!/^\/games\/app\/\d{1,20}\/?$/.test(url.pathname)) return undefined;
  url.username = '';
  url.password = '';
  url.search = '';
  url.hash = '';
  url.searchParams.set('payload', payload);
  return url.toString();
}

export function normalizeYandexGameUrl(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const withPayload = referralPublicUrl(raw, 'A'.repeat(REFERRAL_CODE_LENGTH).replace(/A/g, '2'));
  if (!withPayload) return undefined;
  const url = new URL(withPayload);
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function formatActiveProgress(seconds: number, status: ReferralRelationStatus = 'pending'): string {
  const capped = Math.min(REFERRAL_ACTIVE_SECONDS, Math.max(0, Math.floor(seconds)));
  if (status === 'qualified' || capped >= REFERRAL_ACTIVE_SECONDS) return '3/3 ч — подтверждён';
  const hours = Math.floor(capped / 3600);
  const minutes = Math.floor((capped % 3600) / 60);
  if (hours > 0) return `${hours} ч ${minutes} мин / 3 ч`;
  return `${minutes} мин / 3 ч`;
}

export function referralRewardTitle(milestone: ReferralMilestone): string {
  return milestone === '3_confirmed' ? '3 друга — VIP 7 дней' : '5 друзей — PREMIUM 7 дней';
}

export function friendsUntilMilestone(qualified: number, milestone: ReferralMilestone): number {
  const goal = milestone === '3_confirmed' ? 3 : 5;
  return Math.max(0, goal - qualified);
}
