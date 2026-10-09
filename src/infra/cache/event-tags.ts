import type { DomainEvent } from '../events/domain-events';
import { CacheTags } from './cache-tags';

/**
 * Which cached responses a domain event makes stale. Shared by the Redis
 * cache and the frontend (Next.js data cache) revalidation.
 */
export function tagsForEvent(event: DomainEvent): string[] {
  switch (event.type) {
    case 'match.changed':
      return [
        CacheTags.match(event.matchId),
        CacheTags.matchLive(event.matchId),
        CacheTags.matches,
        CacheTags.live,
        CacheTags.home,
        ...(event.tournamentId
          ? [CacheTags.tournament(event.tournamentId)]
          : []),
        ...(event.teamIds ?? []).map((id) => CacheTags.team(id)),
      ];
    case 'match.live-data':
      // Broadcast variants are embedded in match lists and the home payload.
      return event.kind === 'broadcasts'
        ? [
            CacheTags.matchLive(event.matchId),
            CacheTags.matches,
            CacheTags.live,
            CacheTags.home,
          ]
        : [CacheTags.matchLive(event.matchId)];
    case 'catalog.changed':
      // Names, logos and slugs are embedded across lists: drop the whole catalog.
      return [CacheTags.catalog];
    case 'tickets.changed':
      return [CacheTags.tickets(event.matchId)];
    case 'comment.created':
    case 'comment.deleted':
    case 'order.changed':
      return [];
  }
}
