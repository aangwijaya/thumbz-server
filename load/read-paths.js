/**
 * k6 load test for the public read paths (the traffic a match day brings).
 *
 *   docker run --rm -i --add-host=host.docker.internal:host-gateway \
 *     -e BASE_URL=http://host.docker.internal:3001 grafana/k6:1.3.0 run - < load/read-paths.js
 *
 * VUS / DURATION env vars scale it. Reads are never rate limited (only writes
 * are), so one load generator is enough.
 */
import http from 'k6/http';
import { check, group } from 'k6';

const BASE = `${__ENV.BASE_URL || 'http://localhost:3001'}/api/v1`;

export const options = {
  scenarios: {
    match_day: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '20s', target: Number(__ENV.VUS || 100) },
        { duration: __ENV.DURATION || '1m', target: Number(__ENV.VUS || 100) },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // Cached reads (Redis cache-aside + HTTP cache headers).
    'http_req_duration{group:::home}': ['p(95)<250'],
    'http_req_duration{group:::match list}': ['p(95)<250'],
    'http_req_duration{group:::match detail}': ['p(95)<250'],
    'http_req_duration{group:::search}': ['p(95)<400'],
    'http_req_duration{group:::replays}': ['p(95)<250'],
  },
};

export function setup() {
  const list = http.get(`${BASE}/matches?pageSize=50`).json('data') || [];
  const live = http.get(`${BASE}/matches/live`).json('data') || [];
  return { ids: [...live, ...list].map((match) => match.id) };
}

const QUERIES = ['onic', 'rrq', 'evos', 'mpl', 'kairi', 'onik', 'bigetron', 'falcons'];
const pick = (items) => items[Math.floor(Math.random() * items.length)];

export default function ({ ids }) {
  const roll = Math.random();
  if (roll < 0.3) {
    group('home', () => check(http.get(`${BASE}/home`), { '200': (r) => r.status === 200 }));
  } else if (roll < 0.5) {
    group('match list', () =>
      check(http.get(`${BASE}/matches?status=completed&page=${1 + Math.floor(Math.random() * 4)}`), { '200': (r) => r.status === 200 }),
    );
  } else if (roll < 0.75) {
    group('match detail', () => {
      const id = pick(ids);
      const responses = http.batch([
        ['GET', `${BASE}/matches/${id}`],
        ['GET', `${BASE}/matches/${id}/live-stats`],
        ['GET', `${BASE}/matches/${id}/events`],
      ]);
      check(responses[0], { '200': (r) => r.status === 200 });
    });
  } else if (roll < 0.88) {
    group('search', () => check(http.get(`${BASE}/search?q=${pick(QUERIES)}`), { '200': (r) => r.status === 200 }));
  } else {
    group('replays', () => check(http.get(`${BASE}/videos?pageSize=12`), { '200': (r) => r.status === 200 }));
  }
}
