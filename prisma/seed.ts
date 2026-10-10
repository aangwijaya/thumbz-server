import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  eventOf,
  finalStatistics,
  GameScript,
  RecordedAsset,
  Recording,
  recordingAt,
  timelineOf,
} from '../src/modules/simulator/replay';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Demo dataset: one real week of MPL Philippines Season 18 (week 8), from
// prisma/data/ (built by scripts/data/mpl-ph; see its README section).
// Rosters, heroes, builds, emblems, talents, item sequences and scores are
// real; only the calendar is shifted around "now":
//   - the week's first day      → completed replays, yesterday;
//   - its second day            → live: recorded games replayed by the worker
//                                  (LIVE_SIMULATOR=true), looping forever;
//   - its last day              → upcoming tomorrow, the only ones with tickets.
// The same week is seeded a second time as MPL Indonesia demo data (teams and
// rosters swapped, see indonesiaFrom()).
// Re-running the seed replaces all catalog data (tournaments, teams, players,
// matches, videos); user accounts, favorites of other things and registered
// media assets are kept.
// ---------------------------------------------------------------------------

const DATA_DIR = join(__dirname, 'data');
const SEED_STREAM_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
const SEED_LIVE_THUMB =
  'https://qshjcszsvsgwpcgggkiv.supabase.co/storage/v1/object/public/media/match-thumbs/mpl-philippines.jpg';
const seedImage = (seed: string, width = 640, height = 360): string =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;

/** Manila time (UTC+8): the league's calendar. */
const PH_OFFSET_MS = 8 * 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
/** Break between games of a series in the replays. */
const BETWEEN_GAMES_MS = 10 * MINUTE;
/** Live series start at staggered points of game 1 (minutes ago). */
const LIVE_OFFSETS_MIN = [2, 13, 6];
const LIVE_VIEWERS = [6_400, 9_100, 18_300];

const TEAM_COLORS: Record<string, [string, string]> = {
  APBR: ['#D7141A', '#111111'],
  FLCN: ['#00A651', '#0B0B0B'],
  OMG: ['#C8102E', '#1A1A1A'],
  ONIC: ['#FFD100', '#111111'],
  RORA: ['#6C2BD9', '#F2F2F2'],
  TLPH: ['#0C223F', '#3FB6E8'],
  TNC: ['#E10600', '#FFFFFF'],
  TWIS: ['#6E2C8F', '#F5A623'],
};

// ---- dataset types (prisma/data/mpl-ph-s18-w8.json) ----
interface DataPlayerLine {
  nickname: string;
  hero: string;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  hero_damage: number;
  damage_taken: number;
  tower_damage: number;
  items: string[];
  emblem: string | null;
  talents: string[];
  purchases: Array<{ item: string; tier: number | null; second: number }>;
}
interface DataSide {
  team: string;
  totals: {
    kills: number;
    deaths: number;
    assists: number;
    gold: number;
    goldPerMinute: number;
    damage: number;
    redBuffs: number;
    blueBuffs: number;
    lords: number;
    turtles: number;
    towers: number;
  };
  players: DataPlayerLine[];
}
interface DataGame {
  game_number: number;
  duration_seconds: number;
  winner: string;
  sides: DataSide[];
}
interface DataMatch {
  date: string;
  time: string;
  teams: [string, string];
  status: 'finished' | 'upcoming';
  score: [number, number] | null;
  data_slug: string | null;
  games: DataGame[];
}
interface Dataset {
  source: string;
  league: string;
  season: number;
  week: number;
  teams: Array<{ code: string; name: string; logo_url: string }>;
  players: Array<{
    nickname: string;
    team: string;
    role: 'gold' | 'mid' | 'exp' | 'jungle' | 'roam' | 'flex';
    heroes: string[];
  }>;
  matches: DataMatch[];
}
interface Catalog {
  items: Record<string, { name: string; icon_url: string | null }>;
  emblems: Record<string, { name: string; icon_url: string | null }>;
  talents: Record<string, { name: string; icon_url: string | null }>;
  heroes: Record<string, { icon_url: string | null; lanes: string[] }>;
}

const readJson = <T>(file: string): T =>
  JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8')) as T;

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

