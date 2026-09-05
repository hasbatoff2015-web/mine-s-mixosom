import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MAX_CLIENT_MESSAGE_BYTES,
  PROTOCOL_VERSION,
} from '../shared/config';
import {
  decodeJson,
  encodeMessage,
  parseClientMessage,
  type ClientMessage,
  type ServerMessage,
  type ServerWelcomeMessage,
} from '../shared/protocol';
import { blockIntentFromFields, hasCapturedBlockIntent } from '../shared/playerActions';
import type { ServerConfig } from './config';
import type { CommandResult } from './commands';
import { serverLog } from './log';
import { WorldInstance, type ConnectedSink, type ServerPlayer } from './WorldInstance';

interface SocketBinding {
  playerId: string;
  connectionId: string;
  superseded: boolean;
}

class WsSink implements ConnectedSink {
  constructor(private readonly socket: WebSocket) {}

  send(payload: unknown): void {
    if (this.socket.readyState !== WebSocket.OPEN) return;
    this.socket.send(encodeMessage(payload as ServerMessage));
  }
}

export class AnarchyServer {
  readonly world: WorldInstance;
  private http?: HttpServer;
  private wss?: WebSocketServer;
  private listeningPort = 0;
  private readonly sockets = new Map<WebSocket, SocketBinding>();

  constructor(readonly config: ServerConfig) {
    this.world = new WorldInstance(config);
  }

  get port(): number {
    return this.listeningPort;
  }

  get host(): string {
    return this.config.host;
  }

  wsUrl(): string {
    return `ws://${this.host}:${this.port}`;
  }

  dispatchConsole(raw: string): CommandResult {
    return this.world.dispatchConsole(raw);
  }

  async start(): Promise<void> {
    await this.world.initialize();
    await this.world.loadPlugins();
    await this.world.plugins.enableAll();
    const enabled = this.world.plugins.recordsView().filter((record) => record.phase === 'enabled');
    const failed = this.world.plugins.recordsView().filter((record) => record.phase === 'failed');
    const names = enabled.map((record) => record.plugin.name);
    serverLog(
      names.length > 0
        ? `plugins: ${names.length} enabled: ${names.join(', ')}`
        : `plugins: 0 enabled from ${this.config.pluginDir}. /hello is not a built-in; copy server/plugin-examples/hello.ts to server/plugins/hello.ts or set FC_EXAMPLE_PLUGIN=1`,
    );
    if (failed.length > 0) {
      serverLog(`plugins: ${failed.length} failed: ${failed.map((record) => record.plugin.name).join(', ')}`, 'warn');
    }
    await new Promise<void>((resolve, reject) => {
      const http = createServer((req, res) => this.handleHttp(req, res));
      this.http = http;
      http.once('error', reject);
      http.listen(this.config.port, this.config.host, () => {
        const address = http.address();
        this.listeningPort = typeof address === 'object' && address ? address.port : this.config.port;
        const wss = new WebSocketServer({
          server: http,
          maxPayload: MAX_CLIENT_MESSAGE_BYTES,
        });
        this.wss = wss;
        wss.on('connection', (socket) => this.handleConnection(socket));
        resolve();
      });
    });
    this.world.startLoops();
    serverLog('started');
    console.log(`Frontier Cubes Server listening on ${this.wsUrl()}`);
    serverLog(`world loaded: ${this.config.worldId}`);
    console.log('Anarchy server ready');
  }

  async stop(): Promise<void> {
    const seen = new Set<string>();
    for (const [socket, binding] of this.sockets) {
      if (!seen.has(binding.playerId)) {
        seen.add(binding.playerId);
        this.world.disconnect(binding.playerId, true, binding.connectionId);
      }
      socket.close();
    }
    this.sockets.clear();
    await this.world.stop();
    await new Promise<void>((resolve) => {
      this.wss?.close(() => resolve());
      if (!this.wss) resolve();
    });
    await new Promise<void>((resolve) => {
      this.http?.close(() => resolve());
      if (!this.http) resolve();
    });
    serverLog('stopped');
  }

