import {
  match_item_phase,
  match_stage,
  match_status,
  Prisma,
  PrismaClient,
  tournament_status,
} from '@prisma/client';

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Demo dataset (realistic MPL-style; plan §19). Re-running the seed deletes
// all previously seeded rows first, so the script is idempotent in outcome.
// ---------------------------------------------------------------------------

// Placeholder media: picsum.photos serves deterministic images per seed key
// (example.com hosts never resolve — RFC 2606). The mux test stream is a
// public playable HLS so stream_url stays testable end-to-end.
const seedImage = (seed: string, width = 640, height = 360): string =>
  `https://picsum.photos/seed/${encodeURIComponent(seed)}/${width}/${height}`;
const SEED_STREAM_URL = 'https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8';
// Live-match hero thumbnails hosted in the project's Supabase Storage bucket
// `media` (public): https://<ref>.supabase.co/storage/v1/object/public/media/...
const SEED_LIVE_THUMB_ID =
  'https://qshjcszsvsgwpcgggkiv.supabase.co/storage/v1/object/public/media/match-thumbs/mpl-indonesia.jpg';
const SEED_LIVE_THUMB_PH =
  'https://qshjcszsvsgwpcgggkiv.supabase.co/storage/v1/object/public/media/match-thumbs/mpl-philippines.jpg';

const TOURNAMENTS: Array<{
  slug: string;
  name: string;
  status: tournament_status;
  region: string;
  start: string;
  end: string;
  prize: string | null;
  featured: boolean;
  description: string | null;
}> = [
  {
    slug: 'mpl-id-s18',
    name: 'MPL Indonesia Season 18',
    status: 'ongoing',
    region: 'Indonesia',
    start: '2026-08-01',
    end: '2026-10-30',
    prize: '500,000 USD',
    featured: true,
    description:
      'The premier Mobile Legends professional league of Indonesia.',
  },
  {
    slug: 'mpl-ph-s18',
    name: 'MPL Philippines Season 18',
    status: 'ongoing',
    region: 'Philippines',
    start: '2026-08-08',
    end: '2026-11-02',
    prize: '350,000 USD',
    featured: true,
    description:
      'The premier Mobile Legends professional league of the Philippines.',
  },
  {
    slug: 'msc-2026',
    name: 'MSC 2026',
    status: 'completed',
    region: 'Southeast Asia',
    start: '2026-06-05',
    end: '2026-07-15',
    prize: '1,000,000 USD',
    featured: false,
    description: 'Mid-Season Cup 2026 — Southeast Asia champions crowned.',
  },
];

const TEAMS: Array<{
  slug: string;
  name: string;
  short_name?: string;
  region: string;
  color_primary: string;
  color_secondary: string | null;
  founded_year: number | null;
  description: string | null;
  logo?: string;
}> = [
  { slug: 'onic', short_name: 'ONIC', name: 'ONIC Esports', region: 'Indonesia', color_primary: '#F5C518', color_secondary: '#0A0A0A', founded_year: 2018, description: 'Twice MPL Indonesia champions.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/onic-b-256.png' },
  { slug: 'rrq', short_name: 'RRQ', name: 'RRQ Hoshi', region: 'Indonesia', color_primary: '#7B2EFF', color_secondary: null, founded_year: 2017, description: 'One of the most decorated Indonesian teams.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/rrq-500.png' },
  { slug: 'evos', short_name: 'EVOS', name: 'EVOS Legends', region: 'Indonesia', color_primary: '#1E90FF', color_secondary: null, founded_year: 2016, description: 'Legacy Indonesian powerhouse.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/evos-500.png' },
  { slug: 'btr', short_name: 'BTR', name: 'Bigetron by Vitality', region: 'Indonesia', color_primary: '#E53935', color_secondary: null, founded_year: 2019, description: 'The Alpha squad from Bandung.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/btr_vit.png' },
  { slug: 'tlid', short_name: 'TLID', name: 'Team Liquid ID', region: 'Indonesia', color_primary: '#00A9E0', color_secondary: null, founded_year: 2023, description: 'Indonesian branch of Team Liquid.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/TLID-Primary500x500.png' },
  { slug: 'ae', short_name: 'AE', name: 'Alter Ego', region: 'Indonesia', color_primary: '#E91E63', color_secondary: null, founded_year: 2020, description: 'Energetic Jakarta contenders.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/ae-256.png' },
  { slug: 'dewa', short_name: 'DEWA', name: 'Dewa United Esports', region: 'Indonesia', color_primary: '#16A34A', color_secondary: null, founded_year: 2020, description: 'Dewa United Esports from Jakarta.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/dewa-united-500.png' },
  { slug: 'geek', short_name: 'GEEK', name: 'Geek Fam ID', region: 'Indonesia', color_primary: '#F59E0B', color_secondary: null, founded_year: 2019, description: 'Geek Fam Indonesian roster.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/geek-500.png' },
  { slug: 'navi', short_name: 'NAVI', name: 'NAVI', region: 'Indonesia', color_primary: '#FDD835', color_secondary: '#0A0A0A', founded_year: 2021, description: 'NAVI Indonesian division.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplid/s14/teams/NAVI-2.png' },
  { slug: 'onicph', short_name: 'ONIC PH', name: 'ONIC Philippines', region: 'Philippines', color_primary: '#FF7300', color_secondary: null, founded_year: 2024, description: 'ONIC Philippine roster.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplph/s18/teams/onicph-bw-400.webp' },
  { slug: 'apbren', short_name: 'APB', name: 'AP.Bren', region: 'Philippines', color_primary: '#B8860B', color_secondary: null, founded_year: 2023, description: 'Former Falcons AP.Bren, now competing as AP.Bren.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplph/s18/teams/apbren-400.webp' },
  { slug: 'aurora', short_name: 'AUR', name: 'Aurora Gaming', region: 'Philippines', color_primary: '#22D3EE', color_secondary: null, founded_year: 2022, description: 'Rising Philippine organisation.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplph/s18/teams/aurora-gaming-400.webp' },
  { slug: 'falcons', short_name: 'FLC', name: 'Falcons', region: 'Philippines', color_primary: '#CA8A04', color_secondary: null, founded_year: 2025, description: 'Falcons Philippine roster.', logo: 'https://wsrv.nl/?url=https://ik.imagekit.io/nloe8dhf7w/mplph/s18/teams/falcon-400.webp' },
  { slug: 'srg', short_name: 'SRG', name: 'Selangor Red Giants', region: 'Malaysia', color_primary: '#D32F2F', color_secondary: null, founded_year: 2019, description: 'Malaysian champions.' },
];