// ---- leagues ----
interface League {
  slug: string;
  /** Short label used in video titles. */
  short: string;
  region: string;
  country: string;
  /** Prefix that keeps player slugs unique across leagues. */
  playerSlugPrefix: string;
  /** Tournament start, in days from today; it runs 90 days. */
  startDay: number;
  prizePool: string | null;
  description: string;
  colors: Record<string, [string, string]>;
  /** Moves the league's calendar (and its live start times) in time. */
  shiftMs: number;
  liveOffsetsMin: number[];
  liveViewers: number[];
  liveThumb: string;
  broadcasts: Array<{ language: 'en' | 'id' | 'tl'; share: number }>;
  venue: { name: string; city: string };
}

const PH: League = {
  slug: 'mpl-ph-s18',
  short: 'MPL PH',
  region: 'Philippines',
  country: 'PH',
  playerSlugPrefix: '',
  startDay: -50,
  prizePool: null,
  description:
    'Regular season, week 8. Real match data from ph-mpl.com: rosters, heroes, builds, emblems, talents and item sequences.',
  colors: TEAM_COLORS,
  shiftMs: 0,
  liveOffsetsMin: LIVE_OFFSETS_MIN,
  liveViewers: LIVE_VIEWERS,
  liveThumb: SEED_LIVE_THUMB,
  broadcasts: [
    { language: 'en', share: 0.35 },
    { language: 'tl', share: 0.65 },
  ],
  venue: { name: 'Studio MPL PH, Shangri-La Plaza', city: 'Mandaluyong' },
};

// MPL Indonesia is demo data: the MPL PH week replayed with Indonesian teams
// and rosters (team code → team; each player takes the role of the PH player
// in the same seat). Starts a week earlier, so MPL PH stays the default
// tournament, and an hour earlier, so MPL PH keeps the global featured match.
const ID_LOGO = (file: string) =>
  `https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/${file}`;
const ID_TEAMS: Record<
  string,
  {
    code: string;
    name: string;
    logo: string;
    colors: [string, string];
    roster: Record<'gold' | 'mid' | 'exp' | 'jungle' | 'roam', string>;
  }
> = {
  ONIC: {
    code: 'ONIC',
    name: 'ONIC Esports',
    logo: ID_LOGO('onic-b-256.png'),
    colors: ['#F5C518', '#0A0A0A'],
    roster: {
      gold: 'Alberttt',
      mid: 'Sanz',
      exp: 'CW',
      jungle: 'Kairi',
      roam: 'Kiboy',
    },
  },
  APBR: {
    code: 'RRQ',
    name: 'RRQ Hoshi',
    logo: ID_LOGO('rrq-500.png'),
    colors: ['#F28C00', '#111111'],
    roster: {
      gold: 'Skylar',
      mid: 'Clayyy',
      exp: 'Brusko',
      jungle: 'Ferxiic',
      roam: 'Said',
    },
  },
  FLCN: {
    code: 'EVOS',
    name: 'EVOS Legends',
    logo: ID_LOGO('evos-500.png'),
    colors: ['#1E90FF', '#FFFFFF'],
    roster: {
      gold: 'Branz',
      mid: 'Clover',
      exp: 'Fluffy',
      jungle: 'Tazz',
      roam: 'Muezza',
    },
  },
  OMG: {
    code: 'BTR',
    name: 'Bigetron by Vitality',
    logo: ID_LOGO('btr_vit.png'),
    colors: ['#E53935', '#111111'],
    roster: {
      gold: 'Kzy',
      mid: 'Xinnn',
      exp: 'Moreno',
      jungle: 'Saken',
      roam: 'Finn',
    },
  },
  TLPH: {
    code: 'TLID',
    name: 'Team Liquid ID',
    logo: ID_LOGO('TLID-Primary500x500.png'),
    colors: ['#0C223F', '#00A9E0'],
    roster: {
      gold: 'AriZ',
      mid: 'Ciku',
      exp: 'Ridd',
      jungle: 'Faviannn',
      roam: 'lyoni',
    },
  },
  RORA: {
    code: 'AE',
    name: 'Alter Ego',
    logo: ID_LOGO('ae-256.png'),
    colors: ['#E91E63', '#111111'],
    roster: {
      gold: 'Damar',
      mid: 'Reza',
      exp: 'Fitra',
      jungle: 'Bagus',
      roam: 'ALEXANDER',
    },
  },
  TNC: {
    code: 'DEWA',
    name: 'Dewa United Esports',
    logo: ID_LOGO('dewa-united-500.png'),
    colors: ['#16A34A', '#F2F2F2'],
    roster: {
      gold: 'Nanda',
      mid: 'Rizky',
      exp: 'Gilang',
      jungle: 'Bayu',
      roam: 'Shane',
    },
  },
  TWIS: {
    code: 'GEEK',
    name: 'Geek Fam ID',
    logo: ID_LOGO('geek-500.png'),
    colors: ['#F59E0B', '#111111'],
    roster: {
      gold: 'Kevin',
      mid: 'Agung',
      exp: 'Farhan',
      jungle: 'Dimas',
      roam: 'Frenzy',
    },
  },
};
/** In the league's teams but not in this week's matches. */
const ID_EXTRA_TEAMS = [
  {
    code: 'NAVI',
    name: 'NAVI',
    logo: ID_LOGO('NAVI-2.png'),
    colors: ['#FDD835', '#0A0A0A'] as [string, string],
    roster: {
      gold: 'Andri',
      mid: 'Fajar',
      exp: 'Rivaldo',
      jungle: 'Ihsan',
      roam: 'Aprho',
    },
  },
];

