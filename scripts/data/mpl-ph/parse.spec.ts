import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  durationOf,
  inferGameWinners,
  isFinished,
  latestFinishedWith,
  parseItemization,
  parseMatchPage,
  parseSchedule,
  type TeamTotals,
} from './parse';
import { assignRoles, fit } from './roles';

const fixture = (name: string) =>
  readFileSync(join(__dirname, '__fixtures__', name), 'utf8');

describe('MPL PH parsers', () => {
  it('reads a week of the schedule with scores, data links and upcoming matches', () => {
    const week = parseSchedule(fixture('schedule.html'), 8);
    expect(week).toEqual([
      {
        date: 'Thursday, 8 October 2026',
        time: '7:30 PM',
        teams: ['ONIC', 'TNC'],
        score: [2, 1],
        dataSlug: 'onic-tnc-20261008',
      },
      {
        date: 'Friday, 9 October 2026',
        time: '5:00 PM',
        teams: ['TNC', 'FLCN'],
        score: [1, 0],
        dataSlug: 'tnc-flcn-20261009',
      },
      {
        date: 'Friday, 9 October 2026',
        time: '7:30 PM',
        teams: ['TLPH', 'ONIC'],
        score: null,
        dataSlug: null,
      },
    ]);
    // A series in progress already shows a score: it is not finished.
    expect(week.map(isFinished)).toEqual([true, false, false]);
    expect(
      latestFinishedWith(fixture('schedule.html'), 'FLCN', 8)?.dataSlug,
    ).toBe('flcn-omg-20261004');
  });

  it('pairs summary totals with the right scoreboard even when the order differs', () => {
    const [game] = parseMatchPage(fixture('match.html'));
    expect(game.battleId).toBe('111');
    expect(game.durationSeconds).toBe(1200);
    const onic = game.sides.find((side) => side.logo === 'onicph-bw-400.webp')!;
    // The summary lists TNC first; ONIC's totals are the second column.
    expect(onic.totals).toMatchObject({ kills: 2, lords: 0, towers: 3 });
    expect(onic.players[0]).toEqual({
      nickname: 'K1NGKONG',
      hero: 'Aulus',
      heroIconId: '108',
      kills: 4,
      deaths: 0,
      assists: 5,
      gold: 19163,
      items: ['3462', '3207'],
      emblemId: '20007',
      talentIds: ['111', '531'],
      heroDamage: 94038,
      damageTaken: 121063,
      towerDamage: 5717,
    });
  });

  it('turns the item sequence into purchase seconds using the minute axis', () => {
    const timeline = parseItemization(fixture('items.html'));
    expect(timeline.players[0][0]).toEqual({
      nickname: 'K1NGKONG',
      purchases: [
        { itemId: '1412', tier: 1, second: 2 },
        { itemId: '3207', tier: 3, second: 1378 },
      ],
    });
    expect(timeline.players[1][0].nickname).toBe('Zaida');
    expect(timeline.players[1][0].purchases[0]).toEqual({
      itemId: '1001',
      tier: 1,
      second: 58,
    });
  });

  it('derives the game length from gold and refuses teams that disagree', () => {
    const totals = (gold: number, goldPerMinute: number) =>
      ({ gold, goldPerMinute }) as TeamTotals;
    expect(durationOf(totals(72189, 3116), totals(63474, 2740))).toBe(1390);
    expect(() => durationOf(totals(60000, 3000), totals(60000, 2000))).toThrow(
      /inconsistent/,
    );
  });

  it('infers game winners from objectives and checks them against the series score', () => {
    const side = (team: string, towers: number, lords: number) =>
      ({ team, totals: { towers, lords, gold: 0 } as TeamTotals }) as never;
    const games = [
      { sides: [side('ONIC', 8, 4), side('TNC', 6, 0)] },
      { sides: [side('ONIC', 3, 0), side('TNC', 8, 3)] },
      { sides: [side('ONIC', 9, 2), side('TNC', 1, 0)] },
    ] as never;
    expect(inferGameWinners(games, ['ONIC', 'TNC'], [2, 1])).toEqual([
      'ONIC',
      'TNC',
      'ONIC',
    ]);
    expect(() => inferGameWinners(games, ['ONIC', 'TNC'], [2, 0])).toThrow(
      /do not match/,
    );
  });

  it('assigns five distinct roles per team by best lane fit', () => {
    const lanes = {
      Aulus: ['Jungle'],
      Rafaela: ['Roam'],
      Valentina: ['Mid Lane'],
      Miya: ['Gold Lane'],
      Lukas: ['Exp Lane', 'Jungle'],
    };
    const candidate = (key: string, heroes: Array<keyof typeof lanes>) => ({
      key,
      team: 'ONIC',
      lanes: heroes.map((hero) => lanes[hero]),
    });
    const roles = assignRoles([
      candidate('a', ['Aulus', 'Aulus']),
      candidate('b', ['Lukas', 'Lukas']), // fits jungle too, but jungle is taken
      candidate('c', ['Valentina']),
      candidate('d', ['Miya']),
      candidate('e', ['Rafaela']),
    ]);
    expect(Object.fromEntries(roles)).toEqual({
      a: 'jungle',
      b: 'exp',
      c: 'mid',
      d: 'gold',
      e: 'roam',
    });
    expect(
      fit({ key: 'x', team: 't', lanes: [['Exp Lane', 'Jungle']] }, 'jungle'),
    ).toBe(1);
  });
});
