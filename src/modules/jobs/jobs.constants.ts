/** Job names on the maintenance queue (one scheduler per name). */
export const Jobs = {
  expireHolds: 'expire-holds',
  liveSimulator: 'live-simulator',
  reconcilePayments: 'reconcile-payments',
} as const;

export const EXPIRE_HOLDS_EVERY_MS = 60_000;
export const RECONCILE_PAYMENTS_EVERY_MS = 5 * 60_000;
