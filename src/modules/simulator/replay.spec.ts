import {
  finalStatistics,
  purchasesBetween,
  RecordedPlayer,
  Recording,
  recordingAt,
  timelineOf,
  winsNeeded,
} from './replay';

const player = (
  player_id: string,
  team_id: string,
  stats: Partial<RecordedPlayer>,
): RecordedPlayer => ({
  player_id,
  team_id,
  hero: `Hero ${player_id}`,
  hero_icon_url: null,
  kills: 0,
  deaths: 0,
  assists: 0,
  gold: 10_000,
  damage: 80_000,
  damage_taken: 50_000,
  tower_damage: 1_000,
  emblem: null,
  talents: [],
  items: [],
  purchases: [],
  ...stats,
});

const recording: Recording = {
  match_id: 'm1',
  game_number: 1,
  duration_seconds: 1_200,
  winner_team_id: 'A',
  script: {
    players: [
      player('a1', 'A', {
        kills: 6,
        deaths: 1,
        assists: 4,
        purchases: [
          {
            item_id: '1',
            item_name: 'Knife',
            icon_url: null,
            tier: 1,
            second: 0,
          },
          {
            item_id: '2',
            item_name: 'Blade of Despair',
            icon_url: null,
            tier: 3,
            second: 640,
          },
        ],
      }),
      player('a2', 'A', { kills: 2, deaths: 2, assists: 9 }),
      // More deaths than the other team has kills: one death by a tower.
      player('b1', 'B', { kills: 3, deaths: 5, assists: 1 }),
      player('b2', 'B', { kills: 0, deaths: 4, assists: 2 }),
    ],
    teams: [
      {
        team_id: 'A',
        kills: 8,
        deaths: 3,
        assists: 13,
        gold: 20_000,
        towers: 7,
        lords: 2,
        turtles: 2,
        details: { red_buffs: 4 },
      },
      {
        team_id: 'B',
        kills: 3,
        deaths: 8,
        assists: 3,
        gold: 20_000,
        towers: 2,
        lords: 0,
        turtles: 1,
        details: {},
      },
    ],
  },
};

describe('replay', () => {
  const timeline = timelineOf(recording);

  it('reconstructs a deterministic timeline with the real counts', () => {
    expect(timelineOf(recording)).toEqual(timeline);
    const of = (kind: string, team?: string) =>
      timeline.filter(
        (m) =>
          m.kind === kind && (!team || ('team_id' in m && m.team_id === team)),
      ).length;
    expect(of('kill', 'A')).toBe(8);
    expect(of('kill', 'B')).toBe(3);
    expect(of('tower', 'A')).toBe(7);
    expect(of('lord', 'A')).toBe(2);
    expect(of('turtle', 'B')).toBe(1);
    // A's 8 kills cover 8 of B's 9 deaths; the last one is a lone death.
    expect(of('death')).toBe(1);
    for (const moment of timeline) {
      expect(moment.second).toBeGreaterThanOrEqual(0);
      expect(moment.second).toBeLessThanOrEqual(recording.duration_seconds);
      if (moment.kind === 'lord')
        expect(moment.second).toBeGreaterThanOrEqual(480);
      if (moment.kind === 'turtle')
        expect(moment.second).toBeGreaterThanOrEqual(120);
    }
    const seconds = timeline.map((m) => m.second);
    expect(seconds).toEqual([...seconds].sort((a, b) => a - b));
  });

  it('starts from nothing and ends exactly on the real final stats', () => {
    const start = recordingAt(recording, timeline, 0);
    expect(start.players.every((p) => p.kills === 0 && p.gold === 0)).toBe(
      true,
    );
    expect(start.players[0].level).toBe(1);

    const end = recordingAt(recording, timeline, 99_999);
    expect(end.second).toBe(1_200);
    for (const [index, p] of recording.script.players.entries()) {
      expect(end.players[index]).toMatchObject({
        kills: p.kills,
        deaths: p.deaths,
        assists: p.assists,
        gold: p.gold,
        damage: p.damage,
        damage_taken: p.damage_taken,
        level: 15,
      });
    }
    expect(end.gold).toEqual({ A: 20_000, B: 20_000 });
  });

  it('grows monotonically through the game', () => {
    let previous = recordingAt(recording, timeline, 0);
    for (let t = 30; t <= 1_200; t += 30) {
      const current = recordingAt(recording, timeline, t);
      for (const [index, p] of current.players.entries()) {
        const before = previous.players[index];
        expect(p.kills).toBeGreaterThanOrEqual(before.kills);
        expect(p.deaths).toBeGreaterThanOrEqual(before.deaths);
        expect(p.assists).toBeGreaterThanOrEqual(before.assists);
        expect(p.gold).toBeGreaterThanOrEqual(before.gold);
      }
      previous = current;
    }
  });

  it('replays purchases at their real seconds', () => {
    expect(purchasesBetween(recording, -1, 0).map((p) => p.item_name)).toEqual([
      'Knife',
    ]);
    expect(purchasesBetween(recording, 0, 639)).toEqual([]);
    expect(purchasesBetween(recording, 0, 640)).toEqual([
      expect.objectContaining({
        item_name: 'Blade of Despair',
        player_id: 'a1',
        team_id: 'A',
        tier: 3,
      }),
    ]);
  });

  it('maps the final statistics with an MVP from the winning team', () => {
    const stats = finalStatistics(recording);
    expect(stats.game_number).toBe(1);
    expect(stats.teams[0]).toMatchObject({
      towers_destroyed: 7,
      game_duration_seconds: 1_200,
      details: { red_buffs: 4, lords: 2, turtles: 2 },
    });
    expect(stats.players.filter((p) => p.mvp).map((p) => p.player_id)).toEqual([
      'a1',
    ]);
  });

  it('knows how many wins take a series', () => {
    expect(winsNeeded(3)).toBe(2);
    expect(winsNeeded(5)).toBe(3);
  });
});
