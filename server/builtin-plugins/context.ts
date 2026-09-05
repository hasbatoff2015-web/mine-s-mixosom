import type { PermissionService } from '../services/permissions';
import type { PluginConfigService } from '../services/pluginConfig';
import type { PlayerSelectionService } from '../services/selection';
import type { RtpService, RtpSessionManager } from '../services/rtp';
import type { TeleportHistoryService, TeleportService } from '../services/teleport';
import type { PluginManager } from '../PluginManager';
import type { VoxelWorld } from '../../src/world/World';
import type { HologramNetwork } from '../services/holograms';
import type { ClaimBoundaryNetwork } from '../services/claimBoundaries';

export interface BuiltinPluginContext {
  readonly permissions: PermissionService;
  readonly teleports: TeleportService;
  readonly history: TeleportHistoryService;
  readonly rtp: RtpService;
  readonly rtpSessions: RtpSessionManager;
  readonly selection: PlayerSelectionService;
  readonly config: PluginConfigService;
  readonly plugins: PluginManager;
  readonly world: VoxelWorld;
  readonly worldId: () => string;
  readonly markDirty: () => void;
  readonly holograms: HologramNetwork;
  readonly claimBoundaries: ClaimBoundaryNetwork;
}