  private handleHttp(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    if (req.method === 'GET' && (url === '/status' || url === '/status.json')) {
      const body = JSON.stringify({
        name: this.config.serverName,
        world: this.config.worldId,
        ready: this.world.readyState === 'READY',
        online: this.world.onlineCount(),
        maxPlayers: this.config.maxPlayers,
        tickRate: this.config.tickRate,
      });
      res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    res.writeHead(404, cors);
    res.end('Not found');
  }

  private handleConnection(socket: WebSocket): void {
    serverLog('client connected');
    let joined = false;
    socket.on('message', (data) => {
      try {
        this.onMessage(socket, data.toString(), joined, (playerId, connectionId) => {
          joined = true;
          this.sockets.set(socket, { playerId, connectionId, superseded: false });
        });
      } catch (error) {
        serverLog(`invalid client message: ${error instanceof Error ? error.message : String(error)}`, 'warn');
        this.send(socket, { type: 'error', code: 'invalid', message: 'Invalid message' });
      }
    });
    socket.on('close', () => {
      const binding = this.sockets.get(socket);
      this.sockets.delete(socket);
      if (binding && !binding.superseded) {
        this.world.disconnect(binding.playerId, true, binding.connectionId);
      }
      if (binding) this.refreshActiveSocketCount(binding.playerId);
      serverLog('client disconnected');
    });
    socket.on('error', () => {
      socket.close();
    });
  }

  private onMessage(
    socket: WebSocket,
    text: string,
    joined: boolean,
    onJoin: (playerId: string, connectionId: string) => void,
  ): void {
    if (text.length > MAX_CLIENT_MESSAGE_BYTES) {
      this.send(socket, { type: 'error', code: 'too_large', message: 'Message too large' });
      return;
    }
    let parsedJson: unknown;
    try {
      parsedJson = decodeJson(text);
    } catch {
      this.send(socket, { type: 'error', code: 'invalid', message: 'Invalid JSON' });
      return;
    }
    const message = parseClientMessage(parsedJson);
    if ('error' in message) {
      this.send(socket, { type: 'error', code: 'invalid', message: message.error });
      return;
    }
    if (!joined) {
      if (message.type !== 'join') {
        this.send(socket, { type: 'error', code: 'need_join', message: 'Send join first' });
        return;
      }
      this.handleJoin(socket, message, onJoin);
      return;
    }
    const binding = this.sockets.get(socket);
    if (!binding || binding.superseded) {
      this.send(socket, { type: 'error', code: 'stale_session', message: 'Session moved to another tab' });
      return;
    }
    const player = this.world.players.get(binding.playerId);
    if (!player || !player.connected || player.connectionId !== binding.connectionId) {
      this.send(socket, { type: 'error', code: 'stale_session', message: 'Session moved to another tab' });
      return;
    }
    this.handlePlayMessage(player, binding.connectionId, message);
  }

  private handleJoin(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: 'join' }>,
    onJoin: (playerId: string, connectionId: string) => void,
  ): void {
    const sink = new WsSink(socket);
    const result = this.world.join({
      sink,
      name: message.name,
      sessionToken: message.sessionToken,
    });
    if ('error' in result) {
      this.send(socket, { type: 'error', code: 'join_failed', message: result.error });
      socket.close();
      return;
    }
    const { player, resumed, previousConnectionId } = result;
    onJoin(player.id, player.connectionId);
    this.supersedeOtherSockets(player.id, socket);
    this.refreshActiveSocketCount(player.id);
    const others = this.world.connectedPlayers()
      .filter((other) => other.id !== player.id)
      .map((other) => other.remoteInfo());
    const welcomeStarted = performance.now();
    const welcome: ServerWelcomeMessage = {
      type: 'welcome',
      protocol: PROTOCOL_VERSION,
      playerId: player.id,
      sessionToken: player.sessionToken,
      name: player.name,
      seed: this.world.seed,
      worldId: this.world.worldId,
      timeOfDay: this.world.world.timeOfDay,
      spawn: this.world.spawn,
      you: player.snapshot(),
      inventory: player.inventory.serialize(),
      players: others,
      modifications: this.world.modifications(),
      blockStates: this.world.blockStates(),
      online: this.world.onlineCount(),
      maxPlayers: this.config.maxPlayers,
      serverName: this.config.serverName,
    };
    const encoded = encodeMessage(welcome);
    const welcomeMs = performance.now() - welcomeStarted;
    if (welcomeMs >= 20) {
      serverLog(
        `welcome encode ${welcomeMs.toFixed(1)}ms bytes=${encoded.length} `
        + `modChunks=${Object.keys(welcome.modifications).length} `
        + `resumed=${resumed} prev=${previousConnectionId?.slice(0, 8) ?? '—'}`,
        'warn',
      );
    }
    if (socket.readyState === WebSocket.OPEN) socket.send(encoded);
    if (!resumed) {
      this.world.broadcast({ type: 'player_joined', player: player.remoteInfo() }, player.id);
    }
    this.world.broadcast({
      type: 'status',
      online: this.world.onlineCount(),
      maxPlayers: this.config.maxPlayers,
    });
  }

