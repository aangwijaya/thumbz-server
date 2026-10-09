import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import type { Server, ServerOptions } from 'socket.io';
import { REDIS } from '../../infra/redis/redis.constants';

/**
 * Socket.IO server with the API's CORS allowlist and, when Redis is
 * configured, the Redis adapter so broadcasts reach sockets on every API
 * instance (and events published by the worker via @socket.io/redis-emitter).
 */
export class RealtimeIoAdapter extends IoAdapter {
  private readonly log = new Logger(RealtimeIoAdapter.name);
  private readonly origins: string[];
  private readonly redis: Redis | null;
  private subscriber: Redis | null = null;

  constructor(app: INestApplicationContext) {
    super(app);
    this.origins = app.get(ConfigService).get<string[]>('corsOrigins') ?? [];
    this.redis = app.get<Redis | null>(REDIS, { strict: false }) ?? null;
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.origins, credentials: false },
      // Long-polling fallback for networks that block WebSockets.
      transports: ['websocket', 'polling'],
      pingInterval: 25_000,
      pingTimeout: 20_000,
      // No connectionStateRecovery: the Redis (pub/sub) adapter cannot replay.
      // Clients detect gaps via per-room `seq` and resync over REST instead.
    }) as Server;

    if (this.redis) {
      this.subscriber = this.redis.duplicate();
      server.adapter(createAdapter(this.redis, this.subscriber));
      this.log.log('Socket.IO using the Redis adapter');
    }
    return server;
  }

  async close(server: Server): Promise<void> {
    await super.close(server);
    await this.subscriber?.quit().catch(() => undefined);
  }
}
