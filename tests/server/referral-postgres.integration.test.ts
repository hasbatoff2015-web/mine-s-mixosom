import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REFERRAL_ACTIVE_SECONDS } from '../../shared/referral';
import { PostgresDatabase } from '../../server/db/database';
import { PostgresReferralRepository } from '../../server/referral/repository';
import { ReferralService } from '../../server/referral/service';
import type { ReferralScope } from '../../server/referral/types';

const databaseUrl = process.env.FC_TEST_DATABASE_URL?.trim() ?? '';
const REFERRER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVITEE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const OTHER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function assertSafeTestUrl(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') throw new Error('FC_TEST_DATABASE_URL scheme');
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (name === '' || /prod/i.test(name)) throw new Error('refusing database name');
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('invalid schema');
  return `"${name}"`;
}

describe.skipIf(databaseUrl === '')('referral program on PostgreSQL', () => {
  const schemas: string[] = [];
  const opened: PostgresDatabase[] = [];
  let admin: pg.Client | undefined;

  function open(searchPath: string): PostgresDatabase {
    const database = new PostgresDatabase({ url: databaseUrl, deploymentId: 'dev', poolMax: 4, searchPath });
    opened.push(database);
    return database;
  }

  beforeAll(async () => {
    assertSafeTestUrl(databaseUrl);
    admin = new pg.Client({ connectionString: databaseUrl });
    await admin.connect();
  }, 30_000);

  afterAll(async () => {
    for (const database of opened.splice(0)) await database.close().catch(() => undefined);
    if (!admin) return;
    try {
      for (const name of schemas) await admin.query(`DROP SCHEMA IF EXISTS ${quoteIdent(name)} CASCADE`);
    } finally {
      await admin.end().catch(() => undefined);
    }
  }, 30_000);

  async function schema(): Promise<string> {
    const name = `fc_ref_${randomBytes(4).toString('hex')}`;
    await admin!.query(`CREATE SCHEMA ${quoteIdent(name)}`);
    schemas.push(name);
    return name;
  }

  function scope(): ReferralScope {
    return { deploymentId: 'dev', serverMode: 'anarchy', worldId: 'anarchy' };
  }

  function service(database: PostgresDatabase, devTools = true): ReferralService {
    return ReferralService.create({
      repository: new PostgresReferralRepository(database, scope()),
      activityEnabled: true,
      devTools,
      publicGameUrl: null,
      now: () => 1_700_000_000_000,
      paidRank: () => 'default',
      paidRankUnreadable: () => false,
      displayName: (id) => id.slice(0, 8),
      yandexLink: async () => 'unknown',
      kitItems: () => null,
      kitDelivery: () => null,
      notify: () => undefined,
      onBenefitsChanged: () => undefined,
    });
  }

  it('migrates, keeps one code, and lets only one concurrent accept win', async () => {
    const name = await schema();
    const database = open(name);
    await database.start();
    expect(database.appliedMigrations).toContain('0011');
    const live = service(database);
    const first = await live.view(REFERRER, 1);
    const second = await live.view(REFERRER, 1);
    expect(second.code).toBe(first.code);
    const [left, right] = await Promise.all([
      live.accept(INVITEE, first.code),
      live.accept(INVITEE, first.code),
    ]);
    expect([left, right].filter((line) => line.includes('принят'))).toHaveLength(1);
    expect([left, right].filter((line) => line === 'Вы уже приняли приглашение.')).toHaveLength(1);
    expect(await live.accept(REFERRER, first.code)).toBe('Нельзя использовать собственный код.');
    const other = (await service(database).view(OTHER, 1)).code!;
    expect(other).not.toBe(first.code);
    expect(await live.accept(INVITEE, other)).toBe('Вы уже приняли приглашение.');
    const relation = await new PostgresReferralRepository(database, scope()).invitee(INVITEE);
    expect(relation?.referrerId).toBe(REFERRER);
    await expect(database.query(
      `INSERT INTO referral_codes (deployment_id, server_mode, world_id, owner_player_id, public_code)
       VALUES ('dev', 'anarchy', 'anarchy', $1::uuid, $2)`,
      [OTHER, first.code],
    )).rejects.toMatchObject({ code: '23505' });
  }, 30_000);

  it('qualifies once and does not duplicate the milestone under a second flush', async () => {
    const name = await schema();
    const database = open(name);
    await database.start();
    const live = service(database);
    const code = (await live.view(REFERRER, 1)).code!;
    expect(await live.accept(INVITEE, code)).toContain('принят');
    const repo = new PostgresReferralRepository(database, scope());
    const pending = await repo.invitee(INVITEE);
    const first = await repo.flush(pending!.referralId, 0, REFERRAL_ACTIVE_SECONDS, 1_700_000_000_000);
    expect(first.applied).toBe(true);
    if (!first.applied) return;
    expect(first.row.status).toBe('qualified');
    expect(first.justQualified).toBe(true);
    const second = await repo.flush(pending!.referralId, 0, REFERRAL_ACTIVE_SECONDS, 1_700_000_000_000);
    expect(second.applied).toBe(false);
    const rewards = await repo.rewards(REFERRER);
    expect(rewards.map((row) => row.milestone)).toEqual([]);
    await live.devAddTime('op', INVITEE, REFERRAL_ACTIVE_SECONDS);
    const after = await repo.rewards(REFERRER);
    expect(after).toHaveLength(0);
    for (let index = 0; index < 4; index += 1) {
      const invitee = `dddddddd-dddd-4ddd-8ddd-${(index + 1).toString(16).padStart(12, '0')}`;
      const fresh = service(database);
      expect(await fresh.accept(invitee, code)).toContain('принят');
      expect(await fresh.devAddTime('op', invitee, REFERRAL_ACTIVE_SECONDS)).toContain('qualified');
    }
    const milestones = (await repo.rewards(REFERRER)).map((row) => row.milestone).sort();
    expect(milestones).toEqual(['3_confirmed', '5_confirmed']);
    await live.devAddTime('op', INVITEE, REFERRAL_ACTIVE_SECONDS);
    expect(await repo.rewards(REFERRER)).toHaveLength(2);
    const restarted = service(database, false);
    await restarted.onJoin(REFERRER, 'again');
    expect(await repo.rewards(REFERRER)).toHaveLength(2);
  }, 30_000);
});
