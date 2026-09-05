import { MAX_CHAT_LENGTH, PROTOCOL_VERSION } from './config';
import { sanitizePlayerName } from './playerName';
import type { AppliedMovementStep } from './playerCommand';
import type { ActionRejectReason, PlayerActionKind } from './playerActions';

export type { AppliedMovementStep } from './playerCommand';
export type { ActionRejectReason, PlayerActionKind } from './playerActions';

export type GameMode = 'survival' | 'creative';

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export type Vec3 = readonly [number, number, number];

export type ContainerKind = 'inventory' | 'crafting-table' | 'chest' | 'furnace';

export type InventoryActionKind =
  | 'click'
  | 'drop_selected'
  | 'drop_cursor'
  | 'select'
  | 'open'
  | 'close'
  | 'recipe';

export type EntityKind = 'item' | 'mob' | 'minecart' | 'tnt' | 'arrow' | 'falling';

export type VehicleAction = 'enter' | 'exit' | 'steer';

export interface PlayerSnapshot {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly health: number;
  readonly gamemode: GameMode;
  readonly sneaking: boolean;
  readonly sprinting: boolean;
  readonly onGround: boolean;
  readonly selectedSlot: number;
  readonly invisible?: boolean;
  readonly onFire?: boolean;
  readonly hunger?: number;
  readonly armor?: number;
  readonly ridingEntityId?: string;
  readonly dead?: boolean;
  /** Command applied on the last physics tick of this snapshot. */
  readonly inputSeq?: number;
  /** Same as inputSeq; named so ACK mapping is not mistaken for a tick id. */
  readonly ackCommandSeq?: number;
  /**
   * Authoritative pose after each physics tick in this flush (bounded).
   * Catch-up of N ticks includes N steps so the client can map history.
   */
  readonly appliedSteps?: readonly AppliedMovementStep[];
  /**
   * DEV: last few server physics ticks with the input seq actually applied.
   * Latest `inputSeq` alone cannot reconstruct a multi-tick interval.
   */
  readonly appliedTicks?: readonly AppliedInputTick[];
  /** Creative flight. Omitted by older servers; prediction keeps local isFlying. */
  readonly flying?: boolean;
  /**
   * Command seqs the server deliberately skipped via continuous-state compaction.
   * Client must discard these pending predictions, not wait for an ACK.
   */
  readonly queueCompacted?: {
    readonly fromCommandSeq: number;
    readonly toCommandSeq: number;
  };
  /** DEV localhost RTT trace for the input seq this pose used. */
  readonly netTiming?: {
    readonly clientSentAt?: number;
    readonly serverRecvAt?: number;
    readonly serverSimAt?: number;
    readonly serverSentAt?: number;
  };
  /** DEV session/socket isolation. Never includes the raw session token. */
  readonly session?: PlayerSessionDiag;
}

export interface AppliedInputTick {
  readonly tick: number;
  readonly seq: number;
  readonly forward: number;
  readonly right: number;
  readonly jump: boolean;
  readonly sneak: boolean;
  readonly descend: boolean;
  readonly flySprint: boolean;
  readonly y: number;
  readonly vy: number;
  readonly flying: boolean;
  readonly onGround: boolean;
}

export interface PlayerSessionDiag {
  readonly tokenFp: string;
  readonly connectionId: string;
  readonly joinCount: number;
  readonly resumeCount: number;
  readonly activeSockets: number;
  readonly lastInputConn: string;
  readonly inputGapMs?: number;
  readonly inputPackets?: number;
}

