import type { AutoMineManager } from '../services/autoMine';
import type { AuctionService, AuctionView } from '../services/auction';
import type { BuyerService } from '../services/buyer';
import type { ClanService, ClanView, ClanResult } from '../services/clan';
import type { EconomyService } from '../services/economy';
import type { PermissionService } from '../services/permissions';
import type { PluginConfigService } from '../services/pluginConfig';
import type { PlayerSelectionService } from '../services/selection';
import type { RtpService, RtpSessionManager } from '../services/rtp';
import type { TeleportHistoryService, TeleportService } from '../services/teleport';
import type { PluginManager } from '../PluginManager';
import type { VoxelWorld } from '../../src/world/World';
import type { HologramNetwork } from '../services/holograms';
import type { ClaimBoundaryNetwork } from '../services/claimBoundaries';

export interface PlayerIdentity {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
}

export interface BuiltinPluginContext {
  readonly permissions: PermissionService;
  readonly teleports: TeleportService;
  readonly history: TeleportHistoryService;
  readonly rtp: RtpService;
  readonly rtpSessions: RtpSessionManager;
  readonly selection: PlayerSelectionService;
  readonly autoMine: AutoMineManager;
  readonly economy: EconomyService;
  readonly auction: AuctionService;
  readonly clan: ClanService;
  readonly buyer: BuyerService;
  readonly openAuction: (playerId: string, view: AuctionView) => void;
  readonly openClan: (playerId: string, view: ClanView, extra?: string) => ClanResult | void;
  readonly openBuyerAdmin: (playerId: string, buyerId: string) => void;
  readonly broadcastBuyers: () => void;
  readonly lookupPlayer: (idOrName: string) => PlayerIdentity | undefined;
  readonly config: PluginConfigService;
  readonly plugins: PluginManager;
  readonly world: VoxelWorld;
  readonly worldId: () => string;
  readonly markDirty: () => void;
  readonly holograms: HologramNetwork;
  readonly claimBoundaries: ClaimBoundaryNetwork;
}
