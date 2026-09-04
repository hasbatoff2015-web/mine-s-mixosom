/**
 * Log-safe session id. Never pass the raw sessionToken to logs or F3.
 * Not a cryptographic secret — only a stable fingerprint for diagnostics.
 */
export function sessionTokenFingerprint(token: string): string {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
