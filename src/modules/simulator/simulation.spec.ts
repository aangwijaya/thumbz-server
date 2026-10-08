import { seededRandom, SimState, tick } from './simulation';

function initial(): SimState {
  const player = (id: string, team: string) => ({
    player_id: id,
    team_id: team,
    kills: 0,
    deaths: 0,
    assists: 0,
    gold: 0,
    level: 1,
  });
  return {
    teamA: 'A',
    teamB: 'B',
    gold: { A: 0, B: 0 },
    players: ['a1', 'a2', 'a3', 'a4', 'a5']
      .map((id) => player(id, 'A'))
      .concat(['b1', 'b2', 'b3', 'b4', 'b5'].map((id) => player(id, 'B'))),
    objectivesTaken: 0,
  };
}

describe('live simulation tick', () => {
  const names = { A: 'Alpha', B: 'Bravo' };

  it('is deterministic for a given seed', () => {
    const a = tick(initial(), seededRandom(42), names);
    const b = tick(initial(), seededRandom(42), names);
    expect(a).toEqual(b);
  });

  it('only ever grows gold, kills, deaths and levels', () => {
    const rand = seededRandom(7);
    let state = initial();
    for (let i = 0; i < 200; i += 1) {
      const next = tick(state, rand, names).state;
      for (const team of ['A', 'B']) {
        expect(next.gold[team]).toBeGreaterThan(state.gold[team] ?? 0);
      }
      next.players.forEach((player, index) => {
        const before = state.players[index];
        expect(player.kills).toBeGreaterThanOrEqual(before.kills);
        expect(player.deaths).toBeGreaterThanOrEqual(before.deaths);
        expect(player.level).toBeLessThanOrEqual(15);
      });
      state = next;
    }
  });

  it('keeps kills and deaths balanced across teams', () => {
    const rand = seededRandom(99);
    let state = initial();
    for (let i = 0; i < 100; i += 1) state = tick(state, rand, names).state;
    const sum = (key: 'kills' | 'deaths') =>
      state.players.reduce((total, player) => total + player[key], 0);
    expect(sum('kills')).toBe(sum('deaths'));
  });

  it('names the objective after the team that took it', () => {
    const rand = seededRandom(3);
    let state = initial();
    for (let i = 0; i < 200; i += 1) {
      const result = tick(state, rand, names);
      if (result.objective) {
        expect(result.objective.title).toContain(
          names[result.objective.team_id as 'A' | 'B'],
        );
      }
      state = result.state;
    }
  });
});