const ROLES = ['gold', 'mid', 'exp', 'jungle', 'coach'] as const;

const PLAYERS: Array<{
  slug: string;
  nickname: string;
  role: (typeof ROLES)[number];
  country: string;
  team: string;
}> = [
  // ONIC
  { slug: 'kairi', nickname: 'Kairi', role: 'jungle', country: 'Philippines', team: 'onic' },
  { slug: 'alberttt', nickname: 'Alberttt', role: 'gold', country: 'Indonesia', team: 'onic' },
  { slug: 'sanz', nickname: 'Sanz', role: 'mid', country: 'Indonesia', team: 'onic' },
  { slug: 'cw', nickname: 'CW', role: 'exp', country: 'Indonesia', team: 'onic' },
  { slug: 'onic-coach', nickname: 'Yeb', role: 'coach', country: 'Indonesia', team: 'onic' },
  // RRQ
  { slug: 'skylar', nickname: 'Skylar', role: 'gold', country: 'Indonesia', team: 'rrq' },
  { slug: 'clayyy', nickname: 'Clayyy', role: 'mid', country: 'Indonesia', team: 'rrq' },
  { slug: 'ferxiic', nickname: 'Ferxiic', role: 'jungle', country: 'Indonesia', team: 'rrq' },
  { slug: 'brusko', nickname: 'Brusko', role: 'exp', country: 'Indonesia', team: 'rrq' },
  { slug: 'rrq-coach', nickname: 'Acil', role: 'coach', country: 'Indonesia', team: 'rrq' },
  // EVOS
  { slug: 'branz', nickname: 'Branz', role: 'gold', country: 'Indonesia', team: 'evos' },
  { slug: 'clover', nickname: 'Clover', role: 'mid', country: 'Indonesia', team: 'evos' },
  { slug: 'tazz', nickname: 'Tazz', role: 'jungle', country: 'Indonesia', team: 'evos' },
  { slug: 'fluffy', nickname: 'Fluffy', role: 'exp', country: 'Indonesia', team: 'evos' },
  { slug: 'evos-coach', nickname: 'Zeys', role: 'coach', country: 'Indonesia', team: 'evos' },
  // BTR
  { slug: 'kzy', nickname: 'Kzy', role: 'gold', country: 'Indonesia', team: 'btr' },
  { slug: 'xinnn', nickname: 'Xinnn', role: 'mid', country: 'Indonesia', team: 'btr' },
  { slug: 'saken', nickname: 'Saken', role: 'jungle', country: 'Indonesia', team: 'btr' },
  { slug: 'moreno', nickname: 'Moreno', role: 'exp', country: 'Indonesia', team: 'btr' },
  { slug: 'btr-coach', nickname: 'Vyn', role: 'coach', country: 'Indonesia', team: 'btr' },
  // TLID
  { slug: 'ariz', nickname: 'AriZ', role: 'gold', country: 'Indonesia', team: 'tlid' },
  { slug: 'ciku', nickname: 'Ciku', role: 'mid', country: 'Indonesia', team: 'tlid' },
  { slug: 'faviannn', nickname: 'Faviannn', role: 'jungle', country: 'Indonesia', team: 'tlid' },
  { slug: 'ridd', nickname: 'Ridd', role: 'exp', country: 'Indonesia', team: 'tlid' },
  { slug: 'tlid-coach', nickname: 'SaintDeLucaz', role: 'coach', country: 'Indonesia', team: 'tlid' },
  // ALTER EGO
  { slug: 'damar', nickname: 'Damar', role: 'gold', country: 'Indonesia', team: 'ae' },
  { slug: 'reza', nickname: 'Reza', role: 'mid', country: 'Indonesia', team: 'ae' },
  { slug: 'bagus', nickname: 'Bagus', role: 'jungle', country: 'Indonesia', team: 'ae' },
  { slug: 'fitra', nickname: 'Fitra', role: 'exp', country: 'Indonesia', team: 'ae' },
  { slug: 'ae-coach', nickname: 'Nezz', role: 'coach', country: 'Indonesia', team: 'ae' },
  // DEWA UNITED
  { slug: 'nanda', nickname: 'Nanda', role: 'gold', country: 'Indonesia', team: 'dewa' },
  { slug: 'rizky', nickname: 'Rizky', role: 'mid', country: 'Indonesia', team: 'dewa' },
  { slug: 'bayu', nickname: 'Bayu', role: 'jungle', country: 'Indonesia', team: 'dewa' },
  { slug: 'gilang', nickname: 'Gilang', role: 'exp', country: 'Indonesia', team: 'dewa' },
  { slug: 'dewa-coach', nickname: 'Raffi', role: 'coach', country: 'Indonesia', team: 'dewa' },
  // GEEK FAM
  { slug: 'kevin', nickname: 'Kevin', role: 'gold', country: 'Indonesia', team: 'geek' },
  { slug: 'agung', nickname: 'Agung', role: 'mid', country: 'Indonesia', team: 'geek' },
  { slug: 'dimas', nickname: 'Dimas', role: 'jungle', country: 'Indonesia', team: 'geek' },
  { slug: 'farhan', nickname: 'Farhan', role: 'exp', country: 'Indonesia', team: 'geek' },
  { slug: 'geek-coach', nickname: 'Sonny', role: 'coach', country: 'Indonesia', team: 'geek' },
  // NAVI
  { slug: 'andri', nickname: 'Andri', role: 'gold', country: 'Indonesia', team: 'navi' },
  { slug: 'fajar', nickname: 'Fajar', role: 'mid', country: 'Indonesia', team: 'navi' },
  { slug: 'ihsan', nickname: 'Ihsan', role: 'jungle', country: 'Indonesia', team: 'navi' },
  { slug: 'rivaldo', nickname: 'Rivaldo', role: 'exp', country: 'Indonesia', team: 'navi' },
  { slug: 'navi-coach', nickname: 'Dion', role: 'coach', country: 'Indonesia', team: 'navi' },
  // FNOP
  { slug: 'kelra', nickname: 'Kelra', role: 'gold', country: 'Philippines', team: 'onicph' },
  { slug: 'superfrince', nickname: 'Super Frince', role: 'mid', country: 'Philippines', team: 'onicph' },
  { slug: 'kingkong', nickname: 'KingKong', role: 'jungle', country: 'Philippines', team: 'onicph' },
  { slug: 'kirk', nickname: 'Kirk', role: 'exp', country: 'Philippines', team: 'onicph' },
  { slug: 'onicph-coach', nickname: 'Duckey', role: 'coach', country: 'Philippines', team: 'onicph' },
  // AP.Bren (ex-Falcons AP.Bren roster)
  { slug: 'kyle', nickname: 'KyleTzy', role: 'gold', country: 'Philippines', team: 'apbren' },
  { slug: 'yve', nickname: 'Yve', role: 'mid', country: 'Philippines', team: 'apbren' },
  { slug: 'ryy', nickname: 'Ryy', role: 'jungle', country: 'Philippines', team: 'apbren' },
  { slug: 'coco', nickname: 'Coco', role: 'exp', country: 'Philippines', team: 'apbren' },
  { slug: 'apbren-coach', nickname: 'Ark', role: 'coach', country: 'Philippines', team: 'apbren' },
  // Falcons (PH)
  { slug: 'panday', nickname: 'Panday', role: 'gold', country: 'Philippines', team: 'falcons' },
  { slug: 'migz', nickname: 'Migz', role: 'mid', country: 'Philippines', team: 'falcons' },
  { slug: 'tams', nickname: 'Tams', role: 'jungle', country: 'Philippines', team: 'falcons' },
  { slug: 'caloy', nickname: 'Caloy', role: 'exp', country: 'Philippines', team: 'falcons' },
  { slug: 'falcons-coach', nickname: 'Mac', role: 'coach', country: 'Philippines', team: 'falcons' },
  // Aurora Gaming (PH)
  { slug: 'vinz', nickname: 'Vinz', role: 'gold', country: 'Philippines', team: 'aurora' },
  { slug: 'marky', nickname: 'Marky', role: 'mid', country: 'Philippines', team: 'aurora' },
  { slug: 'jhay', nickname: 'Jhay', role: 'jungle', country: 'Philippines', team: 'aurora' },
  { slug: 'piolo', nickname: 'Piolo', role: 'exp', country: 'Philippines', team: 'aurora' },
  { slug: 'aurora-coach', nickname: 'Wrecker', role: 'coach', country: 'Philippines', team: 'aurora' },
  // SRG
  { slug: 'innocent', nickname: 'Innocent', role: 'gold', country: 'Malaysia', team: 'srg' },
  { slug: 'yums', nickname: 'Yums', role: 'mid', country: 'Malaysia', team: 'srg' },
  { slug: 'sepht', nickname: 'Sepht', role: 'jungle', country: 'Malaysia', team: 'srg' },
  { slug: 'stormie', nickname: 'Stormie', role: 'exp', country: 'Malaysia', team: 'srg' },
  { slug: 'srg-coach', nickname: 'OzoraVeki', role: 'coach', country: 'Malaysia', team: 'srg' },
];