const ID: League = {
  slug: 'mpl-id-s18',
  short: 'MPL ID',
  region: 'Indonesia',
  country: 'ID',
  playerSlugPrefix: 'id-',
  startDay: -57,
  prizePool: '500,000 USD',
  description:
    'Regular season, week 8. Demo data: the MPL PH S18 week 8 games replayed with MPL Indonesia teams and rosters.',
  colors: Object.fromEntries(
    [...Object.values(ID_TEAMS), ...ID_EXTRA_TEAMS].map((team) => [
      team.code,
      team.colors,
    ]),
  ),
  shiftMs: -60 * MINUTE,
  liveOffsetsMin: [9, 4, 16],
  liveViewers: [8_200, 12_400, 24_600],
  liveThumb:
    'https://qshjcszsvsgwpcgggkiv.supabase.co/storage/v1/object/public/media/match-thumbs/mpl-indonesia.jpg',
  broadcasts: [
    { language: 'en', share: 0.35 },
    { language: 'id', share: 0.65 },
  ],
  venue: { name: 'Mahaka Square', city: 'Jakarta' },
};

/** The MPL PH dataset with every team and player swapped for its MPL ID seat. */
function indonesiaFrom(ph: Dataset): Dataset {
  const team = (code: string) => {
    const mapped = ID_TEAMS[code];
    if (!mapped) throw new Error(`no MPL ID team for ${code}`);
    return mapped;
  };
  const roleOf = new Map(
    ph.players.map((p) => [`${p.team}:${p.nickname}`, p.role]),
  );
  const nickname = (code: string, phNickname: string): string => {
    const role = roleOf.get(`${code}:${phNickname}`);
    if (!role || role === 'flex') {
      throw new Error(`no role for ${code} ${phNickname}`);
    }
    return team(code).roster[role];
  };
  const extra = ID_EXTRA_TEAMS.map((t) => ({ ...t, phCode: null }));
  return {
    ...ph,
    league: 'MPL Indonesia',
    source: `${ph.source} (rosters swapped for MPL Indonesia demo data)`,
    teams: [
      ...ph.teams.map((t) => ({
        code: team(t.code).code,
        name: team(t.code).name,
        logo_url: team(t.code).logo,
      })),
      ...extra.map((t) => ({ code: t.code, name: t.name, logo_url: t.logo })),
    ],
    players: [
      ...ph.players.map((p) => ({
        ...p,
        team: team(p.team).code,
        nickname: nickname(p.team, p.nickname),
      })),
      ...extra.flatMap((t) =>
        Object.entries(t.roster).map(([role, nick]) => ({
          nickname: nick,
          team: t.code,
          role: role as Dataset['players'][number]['role'],
          heroes: [],
        })),
      ),
    ],
    matches: ph.matches.map((m) => ({
      ...m,
      teams: [team(m.teams[0]).code, team(m.teams[1]).code],
      data_slug: m.data_slug ? `id-${m.data_slug}` : null,
      games: m.games.map((g) => ({
        ...g,
        winner: team(g.winner).code,
        sides: g.sides.map((side) => ({
          ...side,
          team: team(side.team).code,
          players: side.players.map((p) => ({
            ...p,
            nickname: nickname(side.team, p.nickname),
          })),
        })),
      })),
    })),
  };
}

