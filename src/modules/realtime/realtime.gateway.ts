import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { DefaultEventsMap, Namespace, Socket } from 'socket.io';
import { JwtVerifierService } from '../../common/auth/jwt-verifier.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MetricsService } from '../../infra/metrics/metrics.service';
import { PresenceService } from './presence.service';
import {
  isPublicRoom,
  MAX_ROOMS_PER_SOCKET,
  RealtimeEvents,
  Rooms,
} from './realtime.constants';
import { SequencerService } from './sequencer.service';

interface SocketData {
  user?: CurrentUser;
  rooms: Set<string>;
  /** Message timestamps in the current window (simple rate limit). */
  recent: number[];
}

type RealtimeSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

type Ack =
  { ok: true; room: string; seq: number } | { ok: false; error: string };

const RATE_WINDOW_MS = 10_000;
const RATE_MAX_MESSAGES = 30;
const VIEWER_BROADCAST_MS = 15_000;

/**
 * Realtime channel (Socket.IO namespace /rt). Clients join match rooms to get
 * score updates, live-data notifications and chat; signed-in clients are
 * also in their user room (order updates). Writes stay on REST.
 */
@WebSocketGateway({ namespace: '/rt' })
export class RealtimeGateway
  implements
    OnGatewayInit,
    OnGatewayConnection,
    OnGatewayDisconnect,
    OnModuleDestroy
{
  private readonly logger = new Logger(RealtimeGateway.name);
  private viewerTimer: NodeJS.Timeout | null = null;
  private readonly connections;

  @WebSocketServer()
  server!: Namespace;

  constructor(
    private readonly verifier: JwtVerifierService,
    private readonly presence: PresenceService,
    private readonly sequencer: SequencerService,
    metrics: MetricsService,
  ) {
    this.connections = metrics.gauge(
      'thumbz_ws_connections',
      'Open realtime connections on this instance',
    );
  }

  afterInit(): void {
    this.viewerTimer = setInterval(
      () => void this.broadcastViewerCounts(),
      VIEWER_BROADCAST_MS,
    );
    this.viewerTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.viewerTimer) clearInterval(this.viewerTimer);
  }

  async handleConnection(socket: RealtimeSocket): Promise<void> {
    socket.data = { rooms: new Set(), recent: [] };
    this.connections.inc();
    const token: unknown = socket.handshake.auth?.token;
    if (typeof token === 'string' && token.length > 0) {
      try {
        const user = await this.verifier.verify(token);
        socket.data.user = user;
        await socket.join(Rooms.user(user.sub));
      } catch {
        // Anonymous is fine for public rooms; tell the client its token failed.
        socket.emit('auth:error');
      }
    }
  }

  async handleDisconnect(socket: RealtimeSocket): Promise<void> {
    this.connections.dec();
    await Promise.all(
      [...(socket.data?.rooms ?? [])].map((room) =>
        this.presence.leave(room, socket.id),
      ),
    );
  }

  @SubscribeMessage('subscribe')
  async subscribe(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: { room?: unknown },
  ): Promise<Ack> {
    if (!this.allow(socket)) return { ok: false, error: 'rate_limited' };
    const room = body?.room;
    if (!isPublicRoom(room)) return { ok: false, error: 'invalid_room' };
    if (
      !socket.data.rooms.has(room) &&
      socket.data.rooms.size >= MAX_ROOMS_PER_SOCKET
    ) {
      return { ok: false, error: 'too_many_rooms' };
    }
    await socket.join(room);
    socket.data.rooms.add(room);
    await this.presence.touch(room, socket.id);
    // The current seq is the client's baseline for gap detection.
    return { ok: true, room, seq: await this.sequencer.current(room) };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(
    @ConnectedSocket() socket: RealtimeSocket,
    @MessageBody() body: { room?: unknown },
  ): Promise<Ack> {
    const room = body?.room;
    if (!isPublicRoom(room) || !socket.data.rooms.has(room)) {
      return { ok: false, error: 'not_subscribed' };
    }
    await socket.leave(room);
    socket.data.rooms.delete(room);
    await this.presence.leave(room, socket.id);
    return { ok: true, room, seq: await this.sequencer.current(room) };
  }

  /** Clients ping while a match page is visible; keeps presence fresh. */
  @SubscribeMessage('presence:ping')
  async ping(@ConnectedSocket() socket: RealtimeSocket): Promise<void> {
    if (!this.allow(socket)) return;
    await Promise.all(
      [...socket.data.rooms]
        .filter((room) => room.startsWith('match:'))
        .map((room) => this.presence.touch(room, socket.id)),
    );
  }

  /** Publishes `data` to a room with the next sequence number. */
  async publish<T>(room: string, event: string, data: T): Promise<void> {
    if (!this.server) return;
    const seq = await this.sequencer.next(room);
    this.server.to(room).emit(event, { room, seq, data });
  }

  private allow(socket: RealtimeSocket): boolean {
    const now = Date.now();
    socket.data.recent = socket.data.recent.filter(
      (at) => now - at < RATE_WINDOW_MS,
    );
    socket.data.recent.push(now);
    if (socket.data.recent.length > RATE_MAX_MESSAGES) {
      this.logger.warn(`disconnecting abusive socket ${socket.id}`);
      socket.disconnect(true);
      return false;
    }
    return true;
  }

  private async broadcastViewerCounts(): Promise<void> {
    const rooms = this.server?.adapter?.rooms;
    if (!rooms) return;
    for (const [room, members] of rooms) {
      if (!room.startsWith('match:')) continue;
      const count = await this.presence.count(room, members.size);
      // Viewer counts are snapshots: no seq, a missed one is harmless.
      this.server.to(room).emit(RealtimeEvents.matchViewers, {
        room,
        data: { online: count },
      });
    }
  }
}
