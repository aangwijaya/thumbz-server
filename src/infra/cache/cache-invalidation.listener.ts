import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import type { DomainEvent } from '../events/domain-events';
import { CacheService } from './cache.service';
import { tagsForEvent } from './event-tags';

/**
 * A reader that loaded before a write committed can store a stale entry just
 * after the first invalidation; a second pass shortly after closes that window
 * ("delayed double delete").
 */
const SECOND_PASS_MS = 1_000;

@Injectable()
export class CacheInvalidationListener implements OnModuleDestroy {
  private readonly timers = new Set<NodeJS.Timeout>();

  constructor(private readonly cache: CacheService) {}

  @OnEvent('match.changed')
  @OnEvent('match.live-data')
  @OnEvent('catalog.changed')
  @OnEvent('tickets.changed')
  onDomainEvent(event: DomainEvent): void {
    const tags = tagsForEvent(event);
    if (tags.length === 0) {
      return;
    }
    void this.cache.invalidateTags(tags);
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      void this.cache.invalidateTags(tags);
    }, SECOND_PASS_MS);
    timer.unref();
    this.timers.add(timer);
  }

  onModuleDestroy(): void {
    this.timers.forEach((timer) => clearTimeout(timer));
    this.timers.clear();
  }
}