const HEROES = [
  'Ling', 'Fanny', 'Lancelot', 'Hayabusa', 'Karina', 'Gusion',
  'Claude', 'Beatrix', 'Karrie', 'Wanwan', 'Lunox', 'Valentina',
  'Yu Zhong', 'Chou', 'Esmeralda', 'Khufra', 'Atlas', 'Franco',
];

const ITEMS_PHASE2 = [
  { item_id: 'fury-hammer', item_name: 'Fury Hammer' },
  { item_id: 'elegant-gem', item_name: 'Elegant Gem' },
  { item_id: 'ares-belt', item_name: 'Ares Belt' },
  { item_id: 'magic-wand', item_name: 'Magic Wand' },
];

const ITEMS_PHASE3 = [
  { item_id: 'war-axe', item_name: 'War Axe' },
  { item_id: 'antique-cuirass', item_name: 'Antique Cuirass' },
  { item_id: 'glowing-wand', item_name: 'Glowing Wand' },
  { item_id: 'blade-of-despair', item_name: 'Blade of Despair' },
  { item_id: 'holy-crystal', item_name: 'Holy Crystal' },
  { item_id: 'immortality', item_name: 'Immortality' },
];

// deterministic pseudo-random generator (mulberry32) so reseeding is stable
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rand: () => number, min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

interface CreatedMatch {
  id: string;
  status: match_status;
  teamAId: string;
  teamBId: string;
  endedAt: Date | null;
  scheduledAt: Date;
  tournamentId: string;
}

async function createBroadcasts(
  match: CreatedMatch,
  feeds: Array<{ language: 'en' | 'id' | 'ms' | 'tl'; viewer_count: number }>,
): Promise<void> {
  await prisma.matchBroadcast.createMany({
    data: feeds.map((feed) => ({
      match_id: match.id,
      language: feed.language,
      // Every feed plays the public test stream (example.com never resolves).
      stream_url: SEED_STREAM_URL,
      viewer_count: feed.viewer_count,
    })),
  });
}

async function createMatch(input: {
  tournamentId: string;
  teamAId: string;
  teamBId: string;
  status: match_status;
  stage: match_stage | null;
  scheduledAt: Date;
  endedAt: Date | null;
  featured?: boolean;
  viewerCount?: number;
  streamUrl?: string | null;
  thumbnailUrl?: string;
  scoreA?: number;
  scoreB?: number;
  gameNumber?: number | null;
}): Promise<CreatedMatch> {
  const rand = mulberry32(
    input.scheduledAt.getTime() ^ input.teamAId.length ^ input.teamBId.length,
  );
  const scoreA = randInt(rand, 0, 2);
  const scoreB = scoreA === 2 ? randInt(rand, 0, 1) : 2;
  const winner = scoreA > scoreB ? input.teamAId : input.teamBId;

  const match = await prisma.match.create({
    data: {
      tournament_id: input.tournamentId,
      team_a_id: input.teamAId,
      team_b_id: input.teamBId,
      status: input.status,
      stage: input.stage,
      best_of: 3,
      score_a:
        input.scoreA !== undefined
          ? input.scoreA
          : input.status === 'completed'
            ? scoreA
            : null,
      score_b:
        input.scoreB !== undefined
          ? input.scoreB
          : input.status === 'completed'
            ? scoreB
            : null,
      winner_team_id: input.status === 'completed' ? winner : null,
      game_number: input.gameNumber ?? null,
      scheduled_at: input.scheduledAt,
      ended_at: input.endedAt,
      started_at:
        input.status === 'live'
          ? new Date(input.scheduledAt.getTime() + 5 * 60_000)
          : null,
      viewer_count: input.viewerCount ?? 0,
      featured: input.featured ?? false,
      stream_url: input.streamUrl ?? null,
      thumbnail_url:
        input.thumbnailUrl ??
        seedImage(`match-${input.teamAId}`, 640, 360),
    },
  });

  return {
    id: match.id,
    status: input.status,
    teamAId: input.teamAId,
    teamBId: input.teamBId,
    endedAt: input.endedAt,
    scheduledAt: input.scheduledAt,
    tournamentId: input.tournamentId,
  };
}

