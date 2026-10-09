/**
 * Player roles are not published per match: infer them per team from the
 * lanes of the heroes each player picked. Every team gets five distinct roles,
 * chosen by the best total fit over all 120 assignments (5! is tiny), which
 * beats guessing player by player when a hero fits two lanes.
 */
export type Role = 'exp' | 'jungle' | 'mid' | 'gold' | 'roam' | 'flex';

const ROLES: Role[] = ['exp', 'jungle', 'mid', 'gold', 'roam'];
const LANE_ROLE: Record<string, Role> = {
  'Exp Lane': 'exp',
  Jungle: 'jungle',
  'Mid Lane': 'mid',
  'Gold Lane': 'gold',
  Roam: 'roam',
};

export interface RoleCandidate {
  key: string;
  team: string;
  /** Lanes of each hero the player picked (primary lane first). */
  lanes: string[][];
}

/** Primary lane counts 2, a secondary lane 1. */
export function fit(candidate: RoleCandidate, role: Role): number {
  return candidate.lanes.reduce((score, lanes) => {
    const index = lanes.findIndex((lane) => LANE_ROLE[lane] === role);
    return score + (index === 0 ? 2 : index > 0 ? 1 : 0);
  }, 0);
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map(
      (rest) => [item, ...rest],
    ),
  );
}

export function assignRoles(candidates: RoleCandidate[]): Map<string, Role> {
  const result = new Map<string, Role>();
  const teams = new Map<string, RoleCandidate[]>();
  for (const candidate of candidates)
    teams.set(candidate.team, [
      ...(teams.get(candidate.team) ?? []),
      candidate,
    ]);

  for (const members of teams.values()) {
    // The five who played most get the five lanes; any substitutes are flex.
    const ranked = [...members].sort((a, b) => b.lanes.length - a.lanes.length);
    const starters = ranked.slice(0, ROLES.length);
    let best: Role[] = [];
    let bestScore = -1;
    for (const order of permutations(ROLES.slice(0, starters.length))) {
      const score = starters.reduce(
        (sum, player, index) => sum + fit(player, order[index]),
        0,
      );
      if (score > bestScore) [best, bestScore] = [order, score];
    }
    starters.forEach((player, index) => result.set(player.key, best[index]));
    ranked
      .slice(ROLES.length)
      .forEach((player) => result.set(player.key, 'flex'));
  }
  return result;
}
