/**
 * Socket.IO fan-out test: N clients join one live match room and record when
 * each `match:live` broadcast reaches them (the live simulator emits them).
 * Reports connection success, connect time, and per-broadcast delivery spread
 * (first to last client), all from one process so the clock is shared.
 *
 *   node load/ws-fanout.mjs [clients=1000] [seconds=30]
 *   API_URL=https://api.example node load/ws-fanout.mjs 2000 60
 */
import { io } from 'socket.io-client';

const API = process.env.API_URL ?? 'http://localhost:3001';
const CLIENTS = Number(process.argv[2] ?? 1000);
const SECONDS = Number(process.argv[3] ?? 30);

const live = await (await fetch(`${API}/api/v1/matches/live`)).json();
const matchId = live?.data?.[0]?.id;
if (!matchId) {
  console.error('No live match: start the worker with LIVE_SIMULATOR=true');
  process.exit(1);
}
const room = `match:${matchId}`;

const percentile = (values, p) => {
  if (values.length === 0) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
};

const sockets = [];
const connectTimes = [];
const failures = [];
/** broadcast seq -> receive timestamps across clients */
const deliveries = new Map();
/** Broadcasts count only once every client is in the room. */
let recording = false;

async function connect() {
  const started = performance.now();
  const socket = io(`${API}/rt`, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    timeout: 10_000,
  });
  sockets.push(socket);
  await new Promise((resolve) => {
    socket.once('connect', resolve);
    socket.once('connect_error', (error) => {
      failures.push(error.message);
      resolve();
    });
  });
  if (!socket.connected) return;
  const ack = await socket
    .timeout(10_000)
    .emitWithAck('subscribe', { room })
    .catch((error) => ({ ok: false, error: String(error) }));
  if (!ack?.ok) {
    failures.push(`subscribe: ${ack?.error}`);
    return;
  }
  connectTimes.push(performance.now() - started);
  socket.on('match:live', (envelope) => {
    if (!recording) return;
    const key = envelope?.seq ?? 'unknown';
    if (!deliveries.has(key)) deliveries.set(key, []);
    deliveries.get(key).push(performance.now());
  });
}

console.log(`Connecting ${CLIENTS} clients to ${room} on ${API} …`);
const batch = 100; // open connections in waves, like real arrivals
for (let i = 0; i < CLIENTS; i += batch) {
  await Promise.all(
    Array.from({ length: Math.min(batch, CLIENTS - i) }, connect),
  );
}
console.log(
  `Connected ${connectTimes.length}/${CLIENTS}; listening ${SECONDS}s …`,
);
recording = true;
await new Promise((resolve) => setTimeout(resolve, SECONDS * 1000));

const complete = [...deliveries.values()].filter(
  (times) => times.length >= connectTimes.length * 0.99,
);
const spreads = complete.map(
  (times) => Math.max(...times) - Math.min(...times),
);
const reach = [...deliveries.values()].map(
  (times) => times.length / Math.max(1, connectTimes.length),
);
console.log(
  JSON.stringify(
    {
      clients: CLIENTS,
      connected: connectTimes.length,
      failures: failures.length,
      connect_ms: {
        p50: Math.round(percentile(connectTimes, 50)),
        p95: Math.round(percentile(connectTimes, 95)),
      },
      broadcasts: deliveries.size,
      min_reach: Number(Math.min(...reach).toFixed(3)),
      fanout_spread_ms: {
        p50: Math.round(percentile(spreads, 50)),
        p95: Math.round(percentile(spreads, 95)),
        max: Math.round(Math.max(...spreads)),
      },
    },
    null,
    2,
  ),
);
for (const socket of sockets) socket.close();
process.exit(failures.length > 0 || connectTimes.length < CLIENTS ? 1 : 0);
