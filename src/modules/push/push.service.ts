import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS } from '../../infra/redis/redis.constants';
import { PrismaService } from '../../prisma/prisma.service';
import type { AppConfig } from '../../config/configuration';
import { PUSH_SENDER, type PushSender } from './push.sender';

/** Reminders go out once a match is this close to its start. */
export const REMINDER_LEAD_MS = 15 * 60_000;
/** Dedupe window per (match, user): long enough to outlive any reschedule wobble. */
const REMINDED_TTL_SECONDS = 6 * 60 * 60;

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface SubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

interface StoredSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

const formatStage = (stage: string | null) =>
  stage
    ? stage.replace(/_/g, ' ').replace(/^\w/, (first) => first.toUpperCase())
    : null;

/**
 * Web Push for match reminders (contract §18): subscription storage, delivery
 * with dead-endpoint cleanup, and the reminder sweep run by the worker.
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private readonly vapid: AppConfig['vapid'];

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
    @Inject(PUSH_SENDER) private readonly sender: PushSender,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {
    this.vapid = config.get<AppConfig['vapid']>('vapid') ?? null;
  }

  get enabled(): boolean {
    return this.vapid !== null;
  }

  publicConfig(): { enabled: boolean; public_key: string | null } {
    return { enabled: this.enabled, public_key: this.vapid?.publicKey ?? null };
  }

  async subscribe(
    userId: string,
    input: SubscriptionInput,
  ): Promise<{ endpoint: string; created_at: Date }> {
    this.assertEnabled();
    // Upsert by endpoint: the device may re-subscribe or change accounts.
    const row = await this.prisma.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        user_id: userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: {
        user_id: userId,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      select: { endpoint: true, created_at: true },
    });
    return row;
  }

  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    await this.prisma.pushSubscription.deleteMany({
      where: { user_id: userId, endpoint },
    });
  }

  /** Test notification to every device of the caller. */
  async sendTest(userId: string): Promise<{ sent: number }> {
    this.assertEnabled();
    const subscriptions = await this.subscriptionsOf([userId]);
    if (subscriptions.length === 0) throw new NotFoundException();
    const sent = await this.deliver(subscriptions, {
      title: 'Match reminders are on',
      body: "We'll ping you 15 minutes before your teams play.",
      url: '/favorites',
      tag: 'thumbz:test',
    });
    return { sent };
  }

  /**
   * One sweep of the reminder job: scheduled matches starting within the lead
   * time, each follower of either team reminded once (Redis SET NX dedupe).
   */
  async remindUpcoming(now = new Date()): Promise<number> {
    if (!this.enabled) return 0;
    if (this.redis === null || this.redis.status !== 'ready') {
      // Without the dedupe store every sweep would re-send: skip instead.
      this.logger.warn('Redis unavailable: match reminders skipped');
      return 0;
    }
    const matches = await this.prisma.match.findMany({
      where: {
        status: 'scheduled',
        scheduled_at: {
          gt: now,
          lte: new Date(now.getTime() + REMINDER_LEAD_MS),
        },
      },
      select: {
        id: true,
        stage: true,
        scheduled_at: true,
        team_a_id: true,
        team_b_id: true,
        teamA: { select: { name: true, short_name: true } },
        teamB: { select: { name: true, short_name: true } },
        tournament: { select: { name: true } },
      },
    });

    let sent = 0;
    for (const match of matches) {
      const followers = await this.prisma.favorite.findMany({
        where: {
          entity_type: 'team',
          entity_id: { in: [match.team_a_id, match.team_b_id] },
          user: { push_subscriptions: { some: {} } },
        },
        select: { user_id: true },
        distinct: ['user_id'],
      });
      const fresh: string[] = [];
      for (const { user_id } of followers) {
        const first = await this.redis.set(
          `thumbz:push:reminded:${match.id}:${user_id}`,
          '1',
          'EX',
          REMINDED_TTL_SECONDS,
          'NX',
        );
        if (first === 'OK') fresh.push(user_id);
      }
      if (fresh.length === 0) continue;

      const minutes = Math.max(
        1,
        Math.round((match.scheduled_at.getTime() - now.getTime()) / 60_000),
      );
      const a = match.teamA.short_name || match.teamA.name;
      const b = match.teamB.short_name || match.teamB.name;
      sent += await this.deliver(await this.subscriptionsOf(fresh), {
        title: `${a} vs ${b} starts in ${minutes} min`,
        body:
          [match.tournament?.name, formatStage(match.stage)]
            .filter(Boolean)
            .join(' · ') || 'Tap to watch on THUMBZ',
        url: `/matches/${match.id}`,
        tag: `match:${match.id}`,
      });
    }
    return sent;
  }

  private subscriptionsOf(userIds: string[]): Promise<StoredSubscription[]> {
    return this.prisma.pushSubscription.findMany({
      where: { user_id: { in: userIds } },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  }

  /** Sends to each subscription; drops the ones the push service reports gone. */
  private async deliver(
    subscriptions: StoredSubscription[],
    payload: PushPayload,
  ): Promise<number> {
    const vapid = this.vapid!;
    const body = JSON.stringify(payload);
    const results = await Promise.allSettled(
      subscriptions.map((subscription) =>
        this.sender(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          {
            vapidDetails: vapid,
            TTL: 15 * 60, // a reminder is worthless once the match started
            urgency: 'high',
            topic: payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32),
          },
        ),
      ),
    );

    const gone: string[] = [];
    const delivered: string[] = [];
    results.forEach((result, index) => {
      const id = subscriptions[index].id;
      if (result.status === 'fulfilled') {
        delivered.push(id);
        return;
      }
      const status = (result.reason as { statusCode?: number })?.statusCode;
      if (status === 404 || status === 410) gone.push(id);
      else
        this.logger.warn(
          `push to subscription ${id} failed (${status ?? 'network'})`,
        );
    });
    if (gone.length > 0) {
      await this.prisma.pushSubscription.deleteMany({
        where: { id: { in: gone } },
      });
    }
    if (delivered.length > 0) {
      await this.prisma.pushSubscription.updateMany({
        where: { id: { in: delivered } },
        data: { last_used_at: new Date() },
      });
    }
    return delivered.length;
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('Push notifications are disabled');
    }
  }
}
