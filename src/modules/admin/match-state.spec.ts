import { validateCompletedMatch, validateTransition } from './match-state';

describe('validateTransition', () => {
  it('allows staying in the same status', () => {
    expect(validateTransition('scheduled', 'scheduled')).toBeNull();
    expect(validateTransition('live', 'live')).toBeNull();
    expect(validateTransition('completed', 'completed')).toBeNull();
  });

  it.each([
    ['scheduled', 'live'],
    ['scheduled', 'cancelled'],
    ['scheduled', 'postponed'],
    ['live', 'completed'],
    ['live', 'cancelled'],
    ['live', 'postponed'],
  ])('allows %s -> %s', (from, to) => {
    expect(validateTransition(from as never, to as never)).toBeNull();
  });

  it.each([
    ['completed', 'live'],
    ['completed', 'scheduled'],
    ['cancelled', 'scheduled'],
    ['postponed', 'scheduled'],
    ['live', 'scheduled'],
    ['cancelled', 'live'],
    ['cancelled', 'completed'],
    ['postponed', 'completed'],
  ])('rejects %s -> %s', (from, to) => {
    expect(validateTransition(from as never, to as never)).toMatch(
      /Invalid status transition/,
    );
  });
});

describe('validateCompletedMatch', () => {
  const teamA = '11111111-1111-4111-8111-111111111111';
  const teamB = '22222222-2222-4222-8222-222222222222';

  it('accepts a consistent winner', () => {
    expect(validateCompletedMatch(2, 1, teamA, teamA, teamB)).toBeNull();
  });

  it('requires scores', () => {
    expect(validateCompletedMatch(null, 1, teamA, teamA, teamB)).toMatch(
      /score_a and score_b/,
    );
    expect(validateCompletedMatch(2, null, teamA, teamA, teamB)).toMatch(
      /score_a and score_b/,
    );
  });

  it('requires a winner', () => {
    expect(validateCompletedMatch(2, 1, null, teamA, teamB)).toMatch(
      /winner_team_id/,
    );
  });

  it('requires the winner to be one of the teams', () => {
    expect(
      validateCompletedMatch(
        2,
        1,
        '33333333-3333-4333-8333-333333333333',
        teamA,
        teamB,
      ),
    ).toMatch(/one of the match teams/);
  });

  it('rejects equal scores', () => {
    expect(validateCompletedMatch(1, 1, teamA, teamA, teamB)).toMatch(
      /cannot be equal/,
    );
  });

  it('rejects a winner that does not have the higher score', () => {
    expect(validateCompletedMatch(1, 2, teamA, teamA, teamB)).toMatch(
      /higher score/,
    );
  });
});
