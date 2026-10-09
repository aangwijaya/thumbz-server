/**
 * Cache tag vocabulary. Responses are tagged with what they contain; domain
 * events invalidate the matching tags (see CacheInvalidationListener).
 */
export const CacheTags = {
  /** Any catalog read (teams, players, tournaments, videos, search). */
  catalog: 'catalog',
  home: 'home',
  /** Match lists: /matches, /matches/upcoming, /matches/featured. */
  matches: 'matches',
  /** /matches/live and anything showing live state. */
  live: 'live',
  match: (id: string) => `match:${id}`,
  /** Hot live sub-resources (economy, live stats, equipment, events, broadcasts). */
  matchLive: (id: string) => `match:${id}:live`,
  tournament: (id: string) => `tournament:${id}`,
  team: (id: string) => `team:${id}`,
  tickets: (matchId: string) => `tickets:${matchId}`,
} as const;
