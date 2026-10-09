import { Injectable, Logger } from '@nestjs/common';
import { AdminMatchesService } from '../admin/admin-matches.service';
import { AdminService } from '../admin/admin.service';
import { MatchEventDto } from '../admin/dto/upsert-events.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  draftHeroes,
  resetForNextGame,
  seededRandom,
  SimState,
  tick,
  winsNeeded,
} from './simulation';

const ITEMS = {
  phase2: [
    { item_id: 'fury-hammer', item_name: 'Fury Hammer' },
    { item_id: 'elegant-gem', item_name: 'Elegant Gem' },
    { item_id: 'ares-belt', item_name: 'Ares Belt' },
    { item_id: 'magic-wand', item_name: 'Magic Wand' },
  ],
  phase3: [
    { item_id: 'war-axe', item_name: 'War Axe' },
    { item_id: 'antique-cuirass', item_name: 'Antique Cuirass' },
    { item_id: 'blade-of-despair', item_name: 'Blade of Despair' },
    { item_id: 'holy-crystal', item_name: 'Holy Crystal' },
  ],
};

/** Viewer counts drift every N ticks (each drift invalidates match lists). */
const VIEWER_DRIFT_EVERY = 6;
/** A simulated game lasts 12–16 minutes, like a real one. */
const GAME_MIN_MS = 12 * 60_000;
const GAME_SPREAD_MS = 4 * 60_000;

interface MatchSim {
  state: SimState;
  names: Record<string, string>;
  ticks: number;
  bestOf: number;
  game: number;
  gameStartedAt: number;
  gameLengthMs: number;
  heroes: Record<string, string>;
  roles: Array<{ player_id: string; role: string | null }>;
  /** No kill yet this game: the next one is first blood. */
  firstBloodPending: boolean;
}

/**
 * Demo mode (LIVE_SIMULATOR=true, ticked by the worker's live-simulator
 * job): makes the seeded live matches "play" — gold, kills, objectives,
 * item buys, game after game until a team takes the series, then the next
 * scheduled match goes live — through the same ingestion services the admin
 * API uses, so caching, domain events, realtime and push reminders are
 * exercised exactly as in production.
 */
