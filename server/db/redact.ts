/**
 * Strip connection secrets before any log or thrown startup error.
 * Host and port may still appear in a driver's own "connection refused" text.
 * The URL, username, and password must not.
 *
 * Short usernames are redacted only in credential and driver contexts.
 * A one-character user must not erase that character from the rest of the message.
 */
export function redactDatabaseSecrets(text: string, databaseUrl: string): string {
  const secrets: string[] = [];
  const usernames: string[] = [];
  const passwords: string[] = [];
  if (databaseUrl) secrets.push(databaseUrl);
  try {
    const parsed = new URL(databaseUrl);
    const username = parsed.username;
    const password = parsed.password;
    if (username && password) secrets.push(`${username}:${password}`);
    if (password) {
      passwords.push(password);
      pushSecret(secrets, password);
      try {
        const decoded = decodeURIComponent(password);
        passwords.push(decoded);
        pushSecret(secrets, decoded);
      } catch {
        // The raw password component is already queued.
      }
    }
    if (username) {
      usernames.push(username);
      pushSecret(secrets, username);
      try {
        const decoded = decodeURIComponent(username);
        usernames.push(decoded);
        pushSecret(secrets, decoded);
      } catch {
        // The raw username component is already queued.
      }
    }
  } catch {
    // An unparseable value is removed only when the full string matches.
  }

  let out = text;
  const unique = [...new Set(secrets.filter((part) => part.length >= 4))];
  unique.sort((left, right) => right.length - left.length);
  for (const secret of unique) out = out.split(secret).join('[redacted]');
  out = redactCredentialContexts(out, usernames, passwords);
  return out.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]');
}

/** Global replacement is only safe for secrets that are long enough to be distinctive. */
function pushSecret(secrets: string[], value: string): void {
  if (value.length >= 4) secrets.push(value);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Driver text such as `user "db"` and URL userinfo. The username is not
 * replaced anywhere else in the message.
 */
function redactCredentialContexts(text: string, names: readonly string[], passwords: readonly string[]): string {
  let out = text;
  const ordered = [...new Set(names)].filter((value) => value.length > 0).sort((a, b) => b.length - a.length);
  for (const name of ordered) {
    const escaped = escapeRegExp(name);
    out = out.replace(
      new RegExp(`(\\b(?:user|role|username)\\s+)(["'])${escaped}\\2`, 'gi'),
      '$1$2[redacted]$2',
    );
    // URL authority only. A bare "a:" must not rewrite unrelated text such as "data:".
    out = out.replace(new RegExp(`(://)${escaped}(?=[:@])`, 'g'), '$1[redacted]');
  }
  const orderedPasswords = [...new Set(passwords)].filter((value) => value.length > 0).sort((a, b) => b.length - a.length);
  for (const password of orderedPasswords) {
    out = out.replace(new RegExp(`:${escapeRegExp(password)}(?=@)`, 'g'), ':[redacted]');
  }
  return out;
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
