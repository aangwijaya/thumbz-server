/**
 * Pure model of a recorded game played back live (no I/O, seeded RNG).
 *
 * A recording holds what a real game ended with: per player the hero, final
 * K/D/A, gold and damage, the build and every item purchase with its second;
 * per team the objective counts. Purchases are replayed at their real
 * seconds. Kills, deaths, assists and objectives keep their real counts; only
 * their times are reconstructed (deterministically per game, so a restarted
 * worker replays the same game). At the recorded duration every value is
 * exactly the real final one.
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

/** FNV-1a: a stable seed from a string. */
export function hashSeed(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Games a team must win to take a best-of-N series. */
export const winsNeeded = (bestOf: number): number =>
  Math.floor(bestOf / 2) + 1;

export interface RecordedAsset {
  id: string;
  name: string;
  icon_url: string | null;
}

export interface RecordedPurchase {
  item_id: string;
  item_name: string;
  icon_url: string | null;
  /** 1 component · 2 intermediate · 3 final. */
  tier: number | null;
  /** Seconds after the game started. */
  second: number;
}

export interface RecordedPlayer {
  player_id: string;
  team_id: string;
  hero: string;
  hero_icon_url: string | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damage: number;
  damage_taken: number;
  tower_damage: number;
  emblem: RecordedAsset | null;
  talents: RecordedAsset[];
  /** Final build, slot order. */
  items: RecordedAsset[];
  purchases: RecordedPurchase[];
}

export interface RecordedTeam {
  team_id: string;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  towers: number;
  lords: number;
  turtles: number;
  /** Extra real totals (buffs, gold per minute, damage). */
  details: Record<string, number>;
}

export interface GameScript {
  players: RecordedPlayer[];
  teams: RecordedTeam[];
}

export interface Recording {
  match_id: string;
  game_number: number;
  duration_seconds: number;
  winner_team_id: string;
  script: GameScript;
}

export type Moment =
  | {
      second: number;
      kind: 'kill';
      team_id: string;
      killer_id: string;
      /** null: a kill whose victim's death the data does not list. */
      victim_id: string | null;
      assist_ids: string[];
    }
  | { second: number; kind: 'death'; player_id: string }
  | {
      second: number;
      kind: 'tower' | 'turtle' | 'lord';
      team_id: string;
    };

/** Turtles spawn at 2:00, the Lord at 8:00 (MLBB). */
const TURTLE_FROM = 120;
const LORD_FROM = 480;
/** Seconds a fight lasts: kills inside it land close together. */
const FIGHT_SPREAD = 12;

const shuffle = <T>(items: T[], rand: Rand): T[] => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

/** n sorted seconds in [from, to), denser later in the game (fights escalate). */
function spread(n: number, from: number, to: number, rand: Rand): number[] {
  if (n <= 0 || to <= from) return [];
  return Array.from({ length: n }, () =>
    Math.floor(from + (to - from) * Math.pow(rand(), 0.75)),
  ).sort((a, b) => a - b);
}

/**
 * Every kill, death and objective of the game with its second. Counts are
 * the real ones; deaths are paired with the other team's kills where they
 * can be.
 */
export function timelineOf(recording: Recording): Moment[] {
  const { script, duration_seconds: duration } = recording;
  const rand = seededRandom(
    hashSeed(`${recording.match_id}:${recording.game_number}`),
  );
  const teams = [...new Set(script.players.map((p) => p.team_id))];
  const moments: Moment[] = [];
  const end = Math.max(1, duration - 3);

  const totalKills = script.players.reduce((sum, p) => sum + p.kills, 0);
  const fights = spread(
    Math.max(1, Math.ceil(totalKills / 2.5)),
    Math.min(90, end / 4),
    end,
    rand,
  );
  const fightSecond = () =>
    Math.min(
      end,
      fights[Math.floor(rand() * fights.length)] +
        Math.floor(rand() * FIGHT_SPREAD),
    );

  for (const team of teams) {
    const allies = script.players.filter((p) => p.team_id === team);
    const enemies = script.players.filter((p) => p.team_id !== team);
    const killers = shuffle(
      allies.flatMap((p) => Array<string>(p.kills).fill(p.player_id)),
      rand,
    );
    const victims = shuffle(
      enemies.flatMap((p) => Array<string>(p.deaths).fill(p.player_id)),
      rand,
    );
    const seconds = Array.from(killers, fightSecond).sort((a, b) => a - b);
    const kills = killers.map((killer_id, index) => ({
      second: seconds[index],
      kind: 'kill' as const,
      team_id: team,
      killer_id,
      victim_id: victims[index] ?? null,
      assist_ids: [] as string[],
    }));
    // Each assist goes to one of the team's kills the player did not make.
    for (const ally of allies) {
      const open = kills.filter((kill) => kill.killer_id !== ally.player_id);
      for (const kill of shuffle(open, rand).slice(0, ally.assists)) {
        kill.assist_ids.push(ally.player_id);
      }
      // More assists than kills to share: repeat on random ones.
      for (let extra = ally.assists - open.length; extra > 0; extra--) {
        if (open.length === 0) break;
        open[Math.floor(rand() * open.length)].assist_ids.push(ally.player_id);
      }
    }
    moments.push(...kills);
    // Deaths beyond the other team's kills (towers, creeps): their own time.
    for (const victim of victims.slice(killers.length)) {
      moments.push({ second: fightSecond(), kind: 'death', player_id: victim });
    }
  }

  for (const team of script.teams) {
    const objective = (
      kind: 'tower' | 'turtle' | 'lord',
      count: number,
      from: number,
    ) => {
      for (const second of spread(count, Math.min(from, end - 1), end, rand)) {
        moments.push({ second, kind, team_id: team.team_id });
      }
    };
    objective('turtle', team.turtles, TURTLE_FROM);
    objective('lord', team.lords, LORD_FROM);
    objective('tower', team.towers, 180);
  }

  return moments.sort((a, b) => a.second - b.second);
}

export interface PlayerState {
  player_id: string;
  team_id: string;
  hero: string;
  hero_icon_url: string | null;
  kills: number;
  deaths: number;
  assists: number;
  gold: number;
  damage: number;
  damage_taken: number;
  level: number;
}

export interface GameState {
  second: number;
  players: PlayerState[];
  gold: Record<string, number>;
}

const curve = (final: number, progress: number, power: number) =>
  Math.round(final * Math.pow(progress, power));

/** The state of the game at second t (clamped to the game). */
export function recordingAt(
  recording: Recording,
  timeline: Moment[],
  t: number,
): GameState {
  const duration = recording.duration_seconds;
  const second = Math.max(0, Math.min(t, duration));
  const progress = duration > 0 ? second / duration : 1;
  const past = timeline.filter((moment) => moment.second <= second);
  const count = (match: (moment: Moment) => boolean) =>
    past.filter(match).length;

  const players = recording.script.players.map((p): PlayerState => {
    const done = second >= duration;
    const id = p.player_id;
    return {
      player_id: id,
      team_id: p.team_id,
      hero: p.hero,
      hero_icon_url: p.hero_icon_url,
      kills: done
        ? p.kills
        : count((m) => m.kind === 'kill' && m.killer_id === id),
      deaths: done
        ? p.deaths
        : count(
            (m) =>
              (m.kind === 'kill' && m.victim_id === id) ||
              (m.kind === 'death' && m.player_id === id),
          ),
      assists: done
        ? p.assists
        : count((m) => m.kind === 'kill' && m.assist_ids.includes(id)),
      gold: curve(p.gold, progress, 1.15),
      damage: curve(p.damage, progress, 1.4),
      damage_taken: curve(p.damage_taken, progress, 1.2),
      level: Math.min(15, 1 + Math.floor(14 * Math.min(1, progress * 1.3))),
    };
  });

  const gold: Record<string, number> = {};
  for (const player of players) {
    gold[player.team_id] = (gold[player.team_id] ?? 0) + player.gold;
  }
  return { second, players, gold };
}

/** Purchases made in (after, upTo], in order: the real item sequence. */
export function purchasesBetween(
  recording: Recording,
  after: number,
  upTo: number,
): Array<RecordedPurchase & { player_id: string; team_id: string }> {
  return recording.script.players
    .flatMap((p) =>
      p.purchases.map((purchase) => ({
        ...purchase,
        player_id: p.player_id,
        team_id: p.team_id,
      })),
    )
    .filter((purchase) => purchase.second > after && purchase.second <= upTo)
    .sort((a, b) => a.second - b.second);
}

/** Final per-game statistics, as the admin statistics endpoint takes them. */
export function finalStatistics(recording: Recording) {
  const { script } = recording;
  const mvp = mvpOf(recording);
  return {
    game_number: recording.game_number,
    teams: script.teams.map((team) => ({
      team_id: team.team_id,
      kills: team.kills,
      deaths: team.deaths,
      assists: team.assists,
      gold: team.gold,
      towers_destroyed: team.towers,
      game_duration_seconds: recording.duration_seconds,
      details: {
        ...team.details,
        lords: team.lords,
        turtles: team.turtles,
      },
    })),
    players: script.players.map((p) => ({
      player_id: p.player_id,
      team_id: p.team_id,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      gold: p.gold,
      damage: p.damage,
      damage_taken: p.damage_taken,
      tower_damage: p.tower_damage,
      level: 15,
      hero_picked: p.hero,
      hero_icon_url: p.hero_icon_url,
      emblem: p.emblem,
      talents: p.talents,
      items: p.items,
      mvp: p.player_id === mvp,
    })),
  };
}

/** The game's MVP: best (kills + assists) / deaths on the winning team. */
export function mvpOf(recording: Recording): string | null {
  const score = (p: RecordedPlayer) =>
    (p.kills + p.assists) / Math.max(1, p.deaths) + p.damage / 1e6;
  const winners = recording.script.players.filter(
    (p) => p.team_id === recording.winner_team_id,
  );
  return [...winners].sort((a, b) => score(b) - score(a))[0]?.player_id ?? null;
}
