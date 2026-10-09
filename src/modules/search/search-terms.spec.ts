import { buildSearchTerms } from './search-terms';

describe('buildSearchTerms', () => {
  it('builds a prefix tsquery from word tokens', () => {
    expect(buildSearchTerms('  ONIC   ph ').tsquery).toBe('onic:* & ph:*');
  });

  it('strips tsquery operators supplied by the user', () => {
    expect(buildSearchTerms("rrq & !(evos) | 'x':*").tsquery).toBe(
      'rrq:* & evos:* & x:*',
    );
  });

  it('returns no tsquery when there are no word characters', () => {
    expect(buildSearchTerms('!!!').tsquery).toBeNull();
  });

  it('escapes LIKE wildcards', () => {
    const terms = buildSearchTerms('100%_win\\');
    expect(terms.contains).toBe('%100\\%\\_win\\\\%');
    expect(terms.prefix).toBe('100\\%\\_win\\\\%');
  });

  it('derives a slug for exact matches', () => {
    expect(buildSearchTerms('Team Liquid ID').slug).toBe('team-liquid-id');
  });

  it('keeps non-latin letters', () => {
    expect(buildSearchTerms('Ásia Ñ').tsquery).toBe('ásia:* & ñ:*');
  });

  it('caps the number and length of tokens', () => {
    const terms = buildSearchTerms(`${'a'.repeat(50)} b c d e f g h`);
    expect(terms.tsquery?.split(' & ')).toHaveLength(6);
    expect(terms.tsquery?.startsWith(`${'a'.repeat(30)}:*`)).toBe(true);
  });
});