/** Both leagues must fit side by side before anything is deleted. */
function assertLeaguesFit(leagues: Array<[League, Dataset]>): void {
  const teamSlugs = new Set<string>();
  const playerSlugs = new Set<string>();
  for (const [league, data] of leagues) {
    for (const team of data.teams) {
      const slug = slugify(team.name);
      if (teamSlugs.has(slug)) throw new Error(`duplicate team slug ${slug}`);
      teamSlugs.add(slug);
    }
    for (const player of data.players) {
      const slug = slugify(
        `${league.playerSlugPrefix}${player.team}-${player.nickname}`,
      );
      if (playerSlugs.has(slug)) {
        throw new Error(`duplicate player slug ${slug}`);
      }
      playerSlugs.add(slug);
    }
  }
}

/** "Thursday, 8 October 2026" → sortable day key. */
const dayKey = (date: string): number => Date.parse(date.replace(/^\w+, /, ''));

/** A day relative to today (Manila) at a "5:00 PM" Manila time, as UTC. */
function manila(dayOffset: number, time: string): Date {
  const today = new Date(Date.now() + PH_OFFSET_MS);
  today.setUTCHours(0, 0, 0, 0);
  const [, h, m, ampm] = /(\d+):(\d+)\s*(AM|PM)/i.exec(time) ?? [];
  const hours = (Number(h) % 12) + (ampm?.toUpperCase() === 'PM' ? 12 : 0);
  return new Date(
    today.getTime() +
      dayOffset * DAY +
      hours * 3_600_000 +
      Number(m ?? 0) * MINUTE -
      PH_OFFSET_MS,
  );
}

/** Local-only by default: the seed deletes every match, team and player. */
function assertSafeTarget(): void {
  const url = process.env.DATABASE_URL ?? '';
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const local = ['localhost', '127.0.0.1', 'postgres', 'db'].includes(host);
  if (!local && process.env.SEED_REMOTE !== 'replace-catalog') {
    throw new Error(
      `Refusing to seed ${host || 'an unknown host'}: the seed replaces all catalog data. ` +
        'Set SEED_REMOTE=replace-catalog to seed a remote database on purpose.',
    );
  }
}

