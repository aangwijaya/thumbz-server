import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { tagsForEvent } from '../cache/event-tags';
import type { DomainEvent } from '../events/domain-events';

/** Coalesce bursts (bulk ingestion, live updates) into one call per window. */
const FLUSH_WINDOW_MS = 500;
const REQUEST_TIMEOUT_MS = 3_000;

/**
 * Tells the Next.js frontend which data-cache tags went stale so its ISR pages
 * refresh on change instead of waiting for their revalidate interval.
 * Disabled unless REVALIDATE_SECRET is configured.
 */
@Injectable()
export class FrontendRevalidationListener implements OnModuleDestroy {
  private readonly logger = new Logger(FrontendRevalidationListener.name);
  private readonly endpoint: string;
  private readonly secret: string | null;
  private readonly pending = new Set<string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(config: ConfigService) {
    this.endpoint = `${config.get<string>('frontendUrl')}/api/revalidate`;
    this.secret = config.get<string | null>('revalidateSecret') ?? null;
  }

  // Live-data ticks are pushed over WebSocket; only structural changes matter here.
  @OnEvent('match.changed')
  @OnEvent('catalog.changed')
  onDomainEvent(event: DomainEvent): void {
    if (this.secret === null) {
      return;
    }
    tagsForEvent(event).forEach((tag) => this.pending.add(tag));
    this.timer ??= setTimeout(() => void this.flush(), FLUSH_WINDOW_MS);
  }

  async flush(): Promise<void> {
    this.timer = null;
    const tags = [...this.pending];
    this.pending.clear();
    if (tags.length === 0 || this.secret === null) {
      return;
    }
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.secret}`,
        },
        body: JSON.stringify({ tags }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`frontend revalidation returned ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`frontend revalidation failed: ${String(error)}`);
    }
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
