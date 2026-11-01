import type { PermissionService } from './permissions';
import { resolvePetLimitFromPermissions } from '../../src/gameplay/petLimit';

export function resolvePetLimit(
  permissions: PermissionService,
  playerId: string,
  playerName?: string,
): number {
  return resolvePetLimitFromPermissions([...permissions.playerInfo(playerId).permissions]);
}