  private handlePlayMessage(
    player: ServerPlayer,
    connectionId: string,
    message: ClientMessage,
  ): void {
    switch (message.type) {
      case 'join':
        return;
      case 'input':
        this.world.applyInput(player, message, { connectionId });
        return;
      case 'break_block': {
        const intent = blockIntentFromFields(message);
        if (hasCapturedBlockIntent(message) && !intent) {
          this.world.sendTo(player, {
            type: 'block_result',
            ok: false,
            action: 'break',
            x: message.x,
            y: message.y,
            z: message.z,
            reason: 'invalid',
          });
          this.world.sendTo(player, {
            type: 'action_result',
            actionSeq: message.actionSeq ?? -1,
            kind: 'break',
            ok: false,
            reason: 'invalid',
            targetX: message.x,
            targetY: message.y,
            targetZ: message.z,
          });
          return;
        }
        const result = this.world.tryBreak(player, message.x, message.y, message.z, intent, message.commandSeq);
        this.world.sendTo(player, {
          type: 'block_result',
          ok: result.ok,
          action: 'break',
          x: message.x,
          y: message.y,
          z: message.z,
          ...(result.ok ? {} : { reason: result.reason }),
        });
        this.world.sendTo(player, {
          type: 'action_result',
          actionSeq: message.actionSeq ?? -1,
          kind: 'break',
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
          targetX: message.x,
          targetY: message.y,
          targetZ: message.z,
        });
        if (!result.ok) {
          serverLog(`break rejected: ${result.reason} ${message.x},${message.y},${message.z} by ${player.name}`, 'warn');
        }
        return;
      }
      case 'place_block': {
        const intent = blockIntentFromFields(message);
        if (hasCapturedBlockIntent(message) && !intent) {
          this.world.sendTo(player, {
            type: 'block_result',
            ok: false,
            action: 'place',
            x: message.x,
            y: message.y,
            z: message.z,
            reason: 'invalid',
          });
          this.world.sendTo(player, {
            type: 'action_result',
            actionSeq: message.actionSeq ?? -1,
            kind: 'place',
            ok: false,
            reason: 'invalid',
            targetX: message.x,
            targetY: message.y,
            targetZ: message.z,
          });
          return;
        }
        const result = this.world.tryPlace(player, message.x, message.y, message.z, message.blockId, intent, message.commandSeq);
        this.world.sendTo(player, {
          type: 'block_result',
          ok: result.ok,
          action: 'place',
          x: message.x,
          y: message.y,
          z: message.z,
          ...(result.ok ? {} : { reason: result.reason }),
        });
        this.world.sendTo(player, {
          type: 'action_result',
          actionSeq: message.actionSeq ?? -1,
          kind: 'place',
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
          targetX: message.x,
          targetY: message.y,
          targetZ: message.z,
        });
        if (!result.ok) {
          serverLog(`place rejected: ${result.reason} ${message.x},${message.y},${message.z} by ${player.name}`, 'warn');
        }
        return;
      }
      case 'chat':
        this.world.handleChat(player, message.text);
        return;
      case 'view':
        this.world.setView(player, message.cx, message.cz, message.radius);
        return;
      case 'ping':
        this.world.sendTo(player, { type: 'pong', t: message.t });
        return;
      case 'inventory_action':
        this.world.applyInventoryAction(player, message);
        return;
      case 'craft':
        this.world.applyInventoryAction(player, {
          type: 'inventory_action',
          action: 'click',
          key: 'result',
          shift: message.shift === true,
        });
        return;
      case 'interact': {
        const intent = blockIntentFromFields(message);
        if (hasCapturedBlockIntent(message) && !intent) {
          this.world.sendTo(player, {
            type: 'action_result',
            actionSeq: message.actionSeq ?? -1,
            kind: 'block_use',
            ok: false,
            reason: 'invalid',
          });
          return;
        }
        const result = this.world.interact(player, intent, message.actionSeq, message.commandSeq);
        this.world.sendTo(player, {
          type: 'action_result',
          actionSeq: message.actionSeq ?? -1,
          kind: 'block_use',
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
          ...(intent ? { targetX: intent.targetX, targetY: intent.targetY, targetZ: intent.targetZ, faceX: intent.faceX, faceY: intent.faceY, faceZ: intent.faceZ } : {}),
        });
        return;
      }
      case 'bow_release': {
        const result = this.world.releaseBow(player, message);
        this.world.sendTo(player, {
          type: 'action_result',
          actionSeq: message.actionSeq,
          kind: 'bow_release',
          ok: result.ok,
          ...(result.ok ? {} : { reason: result.reason }),
          yaw: message.yaw,
          pitch: message.pitch,
        });
        return;
      }
      case 'action': {
        this.handleSequencedAction(player, message);
        return;
      }
      case 'attack':
        if (message.actionSeq !== undefined && !this.world.acceptClientActionSeq(player, message.actionSeq)) {
          this.world.sendTo(player, {
            type: 'action_result',
            actionSeq: message.actionSeq,
            kind: 'attack',
            ok: false,
            reason: 'duplicate',
          });
          return;
        }
        this.world.attack(player);
        return;
      case 'pickup':
        this.world.pickup(player);
        return;
      case 'vehicle_input':
        this.world.vehicleInput(player, message);
        return;
    }
  }