export interface RemotePlayerInfo {
  readonly id: string;
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

export type WorldModifications = Record<string, Record<string, number>>;
export type WorldBlockStates = Record<string, unknown>;

export interface EffectSnapshot {
  readonly id: string;
  readonly amplifier: number;
  readonly remainingTicks: number;
}

export interface EntitySnapshot {
  readonly id: string;
  readonly kind: EntityKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw?: number;
  readonly pitch?: number;
  readonly vx?: number;
  readonly vy?: number;
  readonly vz?: number;
  readonly itemId?: string;
  readonly count?: number;
  readonly mobKind?: string;
  readonly health?: number;
  readonly maxHealth?: number;
  readonly onFire?: boolean;
  readonly hurt?: boolean;
  readonly invisible?: boolean;
  readonly variant?: string;
  readonly primed?: boolean;
  readonly fuse?: number;
  readonly passengerId?: string;
  readonly state?: string;
  readonly blockId?: number;
}

export type NetworkEntityEventKind = 'hurt' | 'death' | 'projectile_spawn' | 'projectile_hit';

export interface NetworkEntityEvent {
  readonly entityId: string;
  readonly kind: NetworkEntityEventKind;
}

export type NetworkBlockAttachment = 'floor' | 'wall' | 'ceiling';
export type NetworkHorizontalFacing = 'north' | 'south' | 'east' | 'west';
export type NetworkRailShape =
  | 'north_south'
  | 'east_west'
  | 'north_east'
  | 'north_west'
  | 'south_east'
  | 'south_west'
  | 'ascending_north'
  | 'ascending_south'
  | 'ascending_east'
  | 'ascending_west';

/** Subset of `BlockRenderState` that travels on live block packets. */
export interface NetworkBlockState {
  readonly powered?: boolean;
  readonly power?: number;
  readonly attachment?: NetworkBlockAttachment;
  readonly facing?: NetworkHorizontalFacing;
  readonly open?: boolean;
  readonly half?: 'lower' | 'upper';
  readonly hinge?: 'left' | 'right';
  readonly slabType?: 'bottom' | 'top' | 'double';
  readonly stairHalf?: 'bottom' | 'top';
  readonly fluidLevel?: number;
  readonly fluidFalling?: boolean;
  readonly railShape?: NetworkRailShape;
  readonly hydrated?: boolean;
  readonly age?: number;
}

export interface BlockChange {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly state?: NetworkBlockState;
}

export interface ClientJoinMessage {
  readonly type: 'join';
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly name?: string;
  readonly sessionToken?: string;
}

export interface ClientInputMessage {
  readonly type: 'input';
  readonly seq: number;
  readonly clientTick?: number;
  readonly forward: number;
  readonly right: number;
  readonly jump: boolean;
  readonly sneak: boolean;
  readonly sprint: boolean;
  readonly descend: boolean;
  readonly flySprint: boolean;
  readonly yaw: number;
  readonly pitch: number;
  readonly selectedSlot: number;
  readonly mining?: boolean;
  readonly use?: boolean;
  readonly vehicleForward?: number;
  /** DEV: client performance.now() when this packet was sent. */
  readonly clientSentAt?: number;
}

export interface ClientBlockIntentFields {
  readonly actionSeq?: number;
  readonly commandSeq?: number;
  readonly selectedSlot?: number;
  readonly targetBlockId?: number;
  readonly faceX?: number;
  readonly faceY?: number;
  readonly faceZ?: number;
  readonly hitX?: number;
  readonly hitY?: number;
  readonly hitZ?: number;
}

export interface ClientBreakBlockMessage extends ClientBlockIntentFields {
  readonly type: 'break_block';
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ClientPlaceBlockMessage extends ClientBlockIntentFields {
  readonly type: 'place_block';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId?: number;
}

export interface ClientChatMessage {
  readonly type: 'chat';
  readonly text: string;
}

export interface ClientViewMessage {
  readonly type: 'view';
  readonly cx: number;
  readonly cz: number;
  readonly radius: number;
}

export interface ClientPingMessage {
  readonly type: 'ping';
  readonly t: number;
}

export interface ClientInventoryActionMessage {
  readonly type: 'inventory_action';
  readonly action: InventoryActionKind;
  readonly key?: string;
  readonly button?: 'left' | 'right';
  readonly shift?: boolean;
  readonly slot?: number;
  readonly count?: number;
  readonly kind?: ContainerKind;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
  readonly recipeId?: string;
}

export interface ClientCraftMessage {
  readonly type: 'craft';
  readonly shift?: boolean;
}

export interface ClientInteractMessage extends ClientBlockIntentFields {
  readonly type: 'interact';
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
}

export interface ClientAttackMessage {
  readonly type: 'attack';
  readonly actionSeq?: number;
  readonly commandSeq?: number;
  readonly yaw?: number;
  readonly pitch?: number;
}

export interface ClientBowReleaseMessage {
  readonly type: 'bow_release';
  readonly actionSeq: number;
  readonly commandSeq: number;
  readonly yaw: number;
  readonly pitch: number;
  readonly selectedSlot?: number;
}

export interface ClientActionMessage {
  readonly type: 'action';
  readonly actionSeq: number;
  readonly commandSeq: number;
  readonly kind: PlayerActionKind;
  readonly selectedSlot?: number;
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
  readonly targetBlockId?: number;
  readonly faceX?: number;
  readonly faceY?: number;
  readonly faceZ?: number;
  readonly hitX?: number;
  readonly hitY?: number;
  readonly hitZ?: number;
  readonly yaw?: number;
  readonly pitch?: number;
  readonly x?: number;
  readonly y?: number;
  readonly z?: number;
}

export interface ClientPickupMessage {
  readonly type: 'pickup';
  readonly entityId?: string;
}

export interface ClientVehicleInputMessage {
  readonly type: 'vehicle_input';
  readonly action: VehicleAction;
  readonly entityId?: string;
  readonly forward?: number;
}

export type ClientMessage =
  | ClientJoinMessage
  | ClientInputMessage
  | ClientBreakBlockMessage
  | ClientPlaceBlockMessage
  | ClientChatMessage
  | ClientViewMessage
  | ClientPingMessage
  | ClientInventoryActionMessage
  | ClientCraftMessage
  | ClientInteractMessage
  | ClientAttackMessage
  | ClientBowReleaseMessage
  | ClientActionMessage
  | ClientPickupMessage
  | ClientVehicleInputMessage;

export interface ServerWelcomeMessage {
  readonly type: 'welcome';
  readonly protocol: typeof PROTOCOL_VERSION;
  readonly playerId: string;
  readonly sessionToken: string;
  readonly name: string;
  readonly seed: string;
  readonly worldId: string;
  readonly timeOfDay: number;
  readonly spawn: Vec3;
  readonly you: PlayerSnapshot;
  readonly inventory: unknown;
  readonly players: readonly RemotePlayerInfo[];
  readonly modifications: WorldModifications;
  readonly blockStates: WorldBlockStates;
  readonly online: number;
  readonly maxPlayers: number;
  readonly serverName: string;
  readonly holograms?: readonly NetworkHologram[];
}

export interface ServerPlayerJoinedMessage {
  readonly type: 'player_joined';
  readonly player: RemotePlayerInfo;
}

export interface ServerPlayerLeftMessage {
  readonly type: 'player_left';
  readonly playerId: string;
}

export interface ServerTickClock {
  readonly physicsTps: number;
  readonly snapGen: number;
  readonly snapSent: number;
  readonly droppedTicks: number;
  readonly elapsedMs: number;
  readonly accumulatorMs: number;
  readonly physicsTicksThisLoop: number;
  readonly latenessMs?: number;
  readonly callbackMs?: number;
  readonly eldMean?: number;
  readonly eldP95?: number;
  readonly eldP99?: number;
  readonly eldMax?: number;
  readonly tickWallMs?: number;
  readonly entities?: number;
  readonly blockChanges?: number;
  readonly chunkSends?: number;
  readonly chunkGens?: number;
  /** Wall time since this world's busiest player last received an input packet. */
  readonly inputGapMs?: number;
  /** Input packets applied since the previous snapshot flush (burst detector). */
  readonly inputPackets?: number;
}

export interface ServerPlayerStateMessage {
  readonly type: 'player_state';
  readonly tick: number;
  /** Physics ticks simulated since the previous snapshot flush (1 unless catch-up). */
  readonly physicsTicks?: number;
  readonly tickClock?: ServerTickClock;
  readonly players: readonly PlayerSnapshot[];
}

export interface ServerBlockUpdateMessage {
  readonly type: 'block_update';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly blockId: number;
  readonly state?: NetworkBlockState;
}

export interface ServerBlockBatchMessage {
  readonly type: 'block_batch';
  readonly changes: readonly BlockChange[];
}

export interface ServerBlockResultMessage {
  readonly type: 'block_result';
  readonly ok: boolean;
  readonly action: 'break' | 'place';
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly reason?: string;
}

export interface ServerActionResultMessage {
  readonly type: 'action_result';
  readonly actionSeq: number;
  readonly kind: PlayerActionKind | 'break' | 'place';
  readonly ok: boolean;
  readonly reason?: string;
  readonly targetX?: number;
  readonly targetY?: number;
  readonly targetZ?: number;
  readonly faceX?: number;
  readonly faceY?: number;
  readonly faceZ?: number;
  readonly yaw?: number;
  readonly pitch?: number;
}

export interface ServerChunkMessage {
  readonly type: 'chunk_data';
  readonly cx: number;
  readonly cz: number;
  /** Modification delta for this chunk only (existing save representation). */
  readonly modifications: Record<string, number>;
}

export interface ServerUnloadChunkMessage {
  readonly type: 'unload_chunk';
  readonly cx: number;
  readonly cz: number;
}

export interface ServerChatMessage {
  readonly type: 'chat';
  readonly from: string;
  readonly playerId: string;
  readonly text: string;
  readonly kind: 'player' | 'system' | 'command' | 'error';
}

export interface ServerErrorMessage {
  readonly type: 'error';
  readonly code: string;
  readonly message: string;
}

export interface ServerPongMessage {
  readonly type: 'pong';
  readonly t: number;
}

export interface ServerStatusMessage {
  readonly type: 'status';
  readonly online: number;
  readonly maxPlayers: number;
}

export interface ServerInventoryMessage {
  readonly type: 'inventory';
  readonly inventory: unknown;
  readonly selectedSlot: number;
  readonly gamemode: GameMode;
  readonly cursor?: unknown;
  readonly craftSlots?: unknown;
  readonly window?: {
    readonly kind: ContainerKind;
    readonly x?: number;
    readonly y?: number;
    readonly z?: number;
    readonly slots?: unknown;
  };
}

export interface ServerHealthMessage {
  readonly type: 'health';
  readonly health: number;
  readonly hunger: number;
  readonly saturation: number;
  readonly absorption: number;
  readonly air: number;
  readonly armor: number;
  readonly fire: boolean;
  readonly dead: boolean;
}

export interface ServerEffectsMessage {
  readonly type: 'effects';
  readonly effects: readonly EffectSnapshot[];
}

export interface ServerEntitySnapshotMessage {
  readonly type: 'entity_snapshot';
  readonly tick: number;
  readonly entities: readonly EntitySnapshot[];
}

export interface ServerEntityEventMessage {
  readonly type: 'entity_event';
  readonly tick: number;
  readonly events: readonly NetworkEntityEvent[];
}

export interface ServerCommandResultMessage {
  readonly type: 'command_result';
  readonly ok: boolean;
  readonly name: string;
  readonly lines: readonly string[];
}

export interface ServerTimeMessage {
  readonly type: 'time';
  readonly timeOfDay: number;
}

export interface NetworkHologram {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly lines: readonly string[];
  readonly range: number;
  readonly enabled: boolean;
}

export interface ServerHologramsMessage {
  readonly type: 'holograms';
  readonly holograms: readonly NetworkHologram[];
}

/** How long a denied-claim wireframe stays on the client. */
export const CLAIM_BOUNDARY_DURATION_MS = 10_000;

export interface ServerClaimBoundaryMessage {
  readonly type: 'claim_boundary';
  readonly claimId: string;
  readonly name: string;
  readonly worldId: string;
  readonly minX: number;
  readonly minY: number;
  readonly minZ: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly maxZ: number;
  readonly durationMs: number;
}

export type ServerMessage =
  | ServerWelcomeMessage
  | ServerPlayerJoinedMessage
  | ServerPlayerLeftMessage
  | ServerPlayerStateMessage
  | ServerBlockUpdateMessage
  | ServerBlockBatchMessage
  | ServerBlockResultMessage
  | ServerActionResultMessage
  | ServerChunkMessage
  | ServerUnloadChunkMessage
  | ServerChatMessage
  | ServerErrorMessage
  | ServerPongMessage
  | ServerStatusMessage
  | ServerInventoryMessage
  | ServerHealthMessage
  | ServerEffectsMessage
  | ServerEntitySnapshotMessage
  | ServerEntityEventMessage
  | ServerCommandResultMessage
  | ServerTimeMessage
  | ServerHologramsMessage
  | ServerClaimBoundaryMessage;

export const CLIENT_MESSAGE_TYPES = [
  'join',
  'input',
  'break_block',
  'place_block',
  'chat',
  'view',
  'ping',
  'inventory_action',
  'craft',
  'interact',
  'attack',
  'bow_release',
  'action',
  'pickup',
  'vehicle_input',
] as const satisfies readonly ClientMessage['type'][];

export const SERVER_MESSAGE_TYPES = [
  'welcome',
  'player_joined',
  'player_left',
  'player_state',
  'block_update',
  'block_batch',
  'block_result',
  'action_result',
  'chunk_data',
  'unload_chunk',
  'chat',
  'error',
  'pong',
  'status',
  'inventory',
  'health',
  'effects',
  'entity_snapshot',
  'entity_event',
  'command_result',
  'time',
  'holograms',
  'claim_boundary',
] as const satisfies readonly ServerMessage['type'][];

const INVENTORY_ACTIONS: readonly InventoryActionKind[] = [
  'click', 'drop_selected', 'drop_cursor', 'select', 'open', 'close', 'recipe',
];

const CONTAINER_KINDS: readonly ContainerKind[] = [
  'inventory', 'crafting-table', 'chest', 'furnace',
];

const VEHICLE_ACTIONS: readonly VehicleAction[] = ['enter', 'exit', 'steer'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function bool(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeName(raw: unknown): string | undefined {
  return sanitizePlayerName(raw);
}

function optionalInteger(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || !finite(value)) return undefined;
  return value;
}

function optionalString(value: unknown, max: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.slice(0, max);
  return trimmed.length > 0 ? trimmed : undefined;
}

const NETWORK_ATTACHMENTS: ReadonlySet<string> = new Set(['floor', 'wall', 'ceiling']);
const NETWORK_FACINGS: ReadonlySet<string> = new Set(['north', 'south', 'east', 'west']);
const NETWORK_RAIL_SHAPES: ReadonlySet<string> = new Set([
  'north_south', 'east_west', 'north_east', 'north_west', 'south_east', 'south_west',
  'ascending_north', 'ascending_south', 'ascending_east', 'ascending_west',
]);

export function parseNetworkBlockState(raw: unknown): NetworkBlockState | undefined {
  if (!isRecord(raw)) return undefined;
  const state: {
    powered?: boolean;
    power?: number;
    attachment?: NetworkBlockAttachment;
    facing?: NetworkHorizontalFacing;
    open?: boolean;
    half?: 'lower' | 'upper';
    hinge?: 'left' | 'right';
    slabType?: 'bottom' | 'top' | 'double';
    stairHalf?: 'bottom' | 'top';
    fluidLevel?: number;
    fluidFalling?: boolean;
    railShape?: NetworkRailShape;
    hydrated?: boolean;
    age?: number;
  } = {};
  if (typeof raw.powered === 'boolean') state.powered = raw.powered;
  if (Number.isInteger(raw.power) && finite(raw.power)) {
    state.power = clampNumber(Math.floor(raw.power), 0, 15);
  }
  if (typeof raw.attachment === 'string' && NETWORK_ATTACHMENTS.has(raw.attachment)) {
    state.attachment = raw.attachment as NetworkBlockAttachment;
  }
  if (typeof raw.facing === 'string' && NETWORK_FACINGS.has(raw.facing)) {
    state.facing = raw.facing as NetworkHorizontalFacing;
  }
  if (typeof raw.open === 'boolean') state.open = raw.open;
  if (raw.half === 'lower' || raw.half === 'upper') state.half = raw.half;
  if (raw.hinge === 'left' || raw.hinge === 'right') state.hinge = raw.hinge;
  if (raw.slabType === 'bottom' || raw.slabType === 'top' || raw.slabType === 'double') {
    state.slabType = raw.slabType;
  }
  if (raw.stairHalf === 'bottom' || raw.stairHalf === 'top') state.stairHalf = raw.stairHalf;
  if (Number.isInteger(raw.fluidLevel) && finite(raw.fluidLevel)) {
    state.fluidLevel = clampNumber(Math.floor(raw.fluidLevel), 1, 8);
  }
  if (typeof raw.fluidFalling === 'boolean') state.fluidFalling = raw.fluidFalling;
  if (typeof raw.railShape === 'string' && NETWORK_RAIL_SHAPES.has(raw.railShape)) {
    state.railShape = raw.railShape as NetworkRailShape;
  }
  if (typeof raw.hydrated === 'boolean') state.hydrated = raw.hydrated;
  if (Number.isInteger(raw.age) && finite(raw.age)) state.age = clampNumber(Math.floor(raw.age), 0, 7);
  return Object.keys(state).length > 0 ? state : undefined;
}

function parseBlockChange(entry: unknown): BlockChange | undefined {
  if (!isRecord(entry)) return undefined;
  if (!Number.isInteger(entry.x) || !Number.isInteger(entry.y) || !Number.isInteger(entry.z) || !Number.isInteger(entry.blockId)) {
    return undefined;
  }
  if (!finite(entry.x) || !finite(entry.y) || !finite(entry.z) || !finite(entry.blockId)) return undefined;
  const state = parseNetworkBlockState(entry.state);
  return {
    x: entry.x,
    y: entry.y,
    z: entry.z,
    blockId: entry.blockId,
    ...(state ? { state } : {}),
  };
}

function optionalSeq(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!finite(value) || !Number.isInteger(value) || value < 0 || value > 2_147_483_647) return undefined;
  return value;
}

function parseIntentFields(raw: Record<string, unknown>): ClientBlockIntentFields | { error: string } {
  const actionSeq = optionalSeq(raw.actionSeq);
  if (raw.actionSeq !== undefined && actionSeq === undefined) return { error: 'actionSeq invalid' };
  const commandSeq = optionalSeq(raw.commandSeq);
  if (raw.commandSeq !== undefined && commandSeq === undefined) return { error: 'commandSeq invalid' };
  const selectedSlot = optionalInteger(raw.selectedSlot);
  if (raw.selectedSlot !== undefined && selectedSlot === undefined) return { error: 'selectedSlot invalid' };
  const targetBlockId = optionalInteger(raw.targetBlockId);
  if (raw.targetBlockId !== undefined && targetBlockId === undefined) return { error: 'targetBlockId invalid' };
  const faceX = raw.faceX === undefined ? undefined : finite(raw.faceX) ? raw.faceX : undefined;
  const faceY = raw.faceY === undefined ? undefined : finite(raw.faceY) ? raw.faceY : undefined;
  const faceZ = raw.faceZ === undefined ? undefined : finite(raw.faceZ) ? raw.faceZ : undefined;
  if ((raw.faceX !== undefined && faceX === undefined)
    || (raw.faceY !== undefined && faceY === undefined)
    || (raw.faceZ !== undefined && faceZ === undefined)) {
    return { error: 'face invalid' };
  }
  const hitX = raw.hitX === undefined ? undefined : finite(raw.hitX) ? raw.hitX : undefined;
  const hitY = raw.hitY === undefined ? undefined : finite(raw.hitY) ? raw.hitY : undefined;
  const hitZ = raw.hitZ === undefined ? undefined : finite(raw.hitZ) ? raw.hitZ : undefined;
  if ((raw.hitX !== undefined && hitX === undefined)
    || (raw.hitY !== undefined && hitY === undefined)
    || (raw.hitZ !== undefined && hitZ === undefined)) {
    return { error: 'hit invalid' };
  }
  return {
    ...(actionSeq !== undefined ? { actionSeq } : {}),
    ...(commandSeq !== undefined ? { commandSeq } : {}),
    ...(selectedSlot !== undefined ? { selectedSlot: clampNumber(selectedSlot, 0, 8) } : {}),
    ...(targetBlockId !== undefined ? { targetBlockId } : {}),
    ...(faceX !== undefined ? { faceX } : {}),
    ...(faceY !== undefined ? { faceY } : {}),
    ...(faceZ !== undefined ? { faceZ } : {}),
    ...(hitX !== undefined ? { hitX } : {}),
    ...(hitY !== undefined ? { hitY } : {}),
    ...(hitZ !== undefined ? { hitZ } : {}),
  };
}

export function parseClientMessage(raw: unknown): ClientMessage | { readonly error: string } {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return { error: 'message must be an object with a type' };
  }
  switch (raw.type) {
    case 'join': {
      if (raw.protocol !== PROTOCOL_VERSION) {
        return { error: `unsupported protocol ${String(raw.protocol)}` };
      }
      const name = sanitizeName(raw.name);
      const sessionToken = typeof raw.sessionToken === 'string' ? raw.sessionToken.slice(0, 80) : undefined;
      return {
        type: 'join',
        protocol: PROTOCOL_VERSION,
        ...(name ? { name } : {}),
        ...(sessionToken ? { sessionToken } : {}),
      };
    }
    case 'input': {
      if (!finite(raw.seq) || !Number.isInteger(raw.seq) || raw.seq < 0 || raw.seq > 2_147_483_647) {
        return { error: 'input.seq invalid' };
      }
      if (!finite(raw.forward) || !finite(raw.right) || !finite(raw.yaw) || !finite(raw.pitch)) {
        return { error: 'input numbers invalid' };
      }
      if (!bool(raw.jump) || !bool(raw.sneak) || !bool(raw.sprint) || !bool(raw.descend) || !bool(raw.flySprint)) {
        return { error: 'input flags invalid' };
      }
      if (!finite(raw.selectedSlot) || !Number.isInteger(raw.selectedSlot)) {
        return { error: 'input.selectedSlot invalid' };
      }
      if (raw.mining !== undefined && !bool(raw.mining)) return { error: 'input.mining invalid' };
      if (raw.use !== undefined && !bool(raw.use)) return { error: 'input.use invalid' };
      const vehicleForward = raw.vehicleForward === undefined
        ? undefined
        : finite(raw.vehicleForward) ? clampNumber(raw.vehicleForward, -1, 1) : undefined;
      if (raw.vehicleForward !== undefined && vehicleForward === undefined) {
        return { error: 'input.vehicleForward invalid' };
      }
      const clientTick = optionalSeq(raw.clientTick);
      if (raw.clientTick !== undefined && clientTick === undefined) return { error: 'input.clientTick invalid' };
      return {
        type: 'input',
        seq: raw.seq,
        ...(clientTick !== undefined ? { clientTick } : {}),
        forward: clampNumber(raw.forward, -1, 1),
        right: clampNumber(raw.right, -1, 1),
        jump: raw.jump,
        sneak: raw.sneak,
        sprint: raw.sprint,
        descend: raw.descend,
        flySprint: raw.flySprint,
        yaw: raw.yaw,
        pitch: clampNumber(raw.pitch, -Math.PI / 2, Math.PI / 2),
        selectedSlot: clampNumber(Math.floor(raw.selectedSlot), 0, 8),
        ...(raw.mining === true ? { mining: true } : {}),
        ...(raw.use === true ? { use: true } : {}),
        ...(vehicleForward !== undefined ? { vehicleForward } : {}),
        ...(typeof raw.clientSentAt === 'number' && Number.isFinite(raw.clientSentAt)
          ? { clientSentAt: raw.clientSentAt }
          : {}),
      };
    }
    case 'break_block':
    case 'place_block': {
      if (!Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z)) {
        return { error: 'block coordinates must be integers' };
      }
      if (!finite(raw.x) || !finite(raw.y) || !finite(raw.z)) {
        return { error: 'block coordinates invalid' };
      }
      const intent = parseIntentFields(raw);
      if ('error' in intent) return intent;
      if (raw.type === 'break_block') {
        return { type: 'break_block', x: raw.x, y: raw.y, z: raw.z, ...intent };
      }
      const blockId = raw.blockId === undefined ? undefined : raw.blockId;
      if (blockId !== undefined && (!Number.isInteger(blockId) || !finite(blockId))) {
        return { error: 'place_block.blockId invalid' };
      }
      return {
        type: 'place_block',
        x: raw.x,
        y: raw.y,
        z: raw.z,
        ...(blockId === undefined ? {} : { blockId }),
        ...intent,
      };
    }
    case 'chat': {
      if (typeof raw.text !== 'string') return { error: 'chat.text required' };
      const text = raw.text.replace(/\s+$/g, '').slice(0, MAX_CHAT_LENGTH);
      if (!text) return { error: 'chat.text empty' };
      return { type: 'chat', text };
    }
    case 'view': {
      if (!Number.isInteger(raw.cx) || !Number.isInteger(raw.cz) || !Number.isInteger(raw.radius)) {
        return { error: 'view integers required' };
      }
      if (!finite(raw.cx) || !finite(raw.cz) || !finite(raw.radius)) {
        return { error: 'view numbers invalid' };
      }
      return {
        type: 'view',
        cx: raw.cx,
        cz: raw.cz,
        radius: clampNumber(raw.radius, 1, 8),
      };
    }
    case 'ping': {
      if (!finite(raw.t)) return { error: 'ping.t invalid' };
      return { type: 'ping', t: raw.t };
    }
    case 'inventory_action': {
      if (typeof raw.action !== 'string' || !(INVENTORY_ACTIONS as readonly string[]).includes(raw.action)) {
        return { error: 'inventory_action.action invalid' };
      }
      if (raw.button !== undefined && raw.button !== 'left' && raw.button !== 'right') {
        return { error: 'inventory_action.button invalid' };
      }
      if (raw.shift !== undefined && !bool(raw.shift)) return { error: 'inventory_action.shift invalid' };
      if (raw.kind !== undefined && !(CONTAINER_KINDS as readonly string[]).includes(raw.kind as string)) {
        return { error: 'inventory_action.kind invalid' };
      }
      const slot = optionalInteger(raw.slot);
      if (raw.slot !== undefined && slot === undefined) return { error: 'inventory_action.slot invalid' };
      const count = optionalInteger(raw.count);
      if (raw.count !== undefined && (count === undefined || count < 1 || count > 64)) {
        return { error: 'inventory_action.count invalid' };
      }
      const x = optionalInteger(raw.x);
      const y = optionalInteger(raw.y);
      const z = optionalInteger(raw.z);
      if ((raw.x !== undefined && x === undefined)
        || (raw.y !== undefined && y === undefined)
        || (raw.z !== undefined && z === undefined)) {
        return { error: 'inventory_action coordinates invalid' };
      }
      const key = optionalString(raw.key, 64);
      const recipeId = optionalString(raw.recipeId, 64);
      return {
        type: 'inventory_action',
        action: raw.action as InventoryActionKind,
        ...(key ? { key } : {}),
        ...(raw.button ? { button: raw.button } : {}),
        ...(raw.shift === true ? { shift: true } : {}),
        ...(slot !== undefined ? { slot } : {}),
        ...(count !== undefined ? { count } : {}),
        ...(raw.kind ? { kind: raw.kind as ContainerKind } : {}),
        ...(x !== undefined ? { x } : {}),
        ...(y !== undefined ? { y } : {}),
        ...(z !== undefined ? { z } : {}),
        ...(recipeId ? { recipeId } : {}),
      };
    }
    case 'craft': {
      if (raw.shift !== undefined && !bool(raw.shift)) return { error: 'craft.shift invalid' };
      return { type: 'craft', ...(raw.shift === true ? { shift: true } : {}) };
    }
    case 'interact': {
      const intent = parseIntentFields(raw);
      if ('error' in intent) return intent;
      const targetX = optionalInteger(raw.targetX);
      const targetY = optionalInteger(raw.targetY);
      const targetZ = optionalInteger(raw.targetZ);
      if ((raw.targetX !== undefined && targetX === undefined)
        || (raw.targetY !== undefined && targetY === undefined)
        || (raw.targetZ !== undefined && targetZ === undefined)) {
        return { error: 'interact target invalid' };
      }
      return {
        type: 'interact',
        ...intent,
        ...(targetX !== undefined ? { targetX } : {}),
        ...(targetY !== undefined ? { targetY } : {}),
        ...(targetZ !== undefined ? { targetZ } : {}),
      };
    }
    case 'attack': {
      const actionSeq = optionalSeq(raw.actionSeq);
      if (raw.actionSeq !== undefined && actionSeq === undefined) return { error: 'attack.actionSeq invalid' };
      const commandSeq = optionalSeq(raw.commandSeq);
      if (raw.commandSeq !== undefined && commandSeq === undefined) return { error: 'attack.commandSeq invalid' };
      if (raw.yaw !== undefined && !finite(raw.yaw)) return { error: 'attack.yaw invalid' };
      if (raw.pitch !== undefined && !finite(raw.pitch)) return { error: 'attack.pitch invalid' };
      return {
        type: 'attack',
        ...(actionSeq !== undefined ? { actionSeq } : {}),
        ...(commandSeq !== undefined ? { commandSeq } : {}),
        ...(finite(raw.yaw) ? { yaw: raw.yaw } : {}),
        ...(finite(raw.pitch) ? { pitch: clampNumber(raw.pitch, -Math.PI / 2, Math.PI / 2) } : {}),
      };
    }
    case 'bow_release': {
      const actionSeq = optionalSeq(raw.actionSeq);
      const commandSeq = optionalSeq(raw.commandSeq);
      if (actionSeq === undefined) return { error: 'bow_release.actionSeq invalid' };
      if (commandSeq === undefined) return { error: 'bow_release.commandSeq invalid' };
      if (!finite(raw.yaw) || !finite(raw.pitch)) return { error: 'bow_release look invalid' };
      const selectedSlot = optionalInteger(raw.selectedSlot);
      if (raw.selectedSlot !== undefined && selectedSlot === undefined) {
        return { error: 'bow_release.selectedSlot invalid' };
      }
      return {
        type: 'bow_release',
        actionSeq,
        commandSeq,
        yaw: raw.yaw,
        pitch: clampNumber(raw.pitch, -Math.PI / 2, Math.PI / 2),
        ...(selectedSlot !== undefined ? { selectedSlot: clampNumber(selectedSlot, 0, 8) } : {}),
      };
    }
    case 'action': {
      const actionSeq = optionalSeq(raw.actionSeq);
      const commandSeq = optionalSeq(raw.commandSeq);
      if (actionSeq === undefined) return { error: 'action.actionSeq invalid' };
      if (commandSeq === undefined) return { error: 'action.commandSeq invalid' };
      const kind = raw.kind;
      if (kind !== 'block_use' && kind !== 'block_break_start' && kind !== 'block_break_abort'
        && kind !== 'block_break_finish' && kind !== 'bow_release' && kind !== 'attack') {
        return { error: 'action.kind invalid' };
      }
      const intent = parseIntentFields(raw);
      if ('error' in intent) return intent;
      const targetX = optionalInteger(raw.targetX ?? raw.x);
      const targetY = optionalInteger(raw.targetY ?? raw.y);
      const targetZ = optionalInteger(raw.targetZ ?? raw.z);
      return {
        type: 'action',
        actionSeq,
        commandSeq,
        kind,
        ...intent,
        ...(targetX !== undefined ? { targetX } : {}),
        ...(targetY !== undefined ? { targetY } : {}),
        ...(targetZ !== undefined ? { targetZ } : {}),
        ...(finite(raw.yaw) ? { yaw: raw.yaw } : {}),
        ...(finite(raw.pitch) ? { pitch: clampNumber(raw.pitch, -Math.PI / 2, Math.PI / 2) } : {}),
      };
    }
    case 'pickup': {
      const entityId = optionalString(raw.entityId, 64);
      return { type: 'pickup', ...(entityId ? { entityId } : {}) };
    }
    case 'vehicle_input': {
      if (typeof raw.action !== 'string' || !(VEHICLE_ACTIONS as readonly string[]).includes(raw.action)) {
        return { error: 'vehicle_input.action invalid' };
      }
      const entityId = optionalString(raw.entityId, 64);
      const forward = raw.forward === undefined
        ? undefined
        : finite(raw.forward) ? clampNumber(raw.forward, -1, 1) : undefined;
      if (raw.forward !== undefined && forward === undefined) {
        return { error: 'vehicle_input.forward invalid' };
      }
      return {
        type: 'vehicle_input',
        action: raw.action as VehicleAction,
        ...(entityId ? { entityId } : {}),
        ...(forward !== undefined ? { forward } : {}),
      };
    }
    default:
      return { error: `unknown message type ${raw.type}` };
  }
}

