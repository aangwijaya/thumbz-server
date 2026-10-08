/** Job names on the maintenance queue (one scheduler per name). */
export const Jobs = {
  expireHolds: 'expire-holds',
  liveSimulator: 'live-simulator',
} as const;

export const EXPIRE_HOLDS_EVERY_MS = 60_000;
