import { Inject, Injectable, Logger } from '@nestjs/common';
import { Emitter } from '@socket.io/redis-emitter';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.constants';
import { RealtimePublisher } from './realtime-publisher';
import { SequencerService } from './sequencer.service';

/** Publishes from a process without sockets via the Redis adapter's channel. */
@Injectable()
export class EmitterRealtimePublisher extends RealtimePublisher {
  private readonly logger = new Logger(EmitterRealtimePublisher.name);
  private readonly emitter: ReturnType<Emitter['of']> | null;

  constructor(
    @Inject(REDIS) redis: Redis | null,
    private readonly sequencer: SequencerService,
  ) {
    super();
    this.emitter = redis ? new Emitter(redis).of('/rt') : null;
    if (!redis)
      this.logger.warn(
        'no Redis: realtime pushes from this process are disabled',
      );
  }

  async publish<T>(room: string, event: string, data: T): Promise<void> {
    if (!this.emitter) return;
    const seq = await this.sequencer.next(room);
    this.emitter.to(room).emit(event, { room, seq, data });
  }
}
