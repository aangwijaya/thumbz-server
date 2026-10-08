/**
 * Pure game-tick model for the live demo simulator: no I/O, seeded RNG, so
 * the behavior is unit-testable and reproducible.
 */
export type Rand = () => number;

/** mulberry32: tiny deterministic PRNG. */
export function seededRandom(seed: number): Rand {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export interface SimPlayer {
  player_id: string;
  team_id: string;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  level: number;
}

export interface SimState {
  teamA: string;
  teamB: string;
  gold: Record<string, number>;
  players: SimPlayer[];
  objectivesTaken: number;
}

export interface Objective {
  team_id: string;
  event_type: 'turtle' | 'tower' | 'lord';
  title: string;
}

export interface TickResult {
  state: SimState;
  kills: Array<{ killer: SimPlayer; victim: SimPlayer }>;
  objective: Objective | null;
  purchase: { player: SimPlayer; phase: 'phase2' | 'phase3' } | null;
}

const pick = <T>(rand: Rand, items: T[]): T =>
  items[Math.floor(rand() * items.length)];

const OBJECTIVES: Array<Objective['event_type']> = [
  'turtle',
  'tower',
  'tower',
  'lord',
];

export function tick(
  state: SimState,
  rand: Rand,
  teamNames: Record<string, string>,
): TickResult {
  const gold = { ...state.gold };
  const players = state.players.map((player) => ({ ...player }));
  // One team has the momentum this tick.
  const ahead = rand() < 0.5 ? state.teamA : state.teamB;
  for (const team of [state.teamA, state.teamB]) {
    const income = Math.round(500 + rand() * 700 + (team === ahead ? 250 : 0));
    gold[team] = (gold[team] ?? 0) + income;
    const roster = players.filter((player) => player.team_id === team);
    for (const player of roster) {
      player.gold += Math.round(income / Math.max(roster.length, 1));
      if (rand() < 0.2) player.level = Math.min(15, player.level + 1);
    }
  }

  const kills: TickResult['kills'] = [];
  const fights = rand() < 0.45 ? 1 + Math.floor(rand() * 2) : 0;
  for (let fight = 0; fight < fights; fight += 1) {
    const killerTeam =
      rand() < 0.6 ? ahead : ahead === state.teamA ? state.teamB : state.teamA;
    const allies = players.filter((p) => p.team_id === killerTeam);
    const enemies = players.filter((p) => p.team_id !== killerTeam);
    if (allies.length === 0 || enemies.length === 0) break;
    const killer = pick(rand, allies);
    const victim = pick(rand, enemies);
    killer.kills += 1;
    victim.deaths += 1;
    for (const ally of allies) {
      if (ally !== killer && rand() < 0.35) ally.assists += 1;
    }
    gold[killerTeam] = (gold[killerTeam] ?? 0) + 250;
    kills.push({ killer, victim });
  }

  let objective: Objective | null = null;
  if (rand() < 0.12) {
    const type = pick(rand, OBJECTIVES);
    const team =
      rand() < 0.65 ? ahead : ahead === state.teamA ? state.teamB : state.teamA;
    const name = teamNames[team] ?? 'A team';
    objective = {
      team_id: team,
      event_type: type,
      title:
        type === 'lord'
          ? `${name} secured the Lord`
          : type === 'turtle'
            ? `${name} secured the Turtle`
            : `${name} destroyed a tower`,
    };
    gold[team] = (gold[team] ?? 0) + (type === 'lord' ? 1200 : 600);
  }

  const purchase: TickResult['purchase'] =
    players.length > 0 && rand() < 0.3
      ? {
          player: pick(rand, players),
          phase: rand() < 0.5 ? 'phase2' : 'phase3',
        }
      : null;

  return {
    state: {
      ...state,
      gold,
      players,
      objectivesTaken: state.objectivesTaken + (objective ? 1 : 0),
    },
    kills,
    objective,
    purchase,
  };
}