/** One league: tournament, teams, players, matches (replays, live, upcoming) and replay videos. */
async function seedLeague(
  league: League,
  data: Dataset,
  catalog: Catalog,
): Promise<{
  live: string[];
  counts: Record<string, number>;
}> {
  // ---- tournament, teams, players ----
  const days = [...new Set(data.matches.map((m) => dayKey(m.date)))].sort(
    (a, b) => a - b,
  );
  const tournament = await prisma.tournament.create({
    data: {
      slug: league.slug,
      name: `${data.league} Season ${data.season}`,
      status: 'ongoing',
      region: league.region,
      start_date: new Date(manila(league.startDay, '12:00 AM')),
      end_date: new Date(manila(league.startDay + 90, '12:00 AM')),
      prize_pool: league.prizePool,
      featured: true,
      description: league.description,
      logo_url: null,
    },
  });

  const teamIds = new Map<string, string>();
  const teamNames: Record<string, string> = {};
  for (const team of data.teams) {
    const [primary, secondary] = league.colors[team.code] ?? [
      '#444444',
      '#DDDDDD',
    ];
    const row = await prisma.team.create({
      data: {
        slug: slugify(team.name),
        name: team.name,
        short_name: team.code,
        region: league.region,
        color_primary: primary,
        color_secondary: secondary,
        description: `${team.name} — ${data.league} Season ${data.season}.`,
        logo_url: team.logo_url,
      },
    });
    teamIds.set(team.code, row.id);
    teamNames[row.id] = team.name;
  }
  const teamId = (code: string): string => {
    const id = teamIds.get(code);
    if (!id) throw new Error(`unknown team ${code}`);
    return id;
  };

  const playerIds = new Map<string, string>();
  const nicknames: Record<string, string> = {};
  for (const player of data.players) {
    const row = await prisma.player.create({
      data: {
        slug: slugify(
          `${league.playerSlugPrefix}${player.team}-${player.nickname}`,
        ),
        nickname: player.nickname,
        role: player.role,
        country: league.country,
        team_id: teamId(player.team),
        photo_url: null,
      },
    });
    playerIds.set(`${player.team}:${player.nickname}`, row.id);
    nicknames[row.id] = player.nickname;
  }
  const playerId = (team: string, nickname: string): string => {
    const id = playerIds.get(`${team}:${nickname}`);
    if (!id) throw new Error(`unknown player ${team} ${nickname}`);
    return id;
  };

  // ---- recordings from the real games ----
  const asset = (
    table: Record<string, { name: string; icon_url: string | null }>,
    id: string,
    fallback: string,
  ): RecordedAsset => ({
    id,
    name: table[id]?.name ?? `${fallback} ${id}`,
    icon_url: table[id]?.icon_url ?? null,
  });
  const recordingOf = (matchId: string, game: DataGame): Recording => {
    const script: GameScript = {
      players: game.sides.flatMap((side) =>
        side.players.map((p) => ({
          player_id: playerId(side.team, p.nickname),
          team_id: teamId(side.team),
          hero: p.hero,
          hero_icon_url: catalog.heroes[p.hero]?.icon_url ?? null,
          kills: p.kills,
          deaths: p.deaths,
          assists: p.assists,
          gold: p.gold,
          damage: p.hero_damage,
          damage_taken: p.damage_taken,
          tower_damage: p.tower_damage,
          emblem: p.emblem ? asset(catalog.emblems, p.emblem, 'Emblem') : null,
          talents: p.talents.map((id) => asset(catalog.talents, id, 'Talent')),
          items: p.items.map((id) => asset(catalog.items, id, 'Item')),
          purchases: p.purchases.map((purchase) => {
            const item = asset(catalog.items, purchase.item, 'Item');
            return {
              item_id: item.id,
              item_name: item.name,
              icon_url: item.icon_url,
              tier: purchase.tier,
              second: purchase.second,
            };
          }),
        })),
      ),
      teams: game.sides.map((side) => ({
        team_id: teamId(side.team),
        kills: side.totals.kills,
        deaths: side.totals.deaths,
        assists: side.totals.assists,
        gold: side.totals.gold,
        towers: side.totals.towers,
        lords: side.totals.lords,
        turtles: side.totals.turtles,
        details: {
          red_buffs: side.totals.redBuffs,
          blue_buffs: side.totals.blueBuffs,
          gold_per_minute: side.totals.goldPerMinute,
          damage: side.totals.damage,
        },
      })),
    };
    return {
      match_id: matchId,
      game_number: game.game_number,
      duration_seconds: game.duration_seconds,
      winner_team_id: teamId(game.winner),
      script,
    };
  };

  /** A finished game as the API stores it: stats, sequence, feed, gold. */
  async function storeGame(recording: Recording, startedAt: Date) {
    const start = startedAt.getTime();
    const at = (second: number) => new Date(start + second * 1000);
    const game_number = recording.game_number;
    const match_id = recording.match_id;
    const end = at(recording.duration_seconds);

    await prisma.matchGame.create({
      data: {
        match_id,
        game_number,
        status: 'completed',
        winner_team_id: recording.winner_team_id,
        started_at: startedAt,
        ended_at: end,
        duration_seconds: recording.duration_seconds,
      },
    });
    const stats = finalStatistics(recording);
    await prisma.matchTeamStatistic.createMany({
      data: stats.teams.map((team) => ({
        match_id,
        game_number,
        ...team,
        details: json(team.details),
      })),
    });
    await prisma.playerMatchStatistic.createMany({
      data: stats.players.map((p) => ({
        match_id,
        game_number,
        ...p,
        emblem: p.emblem ? json(p.emblem) : Prisma.DbNull,
        talents: json(p.talents),
        items: json(p.items),
        details: {},
      })),
    });
    await prisma.matchItemEvent.createMany({
      data: recording.script.players.flatMap((p) =>
        p.purchases.map((purchase) => ({
          match_id,
          game_number,
          player_id: p.player_id,
          team_id: p.team_id,
          item_id: purchase.item_id,
          item_name: purchase.item_name,
          icon_url: purchase.icon_url,
          tier: purchase.tier,
          phase:
            purchase.tier === 3 ? ('phase3' as const) : ('phase2' as const),
          purchased_at: at(purchase.second),
        })),
      ),
      skipDuplicates: true,
    });
    const timeline = timelineOf(recording);
    const firstKill = timeline.find((m) => m.kind === 'kill');
    await prisma.matchEvent.createMany({
      data: timeline.flatMap((moment) => {
        const event = eventOf(
          moment,
          recording,
          { teams: teamNames, players: nicknames },
          firstKill,
        );
        return event
          ? [
              {
                match_id,
                game_number,
                ...event,
                details: { reconstructed: true },
                occurred_at: at(moment.second),
              },
            ]
          : [];
      }),
    });
    const gold = [];
    for (let t = 0; ; t = Math.min(t + 60, recording.duration_seconds)) {
      const state = recordingAt(recording, timeline, t);
      for (const [team_id, value] of Object.entries(state.gold)) {
        gold.push({
          match_id,
          game_number,
          team_id,
          gold: value,
          recorded_at: at(t),
        });
      }
      if (t === recording.duration_seconds) {
        await prisma.playerMatchSnapshot.createMany({
          data: state.players.map((p) => ({
            match_id,
            game_number,
            player_id: p.player_id,
            team_id: p.team_id,
            kills: p.kills,
            deaths: p.deaths,
            assists: p.assists,
            gold: p.gold,
            damage: p.damage,
            damage_taken: p.damage_taken,
            level: p.level,
            hero: p.hero,
            hero_icon_url: p.hero_icon_url,
            recorded_at: end,
          })),
        });
        break;
      }
    }
    await prisma.matchGoldSnapshot.createMany({ data: gold });
    return end;
  }

  // ---- matches ----
  const roleOf = (match: DataMatch) => {
    const index = days.indexOf(dayKey(match.date));
    if (index === 0) return 'replay';
    if (index === days.length - 1) return 'upcoming';
    return 'live';
  };
  const replays: Array<{
    id: string;
    games: DataGame[];
    recordings: Recording[];
  }> = [];
  const live: string[] = [];
  const upcoming: string[] = [];
  const liveCandidates = data.matches.filter(
    (m) => roleOf(m) === 'live' && m.games.length > 0,
  );
  // The hero section features the longest live series, the latest on ties.
  const featured = [...liveCandidates].sort(
    (a, b) =>
      b.games.length - a.games.length ||
      data.matches.indexOf(b) - data.matches.indexOf(a),
  )[0];

  for (const match of data.matches) {
    let role = roleOf(match);
    if (role !== 'upcoming' && match.games.length === 0) {
      // Not played yet when the data was fetched: sells tickets instead.
      console.warn(
        `${match.teams.join(' vs ')} has no game data; seeded as upcoming`,
      );
      role = 'upcoming';
    }
    const [a, b] = match.teams.map(teamId);
    const base = {
      tournament_id: tournament.id,
      team_a_id: a,
      team_b_id: b,
      stage: 'regular_season' as const,
      best_of: 3,
    };

    if (role === 'replay') {
      const scheduled = new Date(
        manila(-1, match.time).getTime() + league.shiftMs,
      );
      const winner =
        match.games.filter((g) => g.winner === match.teams[0]).length >= 2
          ? a
          : b;
      const row = await prisma.match.create({
        data: {
          ...base,
          status: 'completed',
          score_a: match.score?.[0] ?? 0,
          score_b: match.score?.[1] ?? 0,
          winner_team_id: winner,
          scheduled_at: scheduled,
          started_at: new Date(scheduled.getTime() + 5 * MINUTE),
          thumbnail_url: seedImage(`match-${match.data_slug}`),
        },
      });
      let start = new Date(scheduled.getTime() + 5 * MINUTE);
      const recordings: Recording[] = [];
      for (const game of match.games) {
        const recording = recordingOf(row.id, game);
        recordings.push(recording);
        const end = await storeGame(recording, start);
        start = new Date(end.getTime() + BETWEEN_GAMES_MS);
      }
      await prisma.match.update({
        where: { id: row.id },
        data: {
          ended_at: new Date(start.getTime() - BETWEEN_GAMES_MS),
          game_number: null,
        },
      });
      replays.push({ id: row.id, games: match.games, recordings });
    } else if (role === 'live') {
      const slot = live.length;
      const offset =
        (league.liveOffsetsMin[slot % league.liveOffsetsMin.length] ?? 5) *
        MINUTE;
      const startedAt = new Date(Date.now() - offset);
      const isFeatured = match === featured;
      const viewers = isFeatured
        ? league.liveViewers[2]
        : league.liveViewers[slot % 2];
      const row = await prisma.match.create({
        data: {
          ...base,
          status: 'live',
          score_a: 0,
          score_b: 0,
          game_number: 1,
          // The broadcast went on air a while ago (the series loops); e2e
          // fixtures that start "now" rank as the latest live matches.
          scheduled_at: new Date(Date.now() - 2 * 60 * MINUTE + league.shiftMs),
          started_at: new Date(Date.now() - 115 * MINUTE + league.shiftMs),
          featured: isFeatured,
          viewer_count: viewers,
          stream_url: SEED_STREAM_URL,
          thumbnail_url: league.liveThumb,
        },
      });
      await prisma.matchGameRecording.createMany({
        data: match.games.map((game) => {
          const recording = recordingOf(row.id, game);
          return {
            match_id: row.id,
            game_number: recording.game_number,
            duration_seconds: recording.duration_seconds,
            winner_team_id: recording.winner_team_id,
            script: json(recording.script),
          };
        }),
      });
      // Game 1 is under way; the worker fills in what happened so far.
      await prisma.matchGame.create({
        data: {
          match_id: row.id,
          game_number: 1,
          status: 'live',
          started_at: startedAt,
        },
      });
      await prisma.matchBroadcast.createMany({
        data: league.broadcasts.map((feed) => ({
          match_id: row.id,
          language: feed.language,
          stream_url: SEED_STREAM_URL,
          viewer_count: Math.round(viewers * feed.share),
        })),
      });
      live.push(row.id);
    } else {
      const row = await prisma.match.create({
        data: {
          ...base,
          status: 'scheduled',
          scheduled_at: new Date(
            manila(1, match.time).getTime() + league.shiftMs,
          ),
          thumbnail_url: seedImage(`match-${match.teams.join('-')}`),
        },
      });
      await prisma.matchTicketConfig.create({
        data: {
          match_id: row.id,
          venue_name: league.venue.name,
          venue_city: league.venue.city,
          price_usd: 12,
          // An IDR price enables QRIS / bank VA next to crypto.
          price_idr: 190_000,
          quota_total: 1_200,
          is_active: true,
        },
      });
      upcoming.push(row.id);
    }
  }

  // ---- replay videos: one per game of the completed series ----
  let videoCount = 0;
  for (const replay of replays) {
    const match = await prisma.match.findUniqueOrThrow({
      where: { id: replay.id },
      include: { teamA: true, teamB: true, games: true },
    });
    for (const game of match.games.sort(
      (x, y) => x.game_number - y.game_number,
    )) {
      await prisma.video.create({
        data: {
          title: `${match.teamA.short_name} vs ${match.teamB.short_name} — Game ${game.game_number} | ${league.short} S${data.season} Week ${data.week}`,
          type: 'replay',
          url: SEED_STREAM_URL,
          thumbnail_url: seedImage(`video-${match.id}-${game.game_number}`),
          duration_seconds: game.duration_seconds,
          match_id: match.id,
          game_number: game.game_number,
          winning_team_id: game.winner_team_id,
          published_at: game.ended_at ?? new Date(),
        },
      });
      videoCount += 1;
    }
  }

  return {
    live,
    counts: {
      teams: data.teams.length,
      players: data.players.length,
      replays: replays.length,
      replayGames: replays.reduce((n, r) => n + r.games.length, 0),
      live: live.length,
      upcoming: upcoming.length,
      videos: videoCount,
    },
  };
}

