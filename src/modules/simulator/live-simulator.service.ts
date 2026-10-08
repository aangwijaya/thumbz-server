import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AdminMatchesService } from '../admin/admin-matches.service';
import { AdminService } from '../admin/admin.service';
import { MatchEventDto } from '../admin/dto/upsert-events.dto';
import { PrismaService } from '../../prisma/prisma.service';
import { seededRandom, SimState, tick } from './simulation';

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

interface MatchSim {
  state: SimState;
  names: Record<string, string>;
  ticks: number;
}

/**
 * Demo mode (LIVE_SIMULATOR=true): makes the seeded live matches "play" —
 * gold, kills, objectives, item buys — through the same ingestion services
 * the admin API uses, so caching, domain events and the realtime channel
 * are exercised exactly as in production.
 */
@Injectable()
export class LiveSimulatorService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(LiveSimulatorService.name);
  private readonly sims = new Map<string, MatchSim>();
  private readonly rand = seededRandom(Date.now() % 2 ** 31);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly matches: AdminMatchesService,
    private readonly economy: AdminService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.get<boolean>('liveSimulator')) return;
    const interval =
      this.config.get<number>('liveSimulatorIntervalMs') ?? 5_000;
    this.timer = setInterval(() => void this.step(), interval);
    this.timer.unref();
    this.logger.log(`live simulator on (every ${interval} ms)`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

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
    const result = tick(sim.state, this.rand, sim.names);
    sim.state = result.state;
    sim.ticks += 1;
    const now = new Date().toISOString();

    await this.economy.upsertEconomy(
      matchId,
      [sim.state.teamA, sim.state.teamB].map((team_id) => ({
        team_id,
        gold: sim.state.gold[team_id] ?? 0,
        recorded_at: now,
      })),
    );
    await this.matches.upsertLiveStats(
      matchId,
      sim.state.players.map((player) => ({ ...player, recorded_at: now })),
    );

    const events: MatchEventDto[] = result.kills
      .slice(0, 1)
      .map(({ killer, victim }) => ({
        team_id: killer.team_id,
        player_id: killer.player_id,
        event_type: 'kill',
        title: `${sim.names[killer.team_id] ?? 'A team'} picked off ${sim.names[victim.team_id] ?? 'an enemy'}`,
        occurred_at: now,
      }));
    if (result.objective) {
      events.push({ ...result.objective, occurred_at: now });
    }
    if (events.length > 0) {
      await this.matches.upsertEvents(matchId, events);
    }

    if (result.purchase) {
      const pool = ITEMS[result.purchase.phase];
      const item = pool[Math.floor(this.rand() * pool.length)]!;
      await this.matches.upsertEquipment(matchId, [
        {
          player_id: result.purchase.player.player_id,
          team_id: result.purchase.player.team_id,
          ...item,
          phase: result.purchase.phase,
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

  /** Resumes from the latest stored snapshots so restarts do not reset a game. */
  private async load(matchId: string): Promise<MatchSim | null> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        team_a_id: true,
        team_b_id: true,
        teamA: { select: { name: true } },
        teamB: { select: { name: true } },
      },
    });
    if (!match) return null;
    const teams = [match.team_a_id, match.team_b_id];
    const [roster, gold, snapshots] = await Promise.all([
      this.prisma.player.findMany({
        where: { team_id: { in: teams }, role: { not: 'coach' } },
        select: { id: true, team_id: true },
        orderBy: { nickname: 'asc' },
      }),
      Promise.all(
        teams.map((team_id) =>
          this.prisma.matchGoldSnapshot.findFirst({
            where: { match_id: matchId, team_id },
            orderBy: { recorded_at: 'desc' },
            select: { gold: true },
          }),
        ),
      ),
      this.prisma.playerMatchSnapshot.findMany({
        where: { match_id: matchId },
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
    };
    this.sims.set(matchId, sim);
    return sim;
  }
}
