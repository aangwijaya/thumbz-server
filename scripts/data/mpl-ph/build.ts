/**
 * Builds the committed dataset from data-cache/ (see fetch.ts):
 *   prisma/data/mpl-ph-s18-w8.json   teams, players, matches, games, timelines
 *   prisma/data/mlbb-catalog.json    names + icons for the ids used
 *   prisma/data/catalog-review.csv   everything inferred, for human review
 *
 *   npm run data:build -- --week 8
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  dataSlugOf,
  inferGameWinners,
  playableOrder,
  seriesScore,
  winnersByStats,
  isFinished,
  latestFinishedWith,
  parseItemization,
  parseMatchPage,
  parseSchedule,
  parseTeams,
  type ParsedGame,
} from './parse';
import { assignRoles, type Role } from './roles';

const args = process.argv.slice(2);
const week = Number(args[args.indexOf('--week') + 1] || 8);
const CACHE = join(process.cwd(), 'data-cache', 'mpl-ph');
const OUT = join(process.cwd(), 'prisma', 'data');

const read = (file: string) => readFileSync(join(CACHE, file), 'utf8');
const records = <T>(file: string): T[] =>
  (
    JSON.parse(read(file)) as { data: { records: Array<{ data: T }> } }
  ).data.records.map((record) => record.data);

const ITEM_ICON = (id: string) =>
  `https://ik.imagekit.io/nloe8dhf7w/mlbb/2024/equipments/${id}.png`;
const EMBLEM_ICON = (id: string) =>
  `https://mlbb-image.scoregg.com/emblem/${id}.png`;
const TALENT_ICON = (id: string) =>
  `https://mlbb-image.scoregg.com/rune/${id}.png`;

/** Main emblem sets: not in the Academy data; identified from their icons. */
const EMBLEM_SETS: Record<string, string> = {
  '20001': 'Common Emblem',
  '20003': 'Tank Emblem',
  '20005': 'Assassin Emblem',
  '20006': 'Mage Emblem',
  '20007': 'Fighter Emblem',
  '20008': 'Support Emblem',
};
/** Heroes newer than the Academy catalog snapshot, mapped by hand. */
const HERO_LANES_MANUAL: Record<string, string[]> = { Hirara: ['Jungle'] };

const normalize = (name: string) => name.toLowerCase().replace(/[^a-z]/g, '');