export function parseServerMessage(raw: unknown): ServerMessage | { readonly error: string } {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    return { error: 'message must be an object with a type' };
  }
  if (!(SERVER_MESSAGE_TYPES as readonly string[]).includes(raw.type)) {
    return { error: `unknown message type ${raw.type}` };
  }
  switch (raw.type) {
    case 'player_state': {
      if (!finite(raw.tick) || !Number.isInteger(raw.tick) || raw.tick < 0 || !Array.isArray(raw.players)) {
        return { error: 'player_state invalid' };
      }
      return raw as unknown as ServerPlayerStateMessage;
    }
    case 'block_update': {
      const change = parseBlockChange(raw);
      if (!change) return { error: 'block_update invalid' };
      return {
        type: 'block_update',
        x: change.x,
        y: change.y,
        z: change.z,
        blockId: change.blockId,
        ...(change.state ? { state: change.state } : {}),
      };
    }
    case 'block_batch': {
      if (!Array.isArray(raw.changes)) return { error: 'block_batch invalid' };
      const changes: BlockChange[] = [];
      for (const entry of raw.changes.slice(0, 512)) {
        const change = parseBlockChange(entry);
        if (change) changes.push(change);
      }
      return { type: 'block_batch', changes };
    }
    case 'block_result': {
      if (!bool(raw.ok) || (raw.action !== 'break' && raw.action !== 'place')) {
        return { error: 'block_result invalid' };
      }
      if (!finite(raw.x) || !finite(raw.y) || !finite(raw.z) || !Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !Number.isInteger(raw.z)) {
        return { error: 'block_result coordinates invalid' };
      }
      const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 64) : undefined;
      return {
        type: 'block_result',
        ok: raw.ok,
        action: raw.action,
        x: raw.x,
        y: raw.y,
        z: raw.z,
        ...(reason ? { reason } : {}),
      };
    }
    case 'action_result': {
      if (!bool(raw.ok) || !finite(raw.actionSeq) || !Number.isInteger(raw.actionSeq) || typeof raw.kind !== 'string') {
        return { error: 'action_result invalid' };
      }
      const reason = typeof raw.reason === 'string' ? raw.reason.slice(0, 64) : undefined;
      return raw as unknown as ServerActionResultMessage;
    }
    case 'entity_snapshot': {
      if (!finite(raw.tick) || !Number.isInteger(raw.tick) || raw.tick < 0 || !Array.isArray(raw.entities)) {
        return { error: 'entity_snapshot invalid' };
      }
      return raw as unknown as ServerEntitySnapshotMessage;
    }
    case 'entity_event': {
      if (!finite(raw.tick) || !Number.isInteger(raw.tick) || raw.tick < 0 || !Array.isArray(raw.events)) {
        return { error: 'entity_event invalid' };
      }
      const events: NetworkEntityEvent[] = [];
      for (const entry of raw.events) {
        if (!isRecord(entry) || typeof entry.entityId !== 'string' || entry.entityId.length === 0) continue;
        if (entry.kind !== 'hurt' && entry.kind !== 'death'
          && entry.kind !== 'projectile_spawn' && entry.kind !== 'projectile_hit') {
          continue;
        }
        events.push({ entityId: entry.entityId, kind: entry.kind });
      }
      return { type: 'entity_event', tick: raw.tick, events };
    }
    case 'health': {
      if (!finite(raw.health) || !finite(raw.hunger) || !bool(raw.dead) || !bool(raw.fire)) {
        return { error: 'health invalid' };
      }
      return raw as unknown as ServerHealthMessage;
    }
    case 'effects': {
      if (!Array.isArray(raw.effects)) return { error: 'effects invalid' };
      return raw as unknown as ServerEffectsMessage;
    }
    case 'command_result': {
      if (!bool(raw.ok) || typeof raw.name !== 'string' || !Array.isArray(raw.lines)) {
        return { error: 'command_result invalid' };
      }
      return raw as unknown as ServerCommandResultMessage;
    }
    case 'holograms': {
      if (!Array.isArray(raw.holograms)) return { error: 'holograms invalid' };
      const holograms: NetworkHologram[] = [];
      for (const entry of raw.holograms.slice(0, 64)) {
        if (!isRecord(entry) || typeof entry.name !== 'string' || entry.name.length === 0) continue;
        if (!finite(entry.x) || !finite(entry.y) || !finite(entry.z) || !finite(entry.range)) continue;
        const lines = Array.isArray(entry.lines)
          ? entry.lines.filter((line): line is string => typeof line === 'string').map((line) => line.slice(0, 80)).slice(0, 8)
          : [];
        holograms.push({
          name: entry.name.slice(0, 32),
          x: entry.x,
          y: entry.y,
          z: entry.z,
          lines,
          range: Math.max(1, Math.min(128, entry.range)),
          enabled: entry.enabled !== false,
        });
      }
      return { type: 'holograms', holograms };
    }
    case 'claim_boundary': {
      if (typeof raw.claimId !== 'string' || raw.claimId.length === 0) {
        return { error: 'claim_boundary invalid' };
      }
      if (typeof raw.name !== 'string' || typeof raw.worldId !== 'string') {
        return { error: 'claim_boundary invalid' };
      }
      if (
        !finite(raw.minX) || !finite(raw.minY) || !finite(raw.minZ)
        || !finite(raw.maxX) || !finite(raw.maxY) || !finite(raw.maxZ)
        || !Number.isInteger(raw.minX) || !Number.isInteger(raw.minY) || !Number.isInteger(raw.minZ)
        || !Number.isInteger(raw.maxX) || !Number.isInteger(raw.maxY) || !Number.isInteger(raw.maxZ)
      ) {
        return { error: 'claim_boundary invalid' };
      }
      const durationMs = finite(raw.durationMs)
        ? Math.max(1_000, Math.min(30_000, Math.round(raw.durationMs)))
        : CLAIM_BOUNDARY_DURATION_MS;
      return {
        type: 'claim_boundary',
        claimId: raw.claimId.slice(0, 64),
        name: raw.name.slice(0, 32),
        worldId: raw.worldId.slice(0, 64),
        minX: raw.minX,
        minY: raw.minY,
        minZ: raw.minZ,
        maxX: raw.maxX,
        maxY: raw.maxY,
        maxZ: raw.maxZ,
        durationMs,
      };
    }
    default:
      return raw as unknown as ServerMessage;
  }
}

export function encodeMessage(message: ClientMessage | ServerMessage): string {
  return JSON.stringify(message);
}

export function decodeJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}
