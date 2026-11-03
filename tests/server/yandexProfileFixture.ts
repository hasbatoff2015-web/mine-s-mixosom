import { createHmac } from 'node:crypto';

/** Synthetic player profile. This is not a captured Yandex signature. */
export function signedPlayerProfile(uniqueId: string, secret: string, issuedAt: number, extra: Record<string, unknown> = {}): string {
  const payload = JSON.stringify({
    algorithm: 'HMAC-SHA256',
    issuedAt,
    requestPayload: '',
    data: {
      id: uniqueId,
      uniqueID: uniqueId,
      lang: 'ru',
      publicName: 'Player',
      ...extra,
    },
  });
  const body = Buffer.from(payload, 'utf8').toString('base64');
  const mac = createHmac('sha256', secret).update(Buffer.from(body, 'base64')).digest('base64');
  return `${mac}.${body}`;
}

export const SYNTHETIC_YANDEX_SECRET = 'test-secret';
export const SYNTHETIC_ISSUED_AT = 1_700_000_000;
export const SYNTHETIC_NOW_MS = SYNTHETIC_ISSUED_AT * 1000;
