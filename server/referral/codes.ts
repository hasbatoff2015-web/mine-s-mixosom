import { randomBytes } from 'node:crypto';
import { REFERRAL_CODE_ALPHABET, REFERRAL_CODE_LENGTH } from '../../shared/referral';

export function generateReferralCode(source: () => Buffer = () => randomBytes(REFERRAL_CODE_LENGTH)): string {
  const bytes = source();
  let code = '';
  for (let index = 0; index < REFERRAL_CODE_LENGTH; index += 1) {
    code += REFERRAL_CODE_ALPHABET[bytes[index]! % REFERRAL_CODE_ALPHABET.length];
  }
  return code;
}
