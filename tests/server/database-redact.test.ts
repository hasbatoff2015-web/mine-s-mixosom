import { describe, expect, it } from 'vitest';
import { redactDatabaseSecrets } from '../../server/db/redact';

function urlFor(user: string, password: string): string {
  return `postgresql://${user}:${password}@127.0.0.1:5432/megacraft_dev`;
}

describe('database secret redaction', () => {
  it.each(['a', 'db', 'pg', 'admin'])('hides username %s without erasing ordinary error text', (user) => {
    const password = 'a%2Fb';
    const databaseUrl = urlFor(user, password);
    const driver = `password authentication failed for user "${user}"`;
    const role = `role "${user}" does not exist`;
    const useful = 'connect ECONNREFUSED 127.0.0.1:5432 data: connection refused';
    const text = redactDatabaseSecrets(`${driver}\n${role}\n${useful}\n${databaseUrl}`, databaseUrl);
    expect(text).not.toContain(`user "${user}"`);
    expect(text).not.toContain(`role "${user}"`);
    expect(text).not.toContain(password);
    expect(text).not.toContain(decodeURIComponent(password));
    expect(text).not.toContain(databaseUrl);
    expect(text).not.toContain('postgresql://' + user);
    expect(text).toContain('ECONNREFUSED');
    expect(text).toContain('127.0.0.1:5432');
    expect(text).toContain('connection refused');
    expect(text).toContain('data:');
    if (user === 'a') {
      expect(text).toContain('authentication');
      expect(text).toContain('failed');
    }
  });

  it('redacts an encoded password and its decoded form inside a URL', () => {
    const databaseUrl = urlFor('pg', 'p%40ss');
    const text = redactDatabaseSecrets(
      `SASL auth failed for user "pg" using ${databaseUrl} and p@ss`,
      databaseUrl,
    );
    expect(text).not.toContain('p%40ss');
    expect(text).not.toContain('p@ss');
    expect(text).not.toContain('user "pg"');
    expect(text).toContain('SASL auth failed');
  });
});
