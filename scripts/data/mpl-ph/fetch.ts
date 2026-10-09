/**
 * Fetches one week of MPL Philippines public match data into data-cache/.
 *
 *   npm run data:fetch -- --week 8 [--refresh]
 *
 * Polite by design: only paths ph-mpl.com/robots.txt allows (/schedule,
 * /teams, /data/...), one request at a time with a pause between them, and
 * cached pages are never fetched again unless --refresh is given. The parsed,
 * reviewed result is committed (prisma/data/), so nothing else hits the site.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  dataSlugOf,
  isFinished,
  latestFinishedWith,
  parseSchedule,
} from './parse';

const BASE = 'https://ph-mpl.com';
const REFERENCE_BASE = 'https://arena.rone.dev';
const ALLOWED = ['/schedule', '/teams', '/data/'];
const PAUSE_MS = 1_500;
const USER_AGENT =
  'THUMBZ portfolio data import (one-off, non-commercial; respects robots.txt)';

const args = process.argv.slice(2);
const week = Number(args[args.indexOf('--week') + 1] || 8);
const refresh = args.includes('--refresh');
export const CACHE_DIR = join(process.cwd(), 'data-cache', 'mpl-ph');

let lastRequest = 0;
const cookies = new Map<string, string>();

async function polite<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastRequest + PAUSE_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequest = Date.now();
  return fn();
}

function assertAllowed(path: string): void {
  if (!ALLOWED.some((prefix) => path.startsWith(prefix))) {
    throw new Error(`${path} is not allowed by robots.txt`);
  }
}

function keepCookies(response: Response): void {
  for (const line of response.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const index = pair.indexOf('=');
    cookies.set(pair.slice(0, index), pair.slice(index + 1));
  }
}

const cookieHeader = () =>
  [...cookies].map(([name, value]) => `${name}=${value}`).join('; ');

async function get(
  path: string,
  file: string,
  force = refresh,
): Promise<string> {
  const target = join(CACHE_DIR, file);
  if (!force && existsSync(target)) return readFileSync(target, 'utf8');
  assertAllowed(path);
  const response = await polite(() =>
    fetch(`${BASE}${path}`, {
      headers: { 'User-Agent': USER_AGENT, Cookie: cookieHeader() },
    }),
  );
  if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
  keepCookies(response);
  const body = await response.text();
  writeFileSync(target, body);
  console.log(`fetched ${path} (${Math.round(body.length / 1024)} KB)`);
  return body;
}

/** The page's own loader: POST with its CSRF token, as a browser does. */
async function itemization(
  matchName: string,
  battleId: string,
  token: string,
  file: string,
): Promise<void> {
  const target = join(CACHE_DIR, file);
  const path = '/data/match-data/itemization';
  assertAllowed(path);
  const response = await polite(() =>
    fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: {
        'User-Agent': USER_AGENT,
        Cookie: cookieHeader(),
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: new URLSearchParams({ _token: token, battleId, matchName }),
    }),
  );
  if (!response.ok) throw new Error(`POST itemization -> ${response.status}`);
  const body = (await response.json()) as { data?: string };
  if (!body.data) throw new Error(`empty itemization for ${matchName}`);
  writeFileSync(target, body.data);
  console.log(`fetched itemization ${matchName} ${battleId}`);
}

async function main(): Promise<void> {
  mkdirSync(CACHE_DIR, { recursive: true });
  // Always fresh: scores and status change; everything else stays cached.
  const schedule = await get('/schedule', 'schedule.html', true);
  await get('/teams', 'teams.html');

  const matches = parseSchedule(schedule, week);
  console.log(`week ${week}: ${matches.length} matches`);
  const battlesOf = (page: string) =>
    [...page.matchAll(/loadItemSequence\('(\d+)',\s*'(\d+)'\)/g)].map(
      ([, game, battle]) => ({ game: Number(game), battle }),
    );
  const itemFile = (slug: string, game: number) =>
    `items-${slug}-g${game}.html`;

  const today = Date.now();
  for (const match of matches) {
    // Only finished series: one in progress already has a data page and a
    // running score, but no item sequence for the game being played. The
    // schedule can lag behind the data pages, so a match already played that
    // it has not scored yet is tried at its usual slug; the build accepts it
    // only if its games make a decided series.
    const alreadyPlayed =
      Date.parse(`${match.date.replace(/^\w+, /, '')} UTC`) <= today;
    const slug = isFinished(match)
      ? match.dataSlug
      : alreadyPlayed && !match.dataSlug
        ? dataSlugOf(match)
        : null;
    if (!slug) continue;
    const pageFile = join(CACHE_DIR, `match-${slug}.html`);
    const cachedBattles = existsSync(pageFile)
      ? battlesOf(readFileSync(pageFile, 'utf8'))
      : [];
    if (
      !refresh &&
      // An unscored series may still be running: always look again.
      isFinished(match) &&
      cachedBattles.length > 0 &&
      cachedBattles.every(({ game }) =>
        existsSync(join(CACHE_DIR, itemFile(slug, game))),
      )
    ) {
      continue; // fully cached
    }
    // A fresh page load gives the session + CSRF token its item loader needs.
    cookies.clear();
    let page: string;
    try {
      page = await get(`/data/match/${slug}`, `match-${slug}.html`, true);
    } catch (error) {
      console.warn(`no data page for ${slug} yet (${String(error)})`);
      continue;
    }
    const token = /_token:\s*"([^"]+)"/.exec(page)?.[1];
    const battles = battlesOf(page);
    if (!token || battles.length === 0) {
      console.warn(`no item sequence on ${slug}`);
      continue;
    }
    for (const { game, battle } of battles) {
      await itemization(slug, battle, token, itemFile(slug, game));
    }
  }
  // Rosters: a team without a finished match this week (it only plays later)
  // gets its players from its latest finished match before this week: the
  // match page only, for names and heroes, no item sequence.
  const played = new Set(
    matches.filter(isFinished).flatMap((match) => match.teams),
  );
  for (const team of new Set(matches.flatMap((match) => match.teams))) {
    if (played.has(team)) continue;
    const earlier = latestFinishedWith(schedule, team, week);
    if (!earlier?.dataSlug) {
      console.warn(`no earlier match for ${team}`);
      continue;
    }
    await get(
      `/data/match/${earlier.dataSlug}`,
      `roster-${earlier.dataSlug}.html`,
    );
  }

  // Reference data (names for item/emblem/talent ids, hero lanes): Moonton's
  // official MLBB Academy data through the public arena.rone.dev proxy.
  for (const [path, file] of [
    [
      '/api/academy/equipment/expanded?size=300&index=1',
      'academy-equipment.json',
    ],
    ['/api/academy/emblems?size=100&index=1', 'academy-emblems.json'],
    ['/api/academy/heroes/catalog?size=300&index=1', 'academy-heroes.json'],
  ] as const) {
    const target = join(CACHE_DIR, file);
    if (!refresh && existsSync(target)) continue;
    const response = await polite(() =>
      fetch(`${REFERENCE_BASE}${path}`, {
        headers: { 'User-Agent': USER_AGENT },
      }),
    );
    if (!response.ok) throw new Error(`GET ${path} -> ${response.status}`);
    writeFileSync(target, await response.text());
    console.log(`fetched reference ${file}`);
  }
  console.log(`cache: ${CACHE_DIR}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
