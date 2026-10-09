/**
 * Pure parsers for ph-mpl.com pages (schedule, match data, item sequence).
 * No I/O: unit-tested against fixtures in __fixtures__/.
 */
import { load } from 'cheerio';

export interface ScheduledMatch {
  /** "Thursday, 8 October 2026" as printed. */
  date: string;
  time: string;
  teams: [string, string];
  /** null until the match is played. */
  score: [number, number] | null;
  /** ph-mpl.com/data/match/<slug>, once data exists. */
  dataSlug: string | null;
}

export interface TeamTotals {
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
}

export interface PlayerLine {
  nickname: string;
  hero: string;
  heroIconId: string | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  /** Final build, equipment ids in slot order. */
  items: string[];
  emblemId: string | null;
  talentIds: string[];
  heroDamage: number;
  damageTaken: number;
  towerDamage: number;
}

export interface GameSide {
  /** Logo file ("onicph-bw-400.webp"): the stable key across pages. */
  logo: string;
  /** Short name as on the summary ("ONIC"). */
  team: string;
  /** Full name above the scoreboard ("ONIC PH"). */
  teamFullName: string;
  totals: TeamTotals;
  players: PlayerLine[];
}

export interface ParsedGame {
  gameNumber: number;
  battleId: string | null;
  sides: [GameSide, GameSide];
  /** total gold / gold-per-minute, agreed between both teams. */
  durationSeconds: number;
}

export interface Purchase {
  itemId: string;
  /** 1 component · 2 intermediate · 3 final, as the site classifies it. */
  tier: number;
  second: number;
}

const number = (text: string): number => {
  const value = Number(text.replace(/[^\d.-]/g, ''));
  return Number.isFinite(value) ? value : 0;
};

const logoFile = (src: string | undefined): string =>
  /\/teams\/([^/?]+)$/.exec(src ?? '')?.[1] ?? '';

const fileId = (src: string | undefined): string | null =>
  src ? (/\/([^/?]+)\.(?:png|webp|jpg)/.exec(src)?.[1] ?? null) : null;

