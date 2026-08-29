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
} from '../shared/protocol';
import type { ServerConfig } from './config';
import { serverLog } from './log';
import { WorldInstance, type ConnectedSink } from './WorldInstance';

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
  private readonly sockets = new Map<WebSocket, string>();

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

  async start(): Promise<void> {
    await this.world.initialize();
    this.world.plugins.enableAll();
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
    for (const [socket, playerId] of this.sockets) {
      this.world.disconnect(playerId);
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
        this.onMessage(socket, data.toString(), joined, (playerId) => {
          joined = true;
          this.sockets.set(socket, playerId);
        });
      } catch (error) {
        serverLog(`invalid client message: ${error instanceof Error ? error.message : String(error)}`, 'warn');
        this.send(socket, { type: 'error', code: 'invalid', message: 'Invalid message' });
      }
    });
    socket.on('close', () => {
      const playerId = this.sockets.get(socket);
      this.sockets.delete(socket);
      if (playerId) this.world.disconnect(playerId);
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
    onJoin: (playerId: string) => void,
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
    const playerId = this.sockets.get(socket);
    if (!playerId) {
      this.send(socket, { type: 'error', code: 'not_joined', message: 'Not joined' });
      return;
    }
    const player = this.world.players.get(playerId);
    if (!player || !player.connected) {
      this.send(socket, { type: 'error', code: 'not_joined', message: 'Not joined' });
      return;
    }
    this.handlePlayMessage(playerId, message);
  }

  private handleJoin(
    socket: WebSocket,
    message: Extract<ClientMessage, { type: 'join' }>,
    onJoin: (playerId: string) => void,
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
    const { player, resumed } = result;
    onJoin(player.id);
    const others = this.world.connectedPlayers()
      .filter((other) => other.id !== player.id)
      .map((other) => other.remoteInfo());
    this.send(socket, {
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
    });
    if (!resumed) {
      this.world.broadcast({ type: 'player_joined', player: player.remoteInfo() }, player.id);
    }
    this.world.broadcast({
      type: 'status',
      online: this.world.onlineCount(),
      maxPlayers: this.config.maxPlayers,
    });
  }

  private handlePlayMessage(playerId: string, message: ClientMessage): void {
    const player = this.world.players.get(playerId);
    if (!player) return;
    switch (message.type) {
      case 'join':
        return;
      case 'input':
        this.world.applyInput(player, message);
        return;
      case 'break_block': {
        const result = this.world.tryBreak(player, message.x, message.y, message.z);
        this.world.sendTo(player, {
          type: 'block_result',
          ok: result.ok,
          action: 'break',
          x: message.x,
          y: message.y,
          z: message.z,
          ...(result.ok ? {} : { reason: result.reason }),
        });
        if (!result.ok) {
          serverLog(`break rejected: ${result.reason} ${message.x},${message.y},${message.z} by ${player.name}`, 'warn');
        }
        return;
      }
      case 'place_block': {
        const result = this.world.tryPlace(player, message.x, message.y, message.z, message.blockId);
        this.world.sendTo(player, {
          type: 'block_result',
          ok: result.ok,
          action: 'place',
          x: message.x,
          y: message.y,
          z: message.z,
          ...(result.ok ? {} : { reason: result.reason }),
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
    }
  }

  private send(socket: WebSocket, payload: ServerMessage): void {
    if (socket.readyState !== WebSocket.OPEN) return;
    socket.send(encodeMessage(payload));
  }
}