async function createCompletedStats(
  match: CreatedMatch,
  playersByTeam: Map<string, string[]>,
): Promise<void> {
  const rand = mulberry32(match.scheduledAt.getTime());
  const duration = randInt(rand, 720, 1500);

  await prisma.matchTeamStatistic.createMany({
    data: [match.teamAId, match.teamBId].map((teamId) => ({
      match_id: match.id,
      team_id: teamId,
      kills: randInt(rand, 5, 20),
      deaths: randInt(rand, 5, 20),
      assists: randInt(rand, 10, 35),
      gold: randInt(rand, 35000, 55000),
      towers_destroyed: randInt(rand, 2, 9),
      game_duration_seconds: duration,
    })),
  });

  const rows = [];
  for (const teamId of [match.teamAId, match.teamBId]) {
    for (const playerId of playersByTeam.get(teamId) ?? []) {
      rows.push({
        match_id: match.id,
        player_id: playerId,
        team_id: teamId,
        kills: randInt(rand, 0, 8),
        deaths: randInt(rand, 0, 6),
        assists: randInt(rand, 0, 12),
        gold: randInt(rand, 7000, 12000),
        damage: randInt(rand, 20000, 60000),
        damage_taken: randInt(rand, 8000, 30000),
        level: randInt(rand, 12, 15),
        hero_picked: HEROES[randInt(rand, 0, HEROES.length - 1)] ?? 'Ling',
        mvp: rand() > 0.85,
      });
    }
  }
  await prisma.playerMatchStatistic.createMany({ data: rows });
}

/**
 * Games of the series (contract §19), consistent with the stored score:
 * the series winner takes the last game. A live match also gets its current
 * game, started a few minutes ago. Returns the live game, if any.
 */
async function createGames(
  match: CreatedMatch,
): Promise<{ gameNumber: number; startedAt: Date } | null> {
  const row = await prisma.match.findUniqueOrThrow({
    where: { id: match.id },
    select: { score_a: true, score_b: true, winner_team_id: true },
  });
  const winsA = row.score_a ?? 0;
  const winsB = row.score_b ?? 0;
  const seriesWinner = row.winner_team_id;
  const loser = seriesWinner === match.teamAId ? match.teamBId : match.teamAId;
  const loserWins = seriesWinner === match.teamAId ? winsB : winsA;
  const winnerWins = seriesWinner === match.teamAId ? winsA : winsB;

  // Order: loser's wins interleaved early, the winner closes the series.
  const winners: string[] = [];
  if (seriesWinner) {
    for (let i = 0; i < winnerWins - 1; i++) {
      winners.push(seriesWinner);
      if (i < loserWins) winners.push(loser);
    }
    for (let i = winnerWins - 1; i < loserWins; i++) winners.push(loser);
    winners.push(seriesWinner);
  } else {
    for (let i = 0; i < Math.max(winsA, winsB); i++) {
      if (i < winsA) winners.push(match.teamAId);
      if (i < winsB) winners.push(match.teamBId);
    }
  }

  const rand = mulberry32(match.scheduledAt.getTime() ^ 0x9e3779b9);
  const games: Prisma.MatchGameCreateManyInput[] = winners.map((winner, index) => {
    const startedAt = new Date(match.scheduledAt.getTime() + (10 + index * 25) * 60_000);
    const duration = randInt(rand, 720, 1260);
    return {
      match_id: match.id,
      game_number: index + 1,
      status: 'completed',
      winner_team_id: winner,
      started_at: startedAt,
      ended_at: new Date(startedAt.getTime() + duration * 1000),
      duration_seconds: duration,
    };
  });

  let live: { gameNumber: number; startedAt: Date } | null = null;
  if (match.status === 'live') {
    live = { gameNumber: games.length + 1, startedAt: new Date(Date.now() - 9 * 60_000) };
    games.push({
      match_id: match.id,
      game_number: live.gameNumber,
      status: 'live',
      started_at: live.startedAt,
    });
    await prisma.match.update({ where: { id: match.id }, data: { game_number: live.gameNumber } });
  }
  if (games.length > 0) await prisma.matchGame.createMany({ data: games });
  return live;
}