export function parseSchedule(html: string, week: number): ScheduledMatch[] {
  const $ = load(html);
  const block = $(`#week-${week}`);
  const matches: ScheduledMatch[] = [];
  block.find('.schedule-item').each((_, element) => {
    const item = $(element);
    const day = item
      .closest('.col-lg-4')
      .find('.match-category-flex')
      .first()
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const date =
      /((?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day, \d+ \w+ \d{4})/.exec(
        day,
      )?.[1] ?? day;
    const teams = item
      .find('.team-name')
      .map((__, team) => $(team).text().trim())
      .get();
    const scoreText = item
      .find('div[style*="1.5rem"]')
      .text()
      .replace(/\s+/g, ' ')
      .trim();
    const score = /^(\d+)\s*:\s*(\d+)$/.exec(scoreText);
    const link = item.find('a[href*="/data/match/"]').attr('href');
    matches.push({
      date,
      time: item.find('div').first().text().trim(),
      teams: [teams[0], teams[1]],
      score: score ? [Number(score[1]), Number(score[2])] : null,
      dataSlug: link
        ? (/\/data\/match\/([^/?#]+)/.exec(link)?.[1] ?? null)
        : null,
    });
  });
  return matches;
}

/** Regular season is best of 3: a series is over once a team has 2 wins. */
export const WINS_TO_TAKE_SERIES = 2;

export const isFinished = (match: ScheduledMatch): boolean =>
  match.score !== null && Math.max(...match.score) >= WINS_TO_TAKE_SERIES;

/** The latest finished match of `team` in the weeks before `week`. */
export function latestFinishedWith(
  html: string,
  team: string,
  week: number,
): ScheduledMatch | null {
  for (let earlier = week - 1; earlier >= 1; earlier--) {
    const found = parseSchedule(html, earlier)
      .filter((match) => isFinished(match) && match.teams.includes(team))
      .pop();
    if (found) return found;
  }
  return null;
}

export interface TeamListing {
  code: string;
  name: string;
  logoUrl: string | null;
}

export function parseTeams(html: string): TeamListing[] {
  const $ = load(html);
  return $('a[href*="ph-mpl.com/team/"]')
    .map((_, element) => {
      const link = $(element);
      const code =
        /\/team\/([a-z0-9-]+)/.exec(link.attr('href') ?? '')?.[1] ?? '';
      const src = link.find('img[src*="/teams/"]').attr('src') ?? null;
      return {
        code,
        name: link.text().replace(/\s+/g, ' ').trim(),
        // Drop the wsrv proxy prefix: the app's image loader adds its own.
        logoUrl: src ? src.replace(/^https:\/\/wsrv\.nl\/?\?url=/, '') : null,
      };
    })
    .get()
    .filter((team) => team.code);
}

const TOTAL_LABELS: Record<string, keyof TeamTotals> = {
  'Total Kills': 'kills',
  'Total Deaths': 'deaths',
  'Total Assists': 'assists',
  'Total Gold': 'gold',
  'Gold / Min': 'goldPerMinute',
  'Total Damage': 'damage',
  'Red Buff': 'redBuffs',
  'Blue Buff': 'blueBuffs',
  'Lord Kill': 'lords',
  'Tortoise Kill': 'turtles',
  'Tower Destroy': 'towers',
};

export function parseMatchPage(html: string): ParsedGame[] {
  const $ = load(html);
  const battles = new Map(
    [...html.matchAll(/loadItemSequence\('(\d+)',\s*'(\d+)'\)/g)].map(
      ([, game, battle]) => [Number(game), battle],
    ),
  );
  const games: ParsedGame[] = [];
  for (let gameNumber = 1; $(`#game${gameNumber}`).length > 0; gameNumber++) {
    const game = $(`#game${gameNumber}`);
    const teamNames = game
      .find('#summary .team-name h3')
      .map((_, element) => $(element).text().trim())
      .get();
    // Teams switch sides between games and the summary and scoreboard do not
    // share an order: pair them by logo.
    const summaryLogos = game
      .find('#summary img.team-logo')
      .map((_, element) => logoFile($(element).attr('src')))
      .get();
    const totals: [Partial<TeamTotals>, Partial<TeamTotals>] = [{}, {}];
    game.find('#summary .stats-divider').each((_, element) => {
      const key = TOTAL_LABELS[$(element).text().trim()];
      if (!key) return;
      const values = $(element)
        .parent()
        .find('.stats-num')
        .map((__, cell) => number($(cell).text()))
        .get();
      totals[0][key] = values[0] ?? 0;
      totals[1][key] = values[1] ?? 0;
    });

    const tables = game.find('#scoreboard table').toArray();
    const sides = tables.slice(0, 2).map((table): GameSide => {
      const heading = $(table).closest('div').prevAll().first();
      const fullName = heading.text().replace(/\s+/g, ' ').trim();
      const logo = logoFile(heading.find('img').attr('src'));
      const index = summaryLogos.indexOf(logo);
      if (!logo || index < 0)
        throw new Error(
          `game ${gameNumber}: cannot pair scoreboard "${fullName}" with the summary`,
        );
      const players = $(table)
        .find('tbody tr')
        .map((_, row): PlayerLine => {
          const cells = $(row)
            .find('td')
            .toArray()
            .map((cell) => $(cell));
          const images = (cell: (typeof cells)[number]) =>
            cell
              .find('img')
              .map((__, image) => fileId($(image).attr('src')))
              .get()
              .filter(Boolean);
          return {
            nickname: cells[0].text().trim(),
            hero: cells[1].text().trim(),
            heroIconId: fileId(cells[1].find('img').attr('src')),
            kills: number(cells[2].text()),
            deaths: number(cells[3].text()),
            assists: number(cells[4].text()),
            gold: number(cells[6].text()),
            items: images(cells[7]),
            emblemId: images(cells[8])[0] ?? null,
            talentIds: images(cells[9]),
            heroDamage: number(cells[10].text()),
            damageTaken: number(cells[11].text()),
            towerDamage: number(cells[12].text()),
          };
        })
        .get();
      return {
        logo,
        team: teamNames[index] ?? fullName,
        teamFullName: fullName,
        totals: totals[index] as TeamTotals,
        players,
      };
    });
    if (sides.length !== 2)
      throw new Error(
        `game ${gameNumber}: expected 2 scoreboards, got ${sides.length}`,
      );

    games.push({
      gameNumber,
      battleId: battles.get(gameNumber) ?? null,
      sides: [sides[0], sides[1]],
      durationSeconds: durationOf(sides[0].totals, sides[1].totals),
    });
  }
  return games;
}

/** Game length from total gold / gold per minute; both teams must agree (±3 s). */
export function durationOf(a: TeamTotals, b: TeamTotals): number {
  const estimate = (totals: TeamTotals) =>
    (totals.gold / totals.goldPerMinute) * 60;
  const [x, y] = [estimate(a), estimate(b)];
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x - y) > 3) {
    throw new Error(
      `inconsistent game length: ${x.toFixed(1)}s vs ${y.toFixed(1)}s`,
    );
  }
  return Math.round((x + y) / 2);
}

export interface ItemTimeline {
  /** Team header as printed in the item sequence ("ONIC PH"). */
  teams: [string, string];
  /** Per team, per player in scoreboard order. */
  players: [
    { nickname: string; purchases: Purchase[] }[],
    { nickname: string; purchases: Purchase[] }[],
  ];
}

/**
 * Item sequence: icons placed along a minutes axis with `left: x%`. The axis
 * labels (00, 02, …) calibrate seconds per percent, so purchase times do not
 * depend on how the page pads the axis.
 */
export function parseItemization(html: string): ItemTimeline {
  const $ = load(html);
  const percent = (style: string | undefined) =>
    Number(/left:\s*([\d.]+)%/.exec(style ?? '')?.[1] ?? NaN);
  const labels = $('*')
    .filter(
      (_, element) =>
        /^\s*\d{2}\s*$/.test($(element).text()) &&
        $(element).children().length === 0,
    )
    .toArray()
    .map((element) => ({
      minute: Number($(element).text().trim()),
      left: percent($(element).attr('style')),
    }))
    .filter((label) => Number.isFinite(label.left) && label.minute > 0);
  if (labels.length === 0) throw new Error('item sequence: no minute axis');
  const secondsPerPercent = (labels[0].minute * 60) / labels[0].left;

  const names = $('.player-name')
    .map((_, element) => $(element).text().trim())
    .get();
  const teamTitles = $('img[alt]')
    .map((_, element) => $(element).attr('alt') ?? '')
    .get()
    .filter(Boolean);

  const side = (selector: string, offset: number) =>
    $(selector)
      .find('.team-player-equips')
      .map((index, row) => ({
        nickname: names[offset + index] ?? `player-${offset + index}`,
        purchases: $(row)
          .find('.item-dots')
          .map((__, dot): Purchase => ({
            itemId: fileId($(dot).find('img').attr('src')) ?? '',
            tier: Number(
              /tier-(\d)/.exec(
                $(dot).find('.equip-item-img').attr('class') ?? '',
              )?.[1] ?? 0,
            ),
            second: Math.round(
              percent($(dot).attr('style')) * secondsPerPercent,
            ),
          }))
          .get()
          .filter((purchase) => purchase.itemId),
      }))
      .get();

  const first = side('.team1-equips', 0);
  return {
    teams: [teamTitles[0] ?? '', teamTitles[1] ?? ''],
    players: [first, side('.team2-equips', first.length)],
  };
}

/**
 * The site does not mark who won each game, only the series score. Pick the
 * winner per game by objectives (towers, then lords, then gold) and require
 * the result to match the series score; otherwise fail loudly for review.
 */
export function inferGameWinners(
  games: ParsedGame[],
  teams: [string, string],
  score: [number, number],
): string[] {
  const winners = games.map((game) => {
    const [x, y] = game.sides;
    const rank = (side: GameSide) => [
      side.totals.towers,
      side.totals.lords,
      side.totals.gold,
    ];
    const [rx, ry] = [rank(x), rank(y)];
    for (let index = 0; index < rx.length; index++) {
      if (rx[index] !== ry[index])
        return rx[index] > ry[index] ? x.team : y.team;
    }
    return x.team;
  });
  const wins = teams.map(
    (team) => winners.filter((winner) => winner === team).length,
  );
  if (wins[0] !== score[0] || wins[1] !== score[1]) {
    throw new Error(
      `inferred game winners ${winners.join(',')} do not match the series score ${score.join('-')}`,
    );
  }
  return winners;
}