@Injectable()
export class LiveSimulatorService {
  private readonly logger = new Logger(LiveSimulatorService.name);
  private readonly sims = new Map<string, MatchSim>();
  private readonly rand = seededRandom(Date.now() % 2 ** 31);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly matches: AdminMatchesService,
    private readonly economy: AdminService,
  ) {}

  /** One tick for every live match. Overlapping ticks are skipped. */
  async step(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const live = await this.prisma.match.findMany({
        where: { status: 'live' },
        select: { id: true },
      });
      for (const { id } of live) {
        await this.stepMatch(id).catch((error) =>
          this.logger.warn(`simulating ${id} failed: ${String(error)}`),
        );
      }
      for (const id of this.sims.keys()) {
        if (!live.some((match) => match.id === id)) this.sims.delete(id);
      }
    } finally {
      this.running = false;
    }
  }

  private async stepMatch(matchId: string): Promise<void> {
    const sim = this.sims.get(matchId) ?? (await this.load(matchId));
    if (!sim) return;
    if (Date.now() - sim.gameStartedAt >= sim.gameLengthMs) {
      await this.finishGame(matchId, sim);
      return;
    }
    const result = tick(sim.state, this.rand, sim.names);
    sim.state = result.state;
    sim.ticks += 1;
    const now = new Date().toISOString();
    const game_number = sim.game;

    await this.economy.upsertEconomy(
      matchId,
      [sim.state.teamA, sim.state.teamB].map((team_id) => ({
        team_id,
        gold: sim.state.gold[team_id] ?? 0,
        game_number,
        recorded_at: now,
      })),
    );
    await this.matches.upsertLiveStats(
      matchId,
      sim.state.players.map((player) => ({
        ...player,
        hero: sim.heroes[player.player_id] ?? null,
        game_number,
        recorded_at: now,
      })),
    );

    const events: MatchEventDto[] = result.kills
      .slice(0, 1)
      .map(({ killer, victim }) => {
        const first = sim.firstBloodPending;
        sim.firstBloodPending = false;
        const team = sim.names[killer.team_id] ?? 'A team';
        return {
          team_id: killer.team_id,
          player_id: killer.player_id,
          event_type: first ? ('first_blood' as const) : ('kill' as const),
          title: first
            ? `First blood to ${team}`
            : `${team} picked off ${sim.names[victim.team_id] ?? 'an enemy'}`,
          game_number,
          occurred_at: now,
        };
      });
    if (result.objective) {
      events.push({ ...result.objective, game_number, occurred_at: now });
    }
    if (events.length > 0) {
      await this.matches.upsertEvents(matchId, events);
    }

    if (result.purchase) {
      const pool = ITEMS[result.purchase.phase];
      const item = pool[Math.floor(this.rand() * pool.length)];
      await this.matches.upsertEquipment(matchId, [
        {
          player_id: result.purchase.player.player_id,
          team_id: result.purchase.player.team_id,
          ...item,
          phase: result.purchase.phase,
          game_number,
          purchased_at: now,
        },
      ]);
    }

    if (sim.ticks % VIEWER_DRIFT_EVERY === 0) {
      const current = await this.prisma.match.findUnique({
        where: { id: matchId },
        select: { viewer_count: true },
      });
      const base = current?.viewer_count ?? 0;
      const drift = Math.round(base * (this.rand() * 0.06 - 0.025));
      await this.matches.update(matchId, {
        viewer_count: Math.max(0, base + drift),
      });
    }
  }

  /**
   * Ends the current game (the gold leader wins), then either starts the next
   * game or — once a team has taken the series — completes the match and
   * brings the next scheduled match live so the demo never runs dry.
   */
  private async finishGame(matchId: string, sim: MatchSim): Promise<void> {
    const { teamA, teamB, gold } = sim.state;
    const winner = (gold[teamA] ?? 0) >= (gold[teamB] ?? 0) ? teamA : teamB;
    const result = await this.matches.upsertGame(matchId, sim.game, {
      status: 'completed',
      winner_team_id: winner,
    });
    const scoreA = result.data.score_a ?? 0;
    const scoreB = result.data.score_b ?? 0;
    const needed = winsNeeded(sim.bestOf);

    if (scoreA >= needed || scoreB >= needed) {
      await this.matches.setLive(matchId, {
        status: 'completed',
        score_a: scoreA,
        score_b: scoreB,
        winner_team_id: scoreA > scoreB ? teamA : teamB,
      });
      this.sims.delete(matchId);
      this.logger.log(`series ${matchId} finished ${scoreA}-${scoreB}`);
      await this.promoteNextScheduled();
      return;
    }

    sim.game += 1;
    await this.matches.upsertGame(matchId, sim.game, { status: 'live' });
    sim.state = resetForNextGame(sim.state);
    sim.gameStartedAt = Date.now();
    sim.gameLengthMs = this.gameLength();
    sim.heroes = draftHeroes(sim.roles, this.rand);
    sim.firstBloodPending = true;
  }

  private async promoteNextScheduled(): Promise<void> {
    const next = await this.prisma.match.findFirst({
      where: { status: 'scheduled' },
      orderBy: { scheduled_at: 'asc' },
      select: { id: true },
    });
    if (next) await this.matches.setLive(next.id, { status: 'live' });
  }

  private gameLength(): number {
    return GAME_MIN_MS + Math.floor(this.rand() * GAME_SPREAD_MS);
  }

  /** Resumes from the latest stored snapshots so restarts do not reset a game. */
  private async load(matchId: string): Promise<MatchSim | null> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        team_a_id: true,
        team_b_id: true,
        best_of: true,
        score_a: true,
        score_b: true,
        teamA: { select: { name: true } },
        teamB: { select: { name: true } },
        games: {
          orderBy: { game_number: 'asc' },
          select: { game_number: true, status: true, started_at: true },
        },
      },
    });
    if (!match) return null;
    const teams = [match.team_a_id, match.team_b_id];

    // A series scored before games were tracked: record those games first so
    // the score (derived from games) survives. Demo data only.
    if (match.games.length === 0) {
      const winners = [
        ...Array<string>(match.score_a ?? 0).fill(match.team_a_id),
        ...Array<string>(match.score_b ?? 0).fill(match.team_b_id),
      ];
      for (const [index, winner_team_id] of winners.entries()) {
        await this.matches.upsertGame(matchId, index + 1, {
          status: 'completed',
          winner_team_id,
        });
        match.games.push({
          game_number: index + 1,
          status: 'completed',
          started_at: null,
        });
      }
    }

    // Resume the live game, or open the next one of the series.
    let current = match.games.find((game) => game.status === 'live');
    if (!current) {
      const number = match.games.length + 1;
      await this.matches.upsertGame(matchId, number, { status: 'live' });
      current = { game_number: number, status: 'live', started_at: new Date() };
    }
    const game = current.game_number;
    const [roster, gold, snapshots] = await Promise.all([
      this.prisma.player.findMany({
        where: { team_id: { in: teams }, role: { not: 'coach' } },
        select: { id: true, team_id: true, role: true },
        orderBy: { nickname: 'asc' },
      }),
      Promise.all(
        teams.map((team_id) =>
          this.prisma.matchGoldSnapshot.findFirst({
            where: { match_id: matchId, team_id, game_number: game },
            orderBy: { recorded_at: 'desc' },
            select: { gold: true },
          }),
        ),
      ),
      this.prisma.playerMatchSnapshot.findMany({
        where: { match_id: matchId, game_number: game },
        orderBy: { recorded_at: 'desc' },
        distinct: ['player_id'],
      }),
    ]);
    const latest = new Map(snapshots.map((row) => [row.player_id, row]));
    const players = teams.flatMap((team) =>
      roster
        .filter((player) => player.team_id === team)
        .slice(0, 5)
        .map((player) => {
          const last = latest.get(player.id);
          return {
            player_id: player.id,
            team_id: team,
            kills: last?.kills ?? 0,
            deaths: last?.deaths ?? 0,
            assists: last?.assists ?? 0,
            gold: last?.gold ?? 0,
            level: last?.level ?? 1,
          };
        }),
    );
    const sim: MatchSim = {
      state: {
        teamA: match.team_a_id,
        teamB: match.team_b_id,
        gold: {
          [match.team_a_id]: gold[0]?.gold ?? 0,
          [match.team_b_id]: gold[1]?.gold ?? 0,
        },
        players,
        objectivesTaken: 0,
      },
      names: {
        [match.team_a_id]: match.teamA.name,
        [match.team_b_id]: match.teamB.name,
      },
      ticks: 0,
      bestOf: match.best_of,
      game,
      gameStartedAt: current.started_at?.getTime() ?? Date.now(),
      gameLengthMs: this.gameLength(),
      heroes: {},
      roles: [],
      firstBloodPending: snapshots.every((row) => row.kills === 0),
    };
    sim.roles = players.map((player) => ({
      player_id: player.player_id,
      role: roster.find((row) => row.id === player.player_id)?.role ?? null,
    }));
    // Keep heroes already shown for this game; draft the rest.
    sim.heroes = {
      ...draftHeroes(sim.roles, this.rand),
      ...Object.fromEntries(
        snapshots
          .filter((row) => row.hero)
          .map((row) => [row.player_id, row.hero as string]),
      ),
    };
    this.sims.set(matchId, sim);
    return sim;
  }
}
