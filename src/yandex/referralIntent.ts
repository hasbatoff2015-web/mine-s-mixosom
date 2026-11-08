import { parseReferralPayload, referralPublicUrl, yandexGameBaseUrl } from '../../shared/referral';

let pendingCode: string | undefined;
let appId: string | undefined;

/** Remember a Yandex launch payload. Accepting it still requires an explicit button. */
export function captureReferralLaunch(payload: string | undefined, nextAppId: string | undefined): void {
  const code = parseReferralPayload(payload);
  if (code) pendingCode = code;
  if (nextAppId && /^\d{1,20}$/.test(nextAppId)) appId = nextAppId;
}

export function referralIntentCode(): string | undefined {
  return pendingCode;
}

export function referralLinkFromApp(code: string | undefined): string | undefined {
  if (!code) return undefined;
  return referralPublicUrl(yandexGameBaseUrl(appId), code);
}

export function clearReferralIntent(): void {
  pendingCode = undefined;
}
