import type { PermissionService } from './permissions';
import { resolvePetLimitFromPermissions } from '../../src/gameplay/petLimit';

export function resolvePetLimit(
  permissions: PermissionService,
  playerId: string,
  playerName?: string,
): number {
  const nodes = new Set<string>(permissions.playerInfo(playerId).permissions);
  if (playerName) {
    for (const node of permissions.playerInfo(playerName).permissions) nodes.add(node);
  }
  return resolvePetLimitFromPermissions([...nodes]);
}
