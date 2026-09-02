import { buildCurrentForm, roundWinRate } from './teams.service';

describe('roundWinRate', () => {
  it('rounds to three decimals', () => {
    expect(roundWinRate(31, 42)).toBe(0.738);
    expect(roundWinRate(2, 3)).toBe(0.667);
  });

  it('returns null when no matches are played', () => {
    expect(roundWinRate(0, 0)).toBeNull();
  });

  it('returns 1 for a perfect record', () => {
    expect(roundWinRate(5, 5)).toBe(1);
  });
});

describe('buildCurrentForm', () => {
  it('maps results newest-last with W/L', () => {
    // newest first from the database (desc ended_at)
    const results = [
      { winner_team_id: 'team-1' }, // newest
      { winner_team_id: 'team-2' },
      { winner_team_id: null },
      { winner_team_id: 'team-1' }, // oldest
    ];
    expect(buildCurrentForm(results, 'team-1')).toEqual(['W', 'L', 'L', 'W']);
  });

  it('returns an empty array for no results', () => {
    expect(buildCurrentForm([], 'team-1')).toEqual([]);
  });
});
