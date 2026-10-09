import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEventOf } from '../../infra/events/domain-events';
import { PrismaService } from '../../prisma/prisma.service';
import { RealtimeEvents, Rooms } from './realtime.constants';
import { RealtimePublisher } from './realtime-publisher';

/** The score/status slice of a match pushed on every change. */
export interface MatchUpdate {
  id: string;
  status: string;
  score_a: number | null;
  score_b: number | null;
  winner_team_id: string | null;
  viewer_count: number;
  started_at: Date | null;
  ended_at: Date | null;
  /** Current game and the series so far (contract §19). */
  game_number: number | null;
  games: Array<{
    game_number: number;
    status: string;
    winner_team_id: string | null;
  }>;
}

/**
 * Turns committed domain events into realtime messages. Small, fully known
 * payloads (score, comments) are pushed directly; heavy live sub-resources
 * are announced ("notify, then fetch") and clients re-read them over REST,
 * where the 3 s cache + single flight collapse N viewers into one query.
 */
@Injectable()
export class RealtimeBroadcaster {
  private readonly logger = new Logger(RealtimeBroadcaster.name);

  constructor(
    private readonly gateway: RealtimePublisher,
    private readonly prisma: PrismaService,
  ) {}

  @OnEvent('match.changed', { async: true })
  async onMatchChanged(event: DomainEventOf<'match.changed'>): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id: event.matchId },
      select: {
        id: true,
        status: true,
        score_a: true,
        score_b: true,
        winner_team_id: true,
        viewer_count: true,
        started_at: true,
        ended_at: true,
        game_number: true,
        games: {
          orderBy: { game_number: 'asc' },
          select: { game_number: true, status: true, winner_team_id: true },
        },
      },
    });
    if (match === null) return; // deleted
    await this.safely(() =>
      this.gateway.publish<MatchUpdate>(
        Rooms.match(match.id),
        RealtimeEvents.matchUpdate,
        match,
      ),
    );
    await this.safely(() =>
      this.gateway.publish(Rooms.live, RealtimeEvents.liveChanged, {
        match_id: match.id,
        status: match.status,
      }),
    );
  }

  @OnEvent('match.live-data', { async: true })
  async onLiveData(event: DomainEventOf<'match.live-data'>): Promise<void> {
    await this.safely(() =>
      this.gateway.publish(
        Rooms.match(event.matchId),
        RealtimeEvents.matchLive,
        {
          kind: event.kind,
        },
      ),
    );
  }

  @OnEvent('comment.created', { async: true })
  async onCommentCreated(
    event: DomainEventOf<'comment.created'>,
  ): Promise<void> {
    const comment = await this.prisma.matchComment.findUnique({
      where: { id: event.commentId },
      select: {
        id: true,
        match_id: true,
        user_id: true,
        author_name: true,
        body: true,
        created_at: true,
      },
    });
    if (comment === null) return;
    await this.safely(() =>
      this.gateway.publish(
        Rooms.match(comment.match_id),
        RealtimeEvents.commentNew,
        comment,
      ),
    );
  }

  @OnEvent('comment.deleted', { async: true })
  async onCommentDeleted(
    event: DomainEventOf<'comment.deleted'>,
  ): Promise<void> {
    await this.safely(() =>
      this.gateway.publish(
        Rooms.match(event.matchId),
        RealtimeEvents.commentDeleted,
        {
          id: event.commentId,
        },
      ),
    );
  }

  @OnEvent('tickets.changed', { async: true })
  async onTicketsChanged(
    event: DomainEventOf<'tickets.changed'>,
  ): Promise<void> {
    await this.safely(() =>
      this.gateway.publish(
        Rooms.match(event.matchId),
        RealtimeEvents.ticketsChanged,
        {
          match_id: event.matchId,
        },
      ),
    );
  }

  @OnEvent('order.changed', { async: true })
  async onOrderChanged(event: DomainEventOf<'order.changed'>): Promise<void> {
    await this.safely(() =>
      this.gateway.publish(
        Rooms.user(event.userId),
        RealtimeEvents.orderUpdate,
        {
          id: event.orderId,
          match_id: event.matchId,
          status: event.status,
        },
      ),
    );
  }

  /** Realtime is best effort: a failed push never fails the write. */
  private async safely(publish: () => Promise<void>): Promise<void> {
    try {
      await publish();
    } catch (error) {
      this.logger.warn(`realtime publish failed: ${String(error)}`);
    }
  }
}