  private handleSequencedAction(
    player: ServerPlayer,
    message: Extract<ClientMessage, { type: 'action' }>,
  ): void {
    const intent = blockIntentFromFields(message);
    const targeted = message.kind === 'block_use'
      || message.kind === 'block_break_start'
      || message.kind === 'block_break_finish';
    let result: { ok: true } | { ok: false; reason: string };
    if (targeted && !intent) {
      result = { ok: false, reason: 'invalid' };
    } else if (message.kind === 'block_use') {
      result = this.world.interact(player, intent, message.actionSeq, message.commandSeq);
    } else if (message.kind === 'block_break_start') {
      result = this.world.beginMining(player, intent!, message.actionSeq, message.commandSeq);
    } else if (message.kind === 'block_break_abort') {
      if (!this.world.acceptClientActionSeq(player, message.actionSeq)) {
        result = { ok: false, reason: 'duplicate' };
      } else {
        this.world.abortMining(player);
        result = { ok: true };
      }
    } else if (message.kind === 'block_break_finish') {
      const x = message.targetX ?? message.x;
      const y = message.targetY ?? message.y;
      const z = message.targetZ ?? message.z;
      if (x === undefined || y === undefined || z === undefined) {
        result = { ok: false, reason: 'invalid' };
      } else if (!this.world.acceptClientActionSeq(player, message.actionSeq)) {
        result = { ok: false, reason: 'duplicate' };
      } else {
        result = this.world.tryBreak(player, x, y, z, intent, message.commandSeq);
      }
    } else if (message.kind === 'bow_release') {
      if (message.yaw === undefined || message.pitch === undefined) {
        result = { ok: false, reason: 'look' };
      } else {
        result = this.world.releaseBow(player, {
          actionSeq: message.actionSeq,
          commandSeq: message.commandSeq,
          yaw: message.yaw,
          pitch: message.pitch,
        });
      }
    } else {
      if (message.actionSeq !== undefined && !this.world.acceptClientActionSeq(player, message.actionSeq)) {
        result = { ok: false, reason: 'duplicate' };
      } else {
        this.world.attack(player);
        result = { ok: true };
      }
    }
    this.world.sendTo(player, {
      type: 'action_result',
      actionSeq: message.actionSeq,
      kind: message.kind,
      ok: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
      ...(intent
        ? {
          targetX: intent.targetX,
          targetY: intent.targetY,
          targetZ: intent.targetZ,
          faceX: intent.faceX,
          faceY: intent.faceY,
          faceZ: intent.faceZ,
        }
        : {}),
      ...(message.yaw !== undefined ? { yaw: message.yaw } : {}),
      ...(message.pitch !== undefined ? { pitch: message.pitch } : {}),
    });
    if (!result.ok) {
      serverLog(`action ${message.kind} rejected: ${result.reason} by ${player.name}`, 'warn');
    }
  }

  private supersedeOtherSockets(playerId: string, keep: WebSocket): void {
    for (const [socket, binding] of this.sockets) {
      if (binding.playerId !== playerId || socket === keep) continue;
      binding.superseded = true;
      this.send(socket, {
        type: 'error',
        code: 'session_taken',
        message: 'Сессия открыта в другой вкладке',
      });
      socket.close();
    }
  }

  private refreshActiveSocketCount(playerId: string): void {
    let count = 0;
    for (const binding of this.sockets.values()) {
      if (binding.playerId === playerId && !binding.superseded) count += 1;
    }
    this.world.setActiveSocketCount(playerId, count);
  }

  activeSocketCount(playerId: string): number {
    let count = 0;
    for (const binding of this.sockets.values()) {
      if (binding.playerId === playerId && !binding.superseded) count += 1;
    }
    return count;
  }

  private send(socket: WebSocket, payload: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeMessage(payload));
  }
}
