import { rankStandings } from './tournaments.service';

describe('rankStandings', () => {
  it('sorts by wins desc, then win_rate desc, then name asc', () => {
    const ranked = rankStandings([
      { team_id: 'c', name: 'C Team', played: 2, wins: 1 },
      { team_id: 'b', name: 'B Team', played: 2, wins: 2 },
      { team_id: 'a', name: 'A Team', played: 3, wins: 2 },
    ]);

    expect(ranked.map((r) => r.team_id)).toEqual(['b', 'a', 'c']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3]);
    expect(ranked.map((r) => r.losses)).toEqual([0, 1, 1]);
    expect(ranked[1]?.win_rate).toBe(0.667);
  });

  it('shares ranks for equal wins and win_rate (1, 1, 3)', () => {
    const ranked = rankStandings([
      { team_id: 'b', name: 'B Team', played: 2, wins: 1 },
      { team_id: 'c', name: 'C Team', played: 2, wins: 0 },
      { team_id: 'a', name: 'A Team', played: 2, wins: 1 },
    ]);

    expect(ranked.map((r) => r.team_id)).toEqual(['a', 'b', 'c']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 3]);
  });

  it('carries ranks through ties of more than two teams (1, 1, 1, 4)', () => {
    const ranked = rankStandings([
      { team_id: 'c', name: 'C Team', played: 1, wins: 1 },
      { team_id: 'a', name: 'A Team', played: 1, wins: 1 },
      { team_id: 'd', name: 'D Team', played: 1, wins: 0 },
      { team_id: 'b', name: 'B Team', played: 1, wins: 1 },
    ]);

    expect(ranked.map((r) => r.team_id)).toEqual(['a', 'b', 'c', 'd']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 1, 1, 4]);
  });

  it('breaks win ties by win_rate', () => {
    const ranked = rankStandings([
      { team_id: 'b', name: 'B Team', played: 2, wins: 2 }, // win_rate 1.0
      { team_id: 'a', name: 'A Team', played: 4, wins: 2 }, // win_rate 0.5
    ]);

    expect(ranked.map((r) => r.team_id)).toEqual(['b', 'a']);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('returns an empty list for no input', () => {
    expect(rankStandings([])).toEqual([]);
  });
});
