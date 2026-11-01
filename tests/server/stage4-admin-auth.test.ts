import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { adminActionFromContext } from '../../server/admin/context';
import {
  digestAdminSecret,
  formatAdminAuthHashes,
  generateAdminSecret,
  parseAdminAuthHashes,
  resolveAdminCredential,
} from '../../server/admin/credentials';
import { loadAdminHttpConfig, loadAdminIdentityConfig, loadServerConfig } from '../../server/config';

const IDS = ['admin-owner', 'admin-colleague'] as const;

function pair(ownerSecret: string, colleagueSecret: string) {
  return parseAdminAuthHashes(
    `${IDS[0]}:${digestAdminSecret(ownerSecret).toString('hex')},${IDS[1]}:${digestAdminSecret(colleagueSecret).toString('hex')}`,
    IDS,
  );
}

describe('stage 4 admin credentials', () => {
  it('authenticates each administrator only with that administrator secret', () => {
    const ownerSecret = generateAdminSecret();
    const colleagueSecret = generateAdminSecret();
    expect(ownerSecret).not.toBe(colleagueSecret);
    expect(ownerSecret.length).toBeGreaterThanOrEqual(43);
    const credentials = pair(ownerSecret, colleagueSecret);
    expect(resolveAdminCredential(credentials, ownerSecret)).toBe('admin-owner');
    expect(resolveAdminCredential(credentials, colleagueSecret)).toBe('admin-colleague');
    expect(resolveAdminCredential(credentials, generateAdminSecret())).toBeNull();
    expect(resolveAdminCredential(credentials, 'hunter2')).toBeNull();
    expect(resolveAdminCredential(credentials, '')).toBeNull();
    expect(credentials[0].adminId).toBe('admin-owner');
    expect(credentials[1].adminId).toBe('admin-colleague');
    expect(credentials[0].digest.equals(credentials[1].digest)).toBe(false);
  });

  it('ignores a client adminId and keeps the credential owner', () => {
    const ownerSecret = generateAdminSecret();
    const colleagueSecret = generateAdminSecret();
    const credentials = pair(ownerSecret, colleagueSecret);
    const forged = {
      secret: colleagueSecret,
      adminId: 'admin-owner',
    };
    expect(resolveAdminCredential(credentials, forged.secret)).toBe('admin-colleague');
    expect(resolveAdminCredential(credentials, forged.secret)).not.toBe(forged.adminId);
    const action = adminActionFromContext(
      { adminId: 'admin-colleague', sessionId: 'session-colleague' },
      {
        requestId: '00000000-0000-4000-8000-000000000001',
        adminId: 'admin-owner',
        action: 'inspect',
        targetType: 'player',
        targetId: 'player-1',
        reason: 'stage 4 context check',
      },
    );
    expect(action.adminId).toBe('admin-colleague');
  });

  it('rejects a game nickname and a normal session token as admin secrets', () => {
    const credentials = pair(generateAdminSecret(), generateAdminSecret());
    expect(resolveAdminCredential(credentials, 'admin-owner')).toBeNull();
    expect(resolveAdminCredential(credentials, '11111111-1111-4111-8111-111111111111')).toBeNull();
  });

  it('keeps admin HTTP off when the port is absent and rejects incomplete configuration', () => {
    expect(loadAdminHttpConfig({}, { enabled: false }).enabled).toBe(false);
    expect(loadAdminHttpConfig({ FC_ADMIN_PORT: '   ' }, { enabled: false }).enabled).toBe(false);
    expect(loadServerConfig({}).adminHttp).toEqual({ enabled: false });
    expect(loadServerConfig({ FC_ADMIN_IDS: 'admin-owner,admin-colleague' }).adminHttp.enabled).toBe(false);
    expect(() => loadAdminHttpConfig({ FC_ADMIN_PORT: '8765' }, { enabled: false })).toThrow(/FC_ADMIN_IDS/);
    const identity = loadAdminIdentityConfig({ FC_ADMIN_IDS: 'admin-owner,admin-colleague' });
    expect(() => loadAdminHttpConfig({ FC_ADMIN_PORT: '8765' }, identity)).toThrow(/FC_ADMIN_AUTH_HASHES/);
    expect(() => loadAdminHttpConfig({ FC_ADMIN_PORT: '0', FC_ADMIN_AUTH_HASHES: 'x' }, identity)).toThrow(/1 to 65535/);
    expect(() => loadAdminHttpConfig({ FC_ADMIN_PORT: 'nope', FC_ADMIN_AUTH_HASHES: 'x' }, identity)).toThrow(/1 to 65535/);
    const weak = 'admin-owner:not-a-hash,admin-colleague:also-bad';
    expect(() => loadAdminHttpConfig({ FC_ADMIN_PORT: '8765', FC_ADMIN_AUTH_HASHES: weak }, identity)).toThrow(/64 lowercase/);
    expect(() => loadAdminHttpConfig({ FC_ADMIN_PORT: '8765', FC_ADMIN_AUTH_HASHES: weak }, identity)).not.toThrow(/not-a-hash/);
  });

  it('preserves the two-id rules and requires both unique digests', () => {
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'only-one' })).toThrow(/exactly two/);
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'a,b,c' })).toThrow(/exactly two/);
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'same,same' })).toThrow(/different/);
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'bad id,other' })).toThrow(/exactly two/);
    const owner = digestAdminSecret(generateAdminSecret()).toString('hex');
    const colleague = digestAdminSecret(generateAdminSecret()).toString('hex');
    const identity = loadAdminIdentityConfig({ FC_ADMIN_IDS: 'admin-owner,admin-colleague' });
    expect(() => parseAdminAuthHashes(`admin-owner:${owner}`, IDS)).toThrow(/exactly two/);
    expect(() => parseAdminAuthHashes(`admin-owner:${owner},admin-owner:${colleague}`, IDS)).toThrow(/different/);
    expect(() => parseAdminAuthHashes(`admin-owner:${owner},admin-colleague:${owner}`, IDS)).toThrow(/unique/);
    expect(() => parseAdminAuthHashes(`admin-owner:${owner},intruder:${colleague}`, IDS)).toThrow(/both FC_ADMIN_IDS/);
    const blank = createHash('sha256').update('', 'utf8').digest('hex');
    expect(() => parseAdminAuthHashes(`admin-owner:${blank},admin-colleague:${colleague}`, IDS)).toThrow(/non-blank/);
    const loaded = loadAdminHttpConfig({
      FC_ADMIN_PORT: '8765',
      FC_ADMIN_AUTH_HASHES: `admin-colleague:${colleague},admin-owner:${owner}`,
    }, identity);
    expect(loaded).toMatchObject({ enabled: true, port: 8765 });
    if (loaded.enabled) {
      expect(loaded.credentials.map((item) => item.adminId)).toEqual(['admin-owner', 'admin-colleague']);
      expect(formatAdminAuthHashes(loaded.credentials)).toBe(`admin-owner:${owner},admin-colleague:${colleague}`);
    }
  });

  it('prints two tokens and hashes without writing them', async () => {
    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, [
        'scripts/provision-admin-credentials.mjs',
        'admin-owner',
        'admin-colleague',
      ], { cwd: process.cwd() });
      let text = '';
      let error = '';
      child.stdout.on('data', (chunk: Buffer) => {
        text += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        error += chunk.toString();
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) resolve(text);
        else reject(new Error(error || `provision exited ${code}`));
      });
    });
    expect(output).toContain('FC_ADMIN_IDS=admin-owner,admin-colleague');
    expect(output).toContain('127.0.0.1');
    const hashLine = output.split('\n').find((line) => line.startsWith('FC_ADMIN_AUTH_HASHES='));
    expect(hashLine).toBeTruthy();
    const hashes = hashLine!.slice('FC_ADMIN_AUTH_HASHES='.length);
    const ownerBlock = output.split('\n\n').find((block) => block.startsWith('admin-owner\n'));
    const colleagueBlock = output.split('\n\n').find((block) => block.startsWith('admin-colleague\n'));
    const ownerSecret = ownerBlock?.split('\n')[1] ?? '';
    const colleagueSecret = colleagueBlock?.split('\n')[1] ?? '';
    expect(ownerSecret).not.toBe(colleagueSecret);
    expect(resolveAdminCredential(parseAdminAuthHashes(hashes, IDS), ownerSecret)).toBe('admin-owner');
    expect(resolveAdminCredential(parseAdminAuthHashes(hashes, IDS), colleagueSecret)).toBe('admin-colleague');
    expect(output).not.toContain(ownerSecret + ownerSecret);
  });
});
