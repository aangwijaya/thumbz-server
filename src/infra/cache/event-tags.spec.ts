import { tagsForEvent } from './event-tags';

describe('tagsForEvent', () => {
  it('invalidates the match, lists, home, its tournament and both teams', () => {
    expect(
      tagsForEvent({
        type: 'match.changed',
        matchId: 'm1',
        tournamentId: 't1',
        teamIds: ['a', 'b'],
      }),
    ).toEqual([
      'match:m1',
      'match:m1:live',
      'matches',
      'live',
      'home',
      'tournament:t1',
      'team:a',
      'team:b',
    ]);
  });

  it('keeps hot live-data invalidation narrow, except broadcasts', () => {
    expect(
      tagsForEvent({ type: 'match.live-data', matchId: 'm1', kind: 'economy' }),
    ).toEqual(['match:m1:live']);
    expect(
      tagsForEvent({
        type: 'match.live-data',
        matchId: 'm1',
        kind: 'broadcasts',
      }),
    ).toEqual(['match:m1:live', 'matches', 'live', 'home']);
  });

  it('drops the whole catalog on catalog changes', () => {
    expect(
      tagsForEvent({ type: 'catalog.changed', entity: 'team', id: 'x' }),
    ).toEqual(['catalog']);
  });

  it('ignores comment events', () => {
    expect(
      tagsForEvent({ type: 'comment.created', matchId: 'm', commentId: 'c' }),
    ).toEqual([]);
  });
});
