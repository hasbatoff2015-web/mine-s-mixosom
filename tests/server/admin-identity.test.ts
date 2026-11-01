import { describe, expect, it } from 'vitest';
import { AdminIdentityPolicy } from '../../server/admin/identity';
import { AdminControlDisabledError, AdminIdentityError } from '../../server/admin/errors';
import { loadAdminIdentityConfig, loadServerConfig } from '../../server/config';

describe('admin identity policy', () => {
  it('disables admin writes when FC_ADMIN_IDS is missing', () => {
    expect(loadAdminIdentityConfig({}).enabled).toBe(false);
    expect(loadAdminIdentityConfig({ FC_ADMIN_IDS: '   ' }).enabled).toBe(false);
    const policy = new AdminIdentityPolicy({ enabled: false });
    expect(policy.isAdmin('admin-owner')).toBe(false);
    expect(policy.authorizedIds()).toEqual([]);
    expect(() => policy.requireAdmin('admin-owner')).toThrow(AdminControlDisabledError);
    expect(loadServerConfig({}).adminIdentity).toEqual({ enabled: false });
  });

  it('rejects one id, three ids, duplicates, and blank segments', () => {
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'only-one' })).toThrow(/exactly two/);
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'a,b,c' })).toThrow(/exactly two/);
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'same,same' })).toThrow(/different/);
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'a,,b' })).toThrow(/exactly two/);
    expect(() => loadAdminIdentityConfig({ FC_ADMIN_IDS: 'bad id,other' })).toThrow(/exactly two/);
    expect(() => loadAdminIdentityConfig({ FC_OPERATORS: 'owner,colleague' })).not.toThrow();
    expect(loadAdminIdentityConfig({ FC_OPERATORS: 'owner,colleague' }).enabled).toBe(false);
  });

  it('gives both configured ids the same full authorization', () => {
    const config = loadAdminIdentityConfig({ FC_ADMIN_IDS: 'admin-owner,admin-colleague' });
    expect(config).toEqual({ enabled: true, ids: ['admin-owner', 'admin-colleague'] });
    const policy = new AdminIdentityPolicy(config);
    expect(policy.isAdmin('admin-owner')).toBe(true);
    expect(policy.isAdmin('admin-colleague')).toBe(true);
    expect(policy.isAdmin('admin-owner')).toBe(policy.isAdmin('admin-colleague'));
    expect(() => policy.requireAdmin('admin-owner')).not.toThrow();
    expect(() => policy.requireAdmin('admin-colleague')).not.toThrow();
    expect(() => policy.requireAdmin('someone-else')).toThrow(AdminIdentityError);
    expect(policy).not.toHaveProperty('level');
    expect(policy).not.toHaveProperty('role');
    expect(JSON.stringify(policy)).not.toMatch(/moderator|superadmin|rank/);
  });
});
