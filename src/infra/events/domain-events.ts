import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Facts the rest of the system reacts to (cache invalidation, realtime
 * fan-out, frontend revalidation). Emitted after the write committed.
 */
export type DomainEvent =
  | {
      type: 'match.changed';
      matchId: string;
      tournamentId?: string | null;
      teamIds?: string[];
    }
  | {
      type: 'match.live-data';
      matchId: string;
      kind: 'economy' | 'live-stats' | 'equipment' | 'events' | 'broadcasts';
    }
  | {
      type: 'catalog.changed';
      entity: 'tournament' | 'team' | 'player' | 'video';
      id: string;
    }
  | { type: 'tickets.changed'; matchId: string }
  | { type: 'comment.created'; matchId: string; commentId: string }
  | { type: 'comment.deleted'; matchId: string; commentId: string };

export type DomainEventType = DomainEvent['type'];

export type DomainEventOf<T extends DomainEventType> = Extract<
  DomainEvent,
  { type: T }
>;

@Injectable()
export class DomainEvents {
  constructor(private readonly emitter: EventEmitter2) {}

  emit(event: DomainEvent): void {
    this.emitter.emit(event.type, event);
  }
}
