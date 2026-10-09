const MAX_TOKENS = 6;
const MAX_TOKEN_LENGTH = 30;

export interface SearchTerms {
  /** Normalized query (trimmed, single spaces). */
  q: string;
  /** Prefix tsquery ("onic:* & ph:*"), or null when q has no word characters. */
  tsquery: string | null;
  /** ILIKE patterns with %, _ and \ escaped. */
  contains: string;
  prefix: string;
  /** q as a slug, for exact slug hits ("onic ph" -> "onic-ph"). */
  slug: string;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * Derives every bound parameter the search SQL needs from raw user input.
 * Tokens keep only letters and digits, so the tsquery can never carry
 * operators (&, |, !, :, parentheses) supplied by the user.
 */
export function buildSearchTerms(raw: string): SearchTerms {
  const q = raw.trim().replace(/\s+/g, ' ');
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
    .slice(0, MAX_TOKENS)
    .map((token) => token.slice(0, MAX_TOKEN_LENGTH));
  const escaped = escapeLike(q);
  return {
    q,
    tsquery:
      tokens.length > 0
        ? tokens.map((token) => `${token}:*`).join(' & ')
        : null,
    contains: `%${escaped}%`,
    prefix: `${escaped}%`,
    slug: q
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-|-$/g, ''),
  };
}