async function createLiveData(
  match: CreatedMatch,
  game: { gameNumber: number; startedAt: Date },
): Promise<void> {
  // Everything belongs to the game being played, which started minutes ago.
  const started = game.startedAt.getTime();
  const game_number = game.gameNumber;
  const minutes = Math.max(1, Math.floor((Date.now() - started) / 60_000));

  const goldSnapshots = [];
  const points = 8;
  for (let i = 0; i <= points; i++) {
    const at = new Date(started + ((minutes / points) * i) * 60_000);
    for (const teamId of [match.teamAId, match.teamBId]) {
      goldSnapshots.push({
        match_id: match.id,
        team_id: teamId,
        gold: Math.floor(15000 + ((20000 * i) / points) * (teamId === match.teamAId ? 1 : 0.92)),
        game_number,
        recorded_at: at,
      });
    }
  }
  await prisma.matchGoldSnapshot.createMany({
    data: goldSnapshots,
    skipDuplicates: true,
  });

  // player snapshots + equipment + events
  const players = await prisma.player.findMany({
    where: { team_id: { in: [match.teamAId, match.teamBId] }, role: { not: 'coach' } },
    select: { id: true, team_id: true, nickname: true },
    orderBy: { nickname: 'asc' },
  });
  // One distinct hero per player for this game's draft.
  const draft = mulberry32(match.id.charCodeAt(0) * 7919 + game_number);
  const pool = [...HEROES];
  const heroOf = new Map(
    players.map((player) => [player.id, pool.splice(randInt(draft, 0, pool.length - 1), 1)[0] ?? 'Ling']),
  );
  const snapshots = [];
  const purchases = [];
  for (const player of players) {
    if (player.team_id === null) continue;
    const playerTeamId = player.team_id;
    const rand = mulberry32(player.id.length * 31);
    for (let i = 1; i <= 4; i++) {
      snapshots.push({
        match_id: match.id,
        player_id: player.id,
        team_id: playerTeamId,
        kills: randInt(rand, 0, i + 3),
        deaths: randInt(rand, 0, i),
        assists: randInt(rand, 0, i + 4),
        gold: 4000 + i * 2000,
        damage: 8000 + i * 9000,
        damage_taken: 3000 + i * 3000,
        level: 1 + i * 3,
        hero: heroOf.get(player.id) ?? null,
        game_number,
        recorded_at: new Date(started + i * ((minutes / 4) * 60_000)),
      });
    }
    const phase2 = ITEMS_PHASE2[randInt(rand, 0, ITEMS_PHASE2.length - 1)];
    const phase3 = ITEMS_PHASE3[randInt(rand, 0, ITEMS_PHASE3.length - 1)];
    purchases.push(
      {
        match_id: match.id,
        player_id: player.id,
        team_id: player.team_id,
        item_id: phase2?.item_id ?? 'fury-hammer',
        item_name: phase2?.item_name ?? 'Fury Hammer',
        phase: 'phase2' as match_item_phase,
        game_number,
        purchased_at: new Date(started + 2 * 60_000),
      },
      {
        match_id: match.id,
        player_id: player.id,
        team_id: playerTeamId,
        item_id: phase3?.item_id ?? 'war-axe',
        item_name: phase3?.item_name ?? 'War Axe',
        phase: 'phase3' as match_item_phase,
        slot: 1,
        game_number,
        purchased_at: new Date(started + 6 * 60_000),
      },
    );
  }
  await prisma.playerMatchSnapshot.createMany({
    data: snapshots,
    skipDuplicates: true,
  });
  await prisma.matchItemEvent.createMany({
    data: purchases,
    skipDuplicates: true,
  });

  const teamA = await prisma.team.findUniqueOrThrow({ where: { id: match.teamAId } });
  const teamB = await prisma.team.findUniqueOrThrow({ where: { id: match.teamBId } });
  await prisma.matchEvent.createMany({
    data: [
      {
        match_id: match.id,
        team_id: match.teamAId,
        event_type: 'first_blood',
        title: `${teamA.name} took first blood`,
        game_number,
        occurred_at: new Date(started + 2 * 60_000),
      },
      {
        match_id: match.id,
        team_id: match.teamAId,
        event_type: 'turtle',
        title: `${teamA.name} secured the first Turtle`,
        details: { objective: 'turtle' },
        game_number,
        occurred_at: new Date(started + 4 * 60_000),
      },
      {
        match_id: match.id,
        team_id: match.teamBId,
        event_type: 'tower',
        title: `${teamB.name} destroyed the first tower`,
        details: { objective: 'tower', lane: 'gold' },
        game_number,
        occurred_at: new Date(started + 6 * 60_000),
      },
      {
        match_id: match.id,
        team_id: match.teamAId,
        event_type: 'lord',
        title: `${teamA.name} secured the Lord`,
        details: { objective: 'lord' },
        game_number,
        occurred_at: new Date(started + 8 * 60_000),
      },
    ],
  });
}

