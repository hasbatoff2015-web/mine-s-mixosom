/**
 * Strip connection secrets before any log or thrown startup error.
 * Host and port may still appear in a driver's own "connection refused" text.
 * The URL, username, and password must not.
 */
export function redactDatabaseSecrets(text: string, databaseUrl: string): string {
  const secrets: string[] = [];
  if (databaseUrl) secrets.push(databaseUrl);
  try {
    const parsed = new URL(databaseUrl);
    const username = parsed.username;
    const password = parsed.password;
    if (username && password) secrets.push(`${username}:${password}`);
    if (password) {
      secrets.push(password);
      try {
        const decoded = decodeURIComponent(password);
        if (decoded) secrets.push(decoded);
      } catch {
        // The raw password component is already queued.
      }
    }
    if (username.length >= 4) {
      secrets.push(username);
      try {
        const decoded = decodeURIComponent(username);
        if (decoded.length >= 4) secrets.push(decoded);
      } catch {
        // The raw username component is already queued.
      }
    }
  } catch {
    // An unparseable value is removed only when the full string matches.
  }

  let out = text;
  const unique = [...new Set(secrets.filter((part) => part.length > 0))];
  unique.sort((left, right) => right.length - left.length);
  for (const secret of unique) out = out.split(secret).join('[redacted]');
  return out.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]');
}

/** Keep a clean domain error. Wrap only when the text still contains a secret. */
export function preserveOrSanitize(error: unknown, databaseUrl: string): Error {
  if (!(error instanceof Error)) return new Error(redactDatabaseSecrets(String(error), databaseUrl));
  const original = `${error.message}\n${error.stack ?? ''}`;
  if (redactDatabaseSecrets(original, databaseUrl) === original) return error;
  return sanitizeDatabaseError(error, databaseUrl);
}

export function sanitizeDatabaseError(error: unknown, databaseUrl: string): Error {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? message) : message;
  const cleanMessage = redactDatabaseSecrets(message, databaseUrl);
  const cleanStack = redactDatabaseSecrets(stack, databaseUrl);
  const wrapped = new Error(cleanMessage);
  wrapped.name = 'DatabaseError';
  wrapped.stack = cleanStack.includes(cleanMessage) ? cleanStack : `${wrapped.name}: ${cleanStack}`;
  return wrapped;
}