function main(): void {
  const schedule = parseSchedule(read('schedule.html'), week);
  const listing = parseTeams(read('teams.html'));
  const teamByLogo = new Map(
    listing.map((team) => [team.logoUrl?.split('/').pop() ?? '', team]),
  );
  const teamByCode = new Map(
    listing.map((team) => [team.code.toUpperCase(), team]),
  );

  // ---- reference data ----
  const equipment = new Map(
    records<{ equipid: number; equipname: string }>(
      'academy-equipment.json',
    ).map((item) => [String(item.equipid), item.equipname]),
  );
  const talents = new Map(
    records<{ giftid: number; emblemskill?: { skillname?: string } }>(
      'academy-emblems.json',
    ).map((gift) => [String(gift.giftid), gift.emblemskill?.skillname ?? '']),
  );
  const heroLanes = new Map<string, string[]>();
  for (const hero of records<{
    hero: {
      data: {
        name: string;
        roadsort?: Array<{ data?: { road_sort_title?: string } } | string>;
      };
    };
  }>('academy-heroes.json')) {
    const lanes = (hero.hero.data.roadsort ?? [])
      .map((lane) =>
        typeof lane === 'object' ? lane.data?.road_sort_title : undefined,
      )
      .filter((lane): lane is string => Boolean(lane));
    heroLanes.set(normalize(hero.hero.data.name), lanes);
  }
  const lanesOf = (hero: string): string[] => {
    if (HERO_LANES_MANUAL[hero]) return HERO_LANES_MANUAL[hero];
    const key = normalize(hero);
    for (const [name, lanes] of heroLanes)
      if (name === key || key.endsWith(name)) return lanes;
    return [];
  };

  // ---- matches ----
  const review: string[][] = [['kind', 'id', 'value', 'source', 'note']];
  const usedItems = new Set<string>();
  const usedEmblems = new Set<string>();
  const usedTalents = new Set<string>();
  const heroIcons = new Map<string, string>();
  const playerHeroes = new Map<string, { team: string; heroes: string[] }>();

  const matches = schedule.map((scheduled) => {
    const codes = scheduled.teams.map((code) => code.toUpperCase()) as [
      string,
      string,
    ];
    // Scored by the schedule, or (when the schedule lags) a data page whose
    // games already make a decided series.
    const slug = isFinished(scheduled)
      ? scheduled.dataSlug
      : dataSlugOf(scheduled);
    const page = slug ? join(CACHE, `match-${slug}.html`) : null;
    const parsedPage: ParsedGame[] =
      page && existsSync(page)
        ? parseMatchPage(read(`match-${slug}.html`))
        : [];
    const complete = parsedPage.every((game) =>
      existsSync(join(CACHE, `items-${slug}-g${game.gameNumber}.html`)),
    );
    for (const game of parsedPage) {
      for (const side of game.sides) {
        const team = teamByLogo.get(side.logo);
        if (!team) throw new Error(`${slug}: unknown team logo ${side.logo}`);
        side.team = team.code.toUpperCase();
      }
    }
    const score: [number, number] | null = isFinished(scheduled)
      ? scheduled.score
      : complete
        ? seriesScore(winnersByStats(parsedPage), codes)
        : null;
    if (!isFinished(scheduled) && score) {
      review.push([
        'check',
        slug as string,
        score.join('-'),
        'series score',
        'the schedule has no score yet; taken from the games on the data page',
      ]);
    }
    if (!slug || parsedPage.length === 0 || !complete || !score) {
      return {
        date: scheduled.date,
        time: scheduled.time,
        teams: codes,
        status: 'upcoming' as const,
        score: null,
        games: [],
      };
    }
    const parsed = parsedPage;
    const inferred = inferGameWinners(parsed, codes, score);
    // The page's game order, unless its winners make an impossible series.
    const order = playableOrder(inferred);
    if (order.some((pageIndex, index) => pageIndex !== index)) {
      review.push([
        'check',
        slug,
        order.map((pageIndex) => `G${pageIndex + 1}`).join(' '),
        'game order',
        `page order ${inferred.join(',')} is impossible; replayed as ${order.map((i) => inferred[i]).join(',')}`,
      ]);
    }
    const ordered = order.map((pageIndex) => parsed[pageIndex]);
    const winners = order.map((pageIndex) => inferred[pageIndex]);

    const games = ordered.map((game, index) => {
      const timeline = parseItemization(
        read(`items-${slug}-g${game.gameNumber}.html`),
      );
      const purchasesOf = new Map(
        timeline.players
          .flat()
          .map((player) => [player.nickname, player.purchases]),
      );
      review.push([
        'game winner',
        `${slug} G${index + 1}`,
        winners[index],
        'inferred',
        `towers ${game.sides.map((s) => `${s.team} ${s.totals.towers}`).join(' / ')}, lords ${game.sides.map((s) => s.totals.lords).join('-')}`,
      ]);
      return {
        game_number: index + 1,
        duration_seconds: game.durationSeconds,
        winner: winners[index],
        sides: game.sides.map((side) => ({
          team: side.team,
          totals: side.totals,
          players: side.players.map((player) => {
            const purchases = purchasesOf.get(player.nickname) ?? [];
            if (purchases.length === 0)
              throw new Error(
                `${slug} G${game.gameNumber}: no item timeline for ${player.nickname}`,
              );
            const last = purchases[purchases.length - 1];
            if (last.second > game.durationSeconds + 5) {
              throw new Error(
                `${slug} G${game.gameNumber}: ${player.nickname} buys at ${last.second}s after the game ended (${game.durationSeconds}s)`,
              );
            }
            const missing = player.items.filter(
              (item) => !purchases.some((purchase) => purchase.itemId === item),
            );
            if (missing.length > 0) {
              review.push([
                'check',
                `${slug} G${game.gameNumber} ${player.nickname}`,
                missing.join(' '),
                'build vs timeline',
                'final items not in the timeline',
              ]);
            }
            player.items.forEach((item) => usedItems.add(item));
            purchases.forEach((purchase) => usedItems.add(purchase.itemId));
            if (player.emblemId) usedEmblems.add(player.emblemId);
            player.talentIds.forEach((talent) => usedTalents.add(talent));
            if (player.heroIconUrl)
              heroIcons.set(player.hero, player.heroIconUrl);
            const key = `${side.team}/${player.nickname}`;
            const entry = playerHeroes.get(key) ?? {
              team: side.team,
              heroes: [],
            };
            entry.heroes.push(player.hero);
            playerHeroes.set(key, entry);
            return {
              nickname: player.nickname,
              hero: player.hero,
              kills: player.kills,
              deaths: player.deaths,
              assists: player.assists,
              gold: player.gold,
              hero_damage: player.heroDamage,
              damage_taken: player.damageTaken,
              tower_damage: player.towerDamage,
              items: player.items,
              emblem: player.emblemId,
              // Ids the site renders without a valid icon are placeholders, not talents.
              talents: player.talentIds.filter((talent) => talents.has(talent)),
              purchases: purchases.map(({ itemId, tier, second }) => ({
                item: itemId,
                tier,
                second,
              })),
            };
          }),
        })),
      };
    });
    return {
      date: scheduled.date,
      time: scheduled.time,
      teams: codes,
      status: 'finished' as const,
      score,
      data_slug: slug,
      games,
    };
  });

  // ---- rosters of teams with no finished match this week ----
  const withData = new Set(
    [...playerHeroes.values()].map((entry) => entry.team),
  );
  for (const code of new Set(
    schedule.flatMap((match) => match.teams.map((team) => team.toUpperCase())),
  )) {
    if (withData.has(code)) continue;
    const earlier = latestFinishedWith(read('schedule.html'), code, week);
    const file = earlier?.dataSlug ? `roster-${earlier.dataSlug}.html` : null;
    if (!file || !existsSync(join(CACHE, file))) {
      review.push(['check', code, '', 'roster', 'no roster available']);
      continue;
    }
    for (const game of parseMatchPage(read(file))) {
      const side = game.sides.find(
        (candidate) =>
          teamByLogo.get(candidate.logo)?.code.toUpperCase() === code,
      );
      for (const player of side?.players ?? []) {
        const key = `${code}/${player.nickname}`;
        const entry = playerHeroes.get(key) ?? { team: code, heroes: [] };
        entry.heroes.push(player.hero);
        playerHeroes.set(key, entry);
        if (player.heroIconUrl) heroIcons.set(player.hero, player.heroIconUrl);
      }
    }
    review.push([
      'roster source',
      code,
      earlier?.dataSlug ?? '',
      'earlier week',
      'names + heroes only (no week stats)',
    ]);
  }

  // ---- players & roles ----
  const roles = assignRoles(
    [...playerHeroes].map(([key, entry]) => ({
      key,
      team: entry.team,
      lanes: entry.heroes.map(lanesOf),
    })),
  );
  const players = [...playerHeroes].map(([key, entry]) => {
    const role: Role = roles.get(key) ?? 'flex';
    review.push([
      'player role',
      key,
      role,
      'inferred from hero lanes',
      entry.heroes.join(', '),
    ]);
    return {
      nickname: key.split('/')[1],
      team: entry.team,
      role,
      heroes: entry.heroes,
    };
  });

  // ---- catalog ----
  const catalog = {
    items: Object.fromEntries(
      [...usedItems].sort().map((id) => {
        const name = equipment.get(id);
        if (!name)
          review.push(['item', id, '', 'MISSING', 'no name in Academy data']);
        else review.push(['item', id, name, 'MLBB Academy', '']);
        return [id, { name: name ?? `Item ${id}`, icon_url: ITEM_ICON(id) }];
      }),
    ),
    emblems: Object.fromEntries(
      [...usedEmblems].sort().map((id) => {
        review.push([
          'emblem',
          id,
          EMBLEM_SETS[id] ?? '',
          EMBLEM_SETS[id] ? 'identified from icon' : 'MISSING',
          '',
        ]);
        return [
          id,
          {
            name: EMBLEM_SETS[id] ?? `Emblem ${id}`,
            icon_url: EMBLEM_ICON(id),
          },
        ];
      }),
    ),
    talents: Object.fromEntries(
      [...usedTalents].sort().flatMap((id) => {
        const name = talents.get(id);
        if (!name) {
          review.push([
            'talent',
            id,
            '',
            'dropped',
            'no icon/name on the source: placeholder',
          ]);
          return [];
        }
        review.push(['talent', id, name, 'MLBB Academy', '']);
        return [[id, { name, icon_url: TALENT_ICON(id) }]];
      }),
    ),
    heroes: Object.fromEntries(
      [...heroIcons].sort().map(([hero, icon]) => {
        const lanes = lanesOf(hero);
        review.push([
          'hero',
          hero,
          lanes.join(' / '),
          HERO_LANES_MANUAL[hero] ? 'manual' : 'MLBB Academy',
          '',
        ]);
        return [hero, { icon_url: icon, lanes }];
      }),
    ),
  };

  const teams = schedule
    .flatMap((match) => match.teams.map((code) => code.toUpperCase()))
    .filter((code, index, all) => all.indexOf(code) === index)
    .sort()
    .map((code) => {
      const team = teamByCode.get(code);
      if (!team) throw new Error(`unknown team ${code}`);
      return { code, name: team.name, logo_url: team.logoUrl };
    });

  mkdirSync(OUT, { recursive: true });
  const dataset = {
    source: 'https://ph-mpl.com/schedule',
    league: 'MPL Philippines',
    season: 18,
    week,
    fetched_at: new Date().toISOString().slice(0, 10),
    teams,
    players,
    matches,
  };
  writeFileSync(
    join(OUT, `mpl-ph-s18-w${week}.json`),
    JSON.stringify(dataset, null, 1) + '\n',
  );
  writeFileSync(
    join(OUT, 'mlbb-catalog.json'),
    JSON.stringify(catalog, null, 1) + '\n',
  );
  const csv = review
    .map((row) =>
      row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','),
    )
    .join('\n');
  writeFileSync(join(OUT, 'catalog-review.csv'), csv + '\n');

  const finished = matches.filter((match) => match.status === 'finished');
  console.log(
    `week ${week}: ${teams.length} teams, ${players.length} players, ${finished.length} finished matches ` +
      `(${finished.reduce((sum, match) => sum + match.games.length, 0)} games), ${matches.length - finished.length} upcoming`,
  );
  console.log(
    `catalog: ${Object.keys(catalog.items).length} items, ${Object.keys(catalog.emblems).length} emblems, ${Object.keys(catalog.talents).length} talents, ${Object.keys(catalog.heroes).length} heroes`,
  );
  const todo = review.filter((row) =>
    /MISSING|check/.test(row.join(' ')),
  ).length;
  console.log(
    `review: ${review.length - 1} rows (${todo} need attention) -> prisma/data/catalog-review.csv`,
  );
}

main();