async function main(): Promise<void> {
  assertSafeTarget();
  const data = readJson<Dataset>('mpl-ph-s18-w8.json');
  const catalog = readJson<Catalog>('mlbb-catalog.json');
  const idData = indonesiaFrom(data);
  assertLeaguesFit([
    [PH, data],
    [ID, idData],
  ]);
  console.log(
    `Seeding ${data.league} and ${idData.league} S${data.season} week ${data.week} (${data.source})...`,
  );

  // ---- replace the catalog ----
  const oldMatches = (
    await prisma.match.findMany({ select: { id: true } })
  ).map((m) => m.id);
  const oldEntities = [
    ...(await prisma.team.findMany({ select: { id: true } })),
    ...(await prisma.player.findMany({ select: { id: true } })),
    ...(await prisma.tournament.findMany({ select: { id: true } })),
  ].map((row) => row.id);
  // Demo purchases block match deletes (Restrict); payments cascade from orders.
  await prisma.ticket.deleteMany({ where: { match_id: { in: oldMatches } } });
  await prisma.ticketOrder.deleteMany({
    where: { match_id: { in: oldMatches } },
  });
  await prisma.video.deleteMany({}); // media assets survive (SET NULL)
  await prisma.favorite.deleteMany({
    where: { entity_id: { in: [...oldEntities, ...oldMatches] } },
  });
  await prisma.match.deleteMany({}); // games, stats, live data cascade
  await prisma.player.deleteMany({});
  await prisma.team.deleteMany({});
  await prisma.tournament.deleteMany({});

  const ph = await seedLeague(PH, data, catalog);
  const id = await seedLeague(ID, idData, catalog);
  const live = [...ph.live, ...id.live];

  // ---- admin profile ----
  const adminId =
    process.env.SEED_ADMIN_ID ?? '00000000-0000-4000-8000-000000000001';
  await prisma.profile.upsert({
    where: { id: adminId },
    update: { role: 'admin' },
    create: { id: adminId, role: 'admin', username: 'thumbz-admin' },
  });

  // ---- demo commenters + live chat ----
  const commenters = [
    { id: '00000000-0000-4000-8000-000000000201', username: 'raka' },
    { id: '00000000-0000-4000-8000-000000000202', username: 'adrian' },
    { id: '00000000-0000-4000-8000-000000000203', username: 'niko' },
    { id: '00000000-0000-4000-8000-000000000206', username: 'miguel' },
    { id: '00000000-0000-4000-8000-000000000207', username: 'sinta' },
    { id: '00000000-0000-4000-8000-000000000210', username: 'clara' },
    { id: '00000000-0000-4000-8000-000000000212', username: 'paolo' },
    { id: '00000000-0000-4000-8000-000000000213', username: 'bea' },
  ];
  for (const commenter of commenters) {
    await prisma.profile.upsert({
      where: { id: commenter.id },
      update: {},
      create: commenter,
    });
  }
  const chat = [
    ['miguel', 'Grabe yung rotation ngayon 🔥'],
    ['paolo', 'Lord fight incoming 👀'],
    ['bea', 'sana makabawi sa next game'],
    ['adrian', 'that turtle setup was clean'],
    ['clara', 'gold lead is getting big'],
    ['raka', 'watching from Jakarta, GG so far'],
    ['niko', 'draft looks strong this game'],
    ['sinta', 'comeback still possible!'],
  ] as const;
  const byName = new Map(commenters.map((c) => [c.username, c.id]));
  for (const [index, matchId] of live.entries()) {
    for (const [line, [author, body]] of chat.entries()) {
      if ((line + index) % 2 === 1 && line > 3) continue;
      await prisma.matchComment.create({
        data: {
          match_id: matchId,
          user_id: byName.get(author) ?? commenters[0].id,
          author_name: author[0].toUpperCase() + author.slice(1),
          body,
          created_at: new Date(Date.now() - (line + 1) * 17_000),
        },
      });
    }
  }

  // optional: the matching Supabase Auth admin user (local stack only: the
  // demo password is public, so never against a hosted project)
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const isLocalSupabase =
    !!supabaseUrl &&
    ['localhost', '127.0.0.1'].includes(new URL(supabaseUrl).hostname);
  if (isLocalSupabase && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: 'admin@thumbz.local',
          password: 'thumbz-admin-demo',
          email_confirm: true,
          user_metadata: { sub: adminId },
        }),
      });
      if (!response.ok) {
        console.warn(
          `Supabase Auth admin user creation skipped (HTTP ${response.status})`,
        );
      }
    } catch {
      console.warn('Supabase Auth admin user creation skipped (unreachable)');
    }
  }

  // ---- protected replay ----
  // Media assets (encrypted streams + sealed keys) are registered separately
  // (scripts/media/register.ts) and survive re-seeding; the seed's videos do
  // not, so re-link any orphaned asset to the newest replay.
  const orphan = await prisma.mediaAsset.findFirst({
    where: { video_id: null },
    orderBy: { created_at: 'asc' },
  });
  if (orphan) {
    const replay = await prisma.video.findFirst({
      where: { type: 'replay', media: null },
      orderBy: { published_at: 'desc' },
    });
    if (replay) {
      await prisma.mediaAsset.update({
        where: { id: orphan.id },
        data: { video_id: replay.id },
      });
    }
  }

  console.log(
    'Seed complete:',
    JSON.stringify({ [PH.slug]: ph.counts, [ID.slug]: id.counts }, null, 2),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
