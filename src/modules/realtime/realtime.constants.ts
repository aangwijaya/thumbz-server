/** Server → client events (see docs/API-CONTRACT.md §14). */
export const RealtimeEvents = {
  matchUpdate: 'match:update',
  matchLive: 'match:live',
  matchViewers: 'match:viewers',
  commentNew: 'comment:new',
  commentDeleted: 'comment:deleted',
  ticketsChanged: 'tickets:changed',
  liveChanged: 'live:changed',
  orderUpdate: 'order:update',
} as const;

export const MAX_ROOMS_PER_SOCKET = 5;

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PUBLIC_ROOM = new RegExp(`^(live|match:${UUID})$`, 'i');

export const Rooms = {
  live: 'live',
  match: (id: string) => `match:${id}`,
  user: (sub: string) => `user:${sub}`,
};

/** Rooms a client may join itself (user rooms are joined on authentication). */
export function isPublicRoom(room: unknown): room is string {
  return typeof room === 'string' && PUBLIC_ROOM.test(room);
}

/** Every pushed payload carries the room and a per-room sequence number. */
export interface Envelope<T> {
  room: string;
  seq: number;
  data: T;
}