async function main(): Promise<void> {
  console.log('Seeding THUMBZ demo data...');

  const teamSlugs = TEAMS.map((t) => t.slug);
  const tournamentSlugs = TOURNAMENTS.map((t) => t.slug);
  const playerSlugs = PLAYERS.map((p) => p.slug);

  // ---- cleanup of previously seeded rows (idempotent outcome) ----
  const oldTeams = await prisma.team.findMany({
    where: { slug: { in: teamSlugs } },
    select: { id: true },
  });
  const oldTeamIds = oldTeams.map((t) => t.id);
  const oldPlayers = await prisma.player.findMany({
    where: {
      OR: [
        { slug: { in: playerSlugs } },
        ...(oldTeamIds.length > 0 ? [{ team_id: { in: oldTeamIds } }] : []),
      ],
    },
    select: { id: true },
  });
  const oldPlayerIds = oldPlayers.map((p) => p.id);
  const oldMatches = await prisma.match.findMany({
    where:
      oldTeamIds.length > 0
        ? {
            OR: [
              { team_a_id: { in: oldTeamIds } },
              { team_b_id: { in: oldTeamIds } },
            ],
          }
        : undefined,
    select: { id: true },
  });

  await prisma.video.deleteMany({
    where: {
      OR: [{ url: SEED_STREAM_URL }, { url: { startsWith: 'https://cdn.example.com/' } }],
    },
  });
  const danglingEntityIds = [...oldTeamIds, ...oldPlayerIds];
  if (danglingEntityIds.length > 0) {
    await prisma.favorite.deleteMany({
      where: { entity_id: { in: danglingEntityIds } },
    });
  }
  if (oldMatches.length > 0) {
    const oldMatchIds = oldMatches.map((m) => m.id);
    // Demo purchases block the match delete (Restrict FKs); payments cascade
    // from their orders.
    await prisma.ticket.deleteMany({ where: { match_id: { in: oldMatchIds } } });
    await prisma.ticketOrder.deleteMany({ where: { match_id: { in: oldMatchIds } } });
    await prisma.match.deleteMany({ where: { id: { in: oldMatchIds } } });
  }
  if (oldPlayerIds.length > 0) {
    await prisma.player.deleteMany({ where: { id: { in: oldPlayerIds } } });
  }
  if (oldTeamIds.length > 0) {
    await prisma.team.deleteMany({ where: { id: { in: oldTeamIds } } });
  }
  await prisma.tournament.deleteMany({
    where: { slug: { in: tournamentSlugs } },
  });

  // ---- tournaments / teams / players ----
  const tournamentById = new Map<string, string>();
  for (const tournament of TOURNAMENTS) {
    const row = await prisma.tournament.create({
      data: {
        slug: tournament.slug,
        name: tournament.name,
        status: tournament.status,
        region: tournament.region,
        start_date: new Date(`${tournament.start}T00:00:00Z`),
        end_date: new Date(`${tournament.end}T00:00:00Z`),
        prize_pool: tournament.prize,
        description: tournament.description,
        featured: tournament.featured,
        logo_url: seedImage(`logo-${tournament.slug}`, 128, 128),
      },
    });
    tournamentById.set(tournament.slug, row.id);
  }

  const teamBySlug = new Map<string, { id: string }>();
  for (const team of TEAMS) {
    const row = await prisma.team.create({
      data: {
        slug: team.slug,
        name: team.name,
        short_name: team.short_name ?? null,
        region: team.region,
        color_primary: team.color_primary,
        color_secondary: team.color_secondary,
        founded_year: team.founded_year,
        description: team.description,
        logo_url: team.logo ?? seedImage(`logo-${team.slug}`, 128, 128),
      },
    });
    teamBySlug.set(team.slug, { id: row.id });
  }

  const playersByTeam = new Map<string, string[]>();
  for (const player of PLAYERS) {
    const team = teamBySlug.get(player.team);
    if (team === undefined) continue;
    const row = await prisma.player.create({
      data: {
        slug: player.slug,
        nickname: player.nickname,
        role: player.role,
        country: player.country,
        team_id: team.id,
        photo_url: seedImage(`player-${player.slug}`, 256, 256),
      },
    });
    const list = playersByTeam.get(team.id) ?? [];
    list.push(row.id);
    playersByTeam.set(team.id, list);
  }

  const teamId = (slug: string): string => {
    const team = teamBySlug.get(slug);
    if (team === undefined) throw new Error(`unknown team ${slug}`);
    return team.id;
  };
  const tournamentId = (slug: string): string => {
    const id = tournamentById.get(slug);
    if (id === undefined) throw new Error(`unknown tournament ${slug}`);
    return id;
  };

  // ---- matches ----
  const DAY = 24 * 3_600_000;
  const base = new Date('2026-09-01T10:00:00Z').getTime();
  const createdMatches: CreatedMatch[] = [];

  // MPL ID: 9 teams double round robin (72 completed) + playoffs + live + upcoming
  const idLeague = ['onic', 'rrq', 'evos', 'btr', 'tlid', 'ae', 'dewa', 'geek', 'navi'];
  let offset = 0;
  for (const teamA of idLeague) {
    for (const teamB of idLeague) {
      if (teamA >= teamB) continue;
      for (let leg = 0; leg < 2; leg++) {
        const scheduledAt = new Date(base - 30 * DAY + offset * DAY);
        const endedAt = new Date(scheduledAt.getTime() + 2 * 3_600_000);
        createdMatches.push(
          await createMatch({
            tournamentId: tournamentId('mpl-id-s18'),
            teamAId: teamId(leg === 0 ? teamA : teamB),
            teamBId: teamId(leg === 0 ? teamB : teamA),
            status: 'completed',
            stage: 'regular_season',
            scheduledAt,
            endedAt,
          }),
        );
        offset += 1;
      }
    }
  }
  // playoffs + grand final (completed, recent)
  createdMatches.push(
    await createMatch({
      tournamentId: tournamentId('mpl-id-s18'),
      teamAId: teamId('onic'),
      teamBId: teamId('evos'),
      status: 'completed',
      stage: 'semifinal',
      scheduledAt: new Date(base - 3 * DAY),
      endedAt: new Date(base - 3 * DAY + 2 * 3_600_000),
    }),
    await createMatch({
      tournamentId: tournamentId('mpl-id-s18'),
      teamAId: teamId('rrq'),
      teamBId: teamId('tlid'),
      status: 'completed',
      stage: 'semifinal',
      scheduledAt: new Date(base - 2 * DAY),
      endedAt: new Date(base - 2 * DAY + 2 * 3_600_000),
    }),
    await createMatch({
      tournamentId: tournamentId('mpl-id-s18'),
      teamAId: teamId('onic'),
      teamBId: teamId('rrq'),
      status: 'completed',
      stage: 'grand_final',
      scheduledAt: new Date(base - DAY),
      endedAt: new Date(base - DAY + 2 * 3_600_000),
    }),
  );
  // live matches (featured + one more) — started ~2h ago so e2e fixtures always rank newer
  const featuredLive = await createMatch({
    tournamentId: tournamentId('mpl-id-s18'),
    teamAId: teamId('ae'),
    teamBId: teamId('rrq'),
    status: 'live',
    stage: 'regular_season',
    scheduledAt: new Date(Date.now() - 2 * 3_600_000),
    endedAt: null,
    featured: true,
    viewerCount: 18400,
    streamUrl: SEED_STREAM_URL,
    thumbnailUrl: SEED_LIVE_THUMB_ID,
    scoreA: 1,
    scoreB: 1,
    gameNumber: 3,
  });
  createdMatches.push(featuredLive);
  const secondaryLive = await createMatch({
    tournamentId: tournamentId('mpl-id-s18'),
    teamAId: teamId('evos'),
    teamBId: teamId('btr'),
    status: 'live',
    stage: 'regular_season',
    scheduledAt: new Date(Date.now() - 3 * 3_600_000),
    endedAt: null,
    viewerCount: 9200,
    streamUrl: SEED_STREAM_URL,
    thumbnailUrl: SEED_LIVE_THUMB_ID,
    scoreA: 1,
    scoreB: 0,
    gameNumber: 2,
  });
  createdMatches.push(secondaryLive);
  // upcoming
  for (let i = 1; i <= 4; i++) {
    createdMatches.push(
      await createMatch({
        tournamentId: tournamentId('mpl-id-s18'),
        teamAId: teamId(idLeague[i % idLeague.length] ?? 'onic'),
        teamBId: teamId(idLeague[(i + 2) % idLeague.length] ?? 'rrq'),
        status: 'scheduled',
        stage: 'regular_season',
        scheduledAt: new Date(Date.now() + i * DAY),
        endedAt: null,
      }),
    );
  }

  // MPL PH: 4 teams round robin (6 completed) + live + upcoming
  const phLeague = ['onicph', 'apbren', 'aurora', 'falcons'];
  for (const teamA of phLeague) {
    for (const teamB of phLeague) {
      if (teamA >= teamB) continue;
      createdMatches.push(
        await createMatch({
          tournamentId: tournamentId('mpl-ph-s18'),
          teamAId: teamId(teamA),
          teamBId: teamId(teamB),
          status: 'completed',
          stage: 'regular_season',
          scheduledAt: new Date(base - 25 * DAY + offset * 0),
          endedAt: new Date(base - 25 * DAY + offset * 0 + 2 * 3_600_000),
        }),
      );
      offset += 1;
    }
  }
  const phLive = await createMatch({
    tournamentId: tournamentId('mpl-ph-s18'),
    teamAId: teamId('onicph'),
    teamBId: teamId('falcons'),
    status: 'live',
    stage: 'regular_season',
    scheduledAt: new Date(Date.now() - 4 * 3_600_000),
    endedAt: null,
    viewerCount: 6100,
    streamUrl: SEED_STREAM_URL,
    thumbnailUrl: SEED_LIVE_THUMB_PH,
    scoreA: 1,
    scoreB: 1,
    gameNumber: 3,
  });
  createdMatches.push(phLive);
  for (let i = 1; i <= 2; i++) {
    createdMatches.push(
      await createMatch({
        tournamentId: tournamentId('mpl-ph-s18'),
        teamAId: teamId(phLeague[i % phLeague.length] ?? 'onicph'),
        teamBId: teamId(phLeague[(i + 1) % phLeague.length] ?? 'srg'),
        status: 'scheduled',
        stage: 'regular_season',
        scheduledAt: new Date(Date.now() + i * 2 * DAY),
        endedAt: null,
      }),
    );
  }

  // MSC 2026: completed playoffs bracket (8 matches)
  const mscTeams = ['onic', 'rrq', 'evos', 'onicph', 'apbren', 'srg', 'btr', 'tlid'];
  const bracket = [
    ['onic', 'tlid'], ['rrq', 'srg'], ['evos', 'onicph'], ['btr', 'apbren'],
    ['onic', 'evos'], ['rrq', 'btr'], ['rrq', 'evos'], ['onic', 'rrq'],
  ];
  for (const [index, [a, b]] of bracket.entries()) {
    const scheduledAt = new Date(base - 60 * DAY + index * 2 * DAY);
    createdMatches.push(
      await createMatch({
        tournamentId: tournamentId('msc-2026'),
        teamAId: teamId(a ?? 'onic'),
        teamBId: teamId(b ?? 'rrq'),
        status: 'completed',
        stage: index < 4 ? 'playoffs' : index < 7 ? 'semifinal' : 'grand_final',
        scheduledAt,
        endedAt: new Date(scheduledAt.getTime() + 2 * 3_600_000),
      }),
    );
  }

  // ---- statistics for completed matches ----
  for (const match of createdMatches.filter((m) => m.status === 'completed')) {
    await createCompletedStats(match, playersByTeam);
  }

  // ---- games of each series; live data for the game being played ----
  for (const match of createdMatches.filter((m) => m.status === 'completed' || m.status === 'live')) {
    const liveGame = await createGames(match);
    if (liveGame) await createLiveData(match, liveGame);
  }

  // ---- language broadcast variants (MPL ID: id+en, MPL PH: tl+en) ----
  await createBroadcasts(featuredLive, [
    { language: 'id', viewer_count: 12100 },
    { language: 'en', viewer_count: 6300 },
  ]);
  await createBroadcasts(secondaryLive, [
    { language: 'id', viewer_count: 6100 },
    { language: 'en', viewer_count: 3100 },
  ]);
  await createBroadcasts(phLive, [
    { language: 'tl', viewer_count: 4000 },
    { language: 'en', viewer_count: 2100 },
  ]);

  // ---- videos ----
  const completed = createdMatches.filter((m) => m.status === 'completed');
  const videoFixtures: Array<{
    title: string;
    type: 'replay' | 'highlight' | 'vod';
    matchIndex: number | null;
    duration: number;
  }> = [
    { title: 'Grand Final — ONIC vs RRQ (Replay)', type: 'replay', matchIndex: completed.length - 1, duration: 7340 },
    { title: 'Week 4 Highlights — MPL ID S18', type: 'highlight', matchIndex: null, duration: 640 },
    { title: 'Semifinal Day 1 VOD — MPL ID S18', type: 'vod', matchIndex: completed.length - 3, duration: 11200 },
    { title: 'MSC 2026 Championship Replay', type: 'replay', matchIndex: 0, duration: 8100 },
    { title: 'Top 5 Plays — MPL PH S18', type: 'highlight', matchIndex: null, duration: 420 },
    { title: 'Regular Season Week 3 — Day 2 VOD', type: 'vod', matchIndex: 4, duration: 9800 },
    { title: 'ONIC vs EVOS — Semifinal Replay', type: 'replay', matchIndex: completed.length - 2, duration: 7200 },
    { title: 'Kairi Jungle Montage', type: 'highlight', matchIndex: null, duration: 380 },
    { title: 'RRQ Road to Grand Final VOD', type: 'vod', matchIndex: 2, duration: 8900 },
    { title: 'MSC 2026 Playoffs — Day 1 Replay', type: 'replay', matchIndex: 1, duration: 7500 },
    { title: 'Week 2 Highlights — MPL PH S18', type: 'highlight', matchIndex: null, duration: 540 },
    { title: 'Bigetron vs TLID — Full VOD', type: 'vod', matchIndex: 6, duration: 9300 },
    { title: 'EVOS Comeback Story', type: 'highlight', matchIndex: null, duration: 610 },
    { title: 'Grand Finals Day VOD — MSC 2026', type: 'vod', matchIndex: 3, duration: 10100 },
    { title: 'Sanz Midlane Masterclass', type: 'highlight', matchIndex: null, duration: 460 },
    { title: 'Playoffs Replay — FNOP vs Falcons', type: 'replay', matchIndex: 5, duration: 6900 },
    { title: 'Week 1 Highlights — MPL ID S18', type: 'highlight', matchIndex: null, duration: 590 },
    { title: 'Selangor Red Giants VOD — Regular Season', type: 'vod', matchIndex: 7, duration: 8600 },
    { title: 'Coach Cam — Zeys Draft Review', type: 'highlight', matchIndex: null, duration: 720 },
    { title: 'MSC 2026 Finals Replay (English)', type: 'replay', matchIndex: 0, duration: 7950 },
  ];
  let videoIndex = 0;
  for (const video of videoFixtures) {
    const linkedMatch =
      video.matchIndex !== null ? completed[video.matchIndex] : undefined;
    const withResult =
      video.type === 'replay' && linkedMatch !== undefined;
    await prisma.video.create({
      data: {
        game_number: withResult ? ((videoIndex % 3) + 1) : null,
        winning_team_id: withResult
          ? (await prisma.match.findUniqueOrThrow({
              where: { id: linkedMatch.id },
              select: { winner_team_id: true },
            })).winner_team_id
          : null,
        title: video.title,
        type: video.type,
        url: SEED_STREAM_URL,
        thumbnail_url: seedImage(`video-${videoIndex}`),
        duration_seconds: video.duration,
        match_id:
          video.matchIndex !== null
            ? (completed[video.matchIndex]?.id ?? null)
            : null,
        published_at: new Date(base - (videoFixtures.length - videoIndex) * 3_600_000),
      },
    });
    videoIndex += 1;
  }

  // ---- admin profile ----
  const adminId =
    process.env.SEED_ADMIN_ID ?? '00000000-0000-4000-8000-000000000001';
  await prisma.profile.upsert({
    where: { id: adminId },
    update: { role: 'admin' },
    create: { id: adminId, role: 'admin', username: 'thumbz-admin' },
  });

  // ---- demo commenters + live comments (streaming-page panel) ----
  const commenters = [
    { id: '00000000-0000-4000-8000-000000000201', username: 'raka' },
    { id: '00000000-0000-4000-8000-000000000202', username: 'adrian' },
    { id: '00000000-0000-4000-8000-000000000203', username: 'niko' },
    { id: '00000000-0000-4000-8000-000000000204', username: 'fajar' },
    { id: '00000000-0000-4000-8000-000000000205', username: 'dimas' },
    { id: '00000000-0000-4000-8000-000000000206', username: 'miguel' },
    { id: '00000000-0000-4000-8000-000000000207', username: 'sinta' },
    { id: '00000000-0000-4000-8000-000000000208', username: 'bimo' },
    { id: '00000000-0000-4000-8000-000000000209', username: 'yudha' },
    { id: '00000000-0000-4000-8000-000000000210', username: 'clara' },
    { id: '00000000-0000-4000-8000-000000000211', username: 'rafi' },
  ];
  for (const commenter of commenters) {
    await prisma.profile.upsert({
      where: { id: commenter.id },
      update: {},
      create: commenter,
    });
  }
  const commentFixtures: Array<{
    match: CreatedMatch;
    author: string;
    body: string;
    secondsAgo: number;
  }> = [
    { match: featuredLive, author: 'Raka', body: 'RRQ setup-nya bagus', secondsAgo: 12 },
    { match: featuredLive, author: 'Adrian', body: 'Lord fight incoming 👀', secondsAgo: 19 },
    { match: featuredLive, author: 'Niko', body: 'gold gap mulai jauh', secondsAgo: 31 },
    { match: featuredLive, author: 'Fajar', body: 'comeback possible', secondsAgo: 42 },
    { match: featuredLive, author: 'Sinta', body: 'RRQ farming-nya rapi banget', secondsAgo: 65 },
    { match: featuredLive, author: 'Bimo', body: 'Alter Ego harus cari pick-off', secondsAgo: 78 },
    { match: featuredLive, author: 'Yudha', body: 'turtle contest krusial nih', secondsAgo: 95 },
    { match: featuredLive, author: 'Clara', body: 'game 3 makin tegang 🔥', secondsAgo: 120 },
    { match: featuredLive, author: 'Rafi', body: 'tower mid hampir jatuh', secondsAgo: 150 },
    { match: secondaryLive, author: 'Dimas', body: 'wow turnaround EVOS', secondsAgo: 8 },
    { match: secondaryLive, author: 'Raka', body: 'BTR draft-nya aneh', secondsAgo: 27 },
    { match: secondaryLive, author: 'Fajar', body: 'game 3 bakal seru', secondsAgo: 51 },
    { match: phLive, author: 'Miguel', body: 'lakas ng ONIC ngayon', secondsAgo: 15 },
    { match: phLive, author: 'Adrian', body: 'Falcons comeback please', secondsAgo: 34 },
    { match: phLive, author: 'Niko', body: 'solid macro from ONIC PH', secondsAgo: 58 },
  ];
  const commenterByName = new Map(
    commenters.map((c) => [c.username, c]),
  );
  // ---- venue ticket configs (demo) ----
  const ticketFixtures: Array<{
    match: CreatedMatch;
    venue: string;
    city: string;
    price: number;
    /** IDR price enables QRIS / bank VA checkout; null = crypto only. */
    priceIdr: number | null;
    quota: number;
  }> = [
    { match: featuredLive, venue: 'GBK Basketball Hall', city: 'Jakarta', price: 25, priceIdr: 400_000, quota: 5000 },
    { match: secondaryLive, venue: 'GBK Basketball Hall', city: 'Jakarta', price: 25, priceIdr: 400_000, quota: 3000 },
    { match: phLive, venue: 'Mall of Asia Arena', city: 'Manila', price: 20, priceIdr: null, quota: 4000 },
  ];
  for (const fixture of ticketFixtures) {
    await prisma.matchTicketConfig.upsert({
      where: { match_id: fixture.match.id },
      update: {
        venue_name: fixture.venue,
        venue_city: fixture.city,
        price_usd: fixture.price,
        price_idr: fixture.priceIdr,
        quota_total: fixture.quota,
        is_active: true,
      },
      create: {
        match_id: fixture.match.id,
        venue_name: fixture.venue,
        venue_city: fixture.city,
        price_usd: fixture.price,
        price_idr: fixture.priceIdr,
        quota_total: fixture.quota,
        is_active: true,
      },
    });
  }
  // Every upcoming match sells tickets: the demo simulator brings scheduled
  // matches live over time, so a few would soon run out.
  for (const upcoming of createdMatches.filter((m) => m.status === 'scheduled')) {
    await prisma.matchTicketConfig.upsert({
      where: { match_id: upcoming.id },
      update: {
        venue_name: 'Istora Senayan',
        venue_city: 'Jakarta',
        price_usd: 15,
        price_idr: 250_000,
        quota_total: 8000,
        is_active: true,
      },
      create: {
        match_id: upcoming.id,
        venue_name: 'Istora Senayan',
        venue_city: 'Jakarta',
        price_usd: 15,
        price_idr: 250_000,
        quota_total: 8000,
        is_active: true,
      },
    });
  }
  for (const fixture of commentFixtures) {
    const profile = commenterByName.get(fixture.author.toLowerCase());
    if (profile === undefined) continue;
    await prisma.matchComment.create({
      data: {
        match_id: fixture.match.id,
        user_id: profile.id,
        author_name: fixture.author,
        body: fixture.body,
        created_at: new Date(Date.now() - fixture.secondsAgo * 1_000),
      },
    });
  }

  // optional: create the matching Supabase Auth admin user (local stack only:
  // the demo password is public, so never do this against a hosted project)
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const isLocalSupabase =
    !!supabaseUrl &&
    ['localhost', '127.0.0.1'].includes(new URL(supabaseUrl).hostname);
  if (supabaseUrl && !isLocalSupabase) {
    console.warn(
      'Supabase Auth admin user creation skipped (SUPABASE_URL is not local)',
    );
  }
  if (isLocalSupabase && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const response = await fetch(
        `${process.env.SUPABASE_URL}/auth/v1/admin/users`,
        {
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
        },
      );
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

  const counts = {
    tournaments: TOURNAMENTS.length,
    teams: TEAMS.length,
    players: PLAYERS.length,
    matches: createdMatches.length,
    liveMatches: createdMatches.filter((m) => m.status === 'live').length,
    videos: videoFixtures.length,
  };
  console.log('Seed complete:', JSON.stringify(counts, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
