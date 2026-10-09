import { Injectable, Logger } from '@nestjs/common';
import { AdminMatchesService } from '../admin/admin-matches.service';
import { AdminService } from '../admin/admin.service';
import { MatchEventDto } from '../admin/dto/upsert-events.dto';
import { PrismaService } from '../../prisma/prisma.service';
import {
  finalStatistics,
  GameScript,
  Moment,
  purchasesBetween,
  Recording,
  recordingAt,
  seededRandom,
  timelineOf,
  winsNeeded,
} from './replay';

/** Pause between games of a series (draft), and before a series restarts. */
const BREAK_MS = 2 * 60_000;
/** Viewer counts drift every N ticks (each drift invalidates match lists). */
const VIEWER_DRIFT_EVERY = 6;
/** Gold history written when a game is picked up mid-way (chart resolution). */
const BACKFILL_STEP_SECONDS = 30;
/** Upcoming matches about to start move a day later (they stay "upcoming"). */
const ROLL_CHECK_MS = 10 * 60_000;
const ROLL_WITHIN_MS = 20 * 60_000;
const DAY_MS = 24 * 60 * 60_000;

interface Replay {
  bestOf: number;
  teamNames: Record<string, string>;
  nicknames: Record<string, string>;
  recordings: Map<number, Recording>;
  timelines: Map<number, Moment[]>;
  /** The game being played back, once resumed. */
  game: number | null;
  /** Seconds of the game already written (events / item purchases). */
  eventsUpTo: number;
  itemsUpTo: number;
  ticks: number;
}

/**
 * Demo mode (LIVE_SIMULATOR=true, ticked by the worker's live-simulator
 * job): live matches replay real recorded games (match_game_recordings) in
 * real time — stats, item purchases at their real seconds, kills and
 * objectives, the real winner at the real duration — game after game; when a
 * series is over it starts again, so the demo always has live matches.
 * Everything goes through the same ingestion services the admin API uses, so
 * caching, domain events, realtime and push are exercised as in production.
 */
@Injectable()
export class LiveSimulatorService {
  private readonly logger = new Logger(LiveSimulatorService.name);
  private readonly replays = new Map<string, Replay | null>();
  private readonly rand = seededRandom(Date.now() % 2 ** 31);
  private running = false;
  private lastRoll = 0;

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
        await this.replayMatch(id).catch((error) =>
          this.logger.warn(`replaying ${id} failed: ${String(error)}`),
        );
      }
      for (const id of this.replays.keys()) {
        if (!live.some((match) => match.id === id)) this.replays.delete(id);
      }
      await this.rollCalendar();
    } finally {
      this.running = false;
    }
  }

  /** One tick of one live match (public for tests). */
  async replayMatch(matchId: string): Promise<void> {
    if (!this.replays.has(matchId)) {
      this.replays.set(matchId, await this.load(matchId));
    }
    const replay = this.replays.get(matchId);
    if (!replay) return; // live, but nothing recorded to play back

    const games = await this.prisma.matchGame.findMany({
      where: { match_id: matchId },
      orderBy: { game_number: 'asc' },
      select: {
        game_number: true,
        status: true,
        started_at: true,
        ended_at: true,
        winner_team_id: true,
      },
    });
    const now = Date.now();
    const live = games.find((game) => game.status === 'live');

    if (live) {
      const recording = replay.recordings.get(live.game_number);
      if (!recording) {
        await this.restart(matchId, replay);
        return;
      }
      const startedAt = live.started_at?.getTime() ?? now;
      if (replay.game !== live.game_number) {
        await this.resume(matchId, replay, recording, startedAt);
      }
      const elapsed = (now - startedAt) / 1000;
      await this.play(matchId, replay, recording, startedAt, elapsed);
      if (elapsed >= recording.duration_seconds) {
        await this.finishGame(matchId, replay, recording, startedAt);
      } else {
        await this.driftViewers(matchId, replay);
      }
      return;
    }

    const last = games.at(-1);
    if (!last) {
      await this.startGame(matchId, replay, 1);
      return;
    }
    if (now - (last.ended_at?.getTime() ?? 0) < BREAK_MS) return;
    const wins = new Map<string, number>();
    for (const game of games) {
      if (!game.winner_team_id) continue;
      wins.set(game.winner_team_id, (wins.get(game.winner_team_id) ?? 0) + 1);
    }
    const decided = Math.max(0, ...wins.values()) >= winsNeeded(replay.bestOf);
    const next = last.game_number + 1;
    if (decided || !replay.recordings.has(next)) {
      await this.restart(matchId, replay);
      return;
    }
    await this.startGame(matchId, replay, next);
  }

  private async startGame(
    matchId: string,
    replay: Replay,
    game: number,
  ): Promise<void> {
    await this.matches.upsertGame(matchId, game, {
      status: 'live',
      started_at: new Date().toISOString(),
    });
    replay.game = game;
    replay.eventsUpTo = -1;
    replay.itemsUpTo = -1;
  }

  /** The series is over (or has nothing more recorded): play it again. */
  private async restart(matchId: string, replay: Replay): Promise<void> {
    await this.matches.restartSeries(matchId);
    this.logger.log(`series ${matchId} restarts from game 1`);
    await this.startGame(matchId, replay, 1);
  }

  /**
   * Picks a game up where the stored data ends (worker restart, or a game
   * the seed started in the past): written events and purchases are not
   * repeated, and a missing gold history is filled in.
   */
  private async resume(
    matchId: string,
    replay: Replay,
    recording: Recording,
    startedAt: number,
  ): Promise<void> {
    const game = recording.game_number;
    const [event, item, gold] = await Promise.all([
      this.prisma.matchEvent.findFirst({
        where: { match_id: matchId, game_number: game },
        orderBy: { occurred_at: 'desc' },
        select: { occurred_at: true },
      }),
      this.prisma.matchItemEvent.findFirst({
        where: { match_id: matchId, game_number: game },
        orderBy: { purchased_at: 'desc' },
        select: { purchased_at: true },
      }),
      this.prisma.matchGoldSnapshot.count({
        where: { match_id: matchId, game_number: game },
      }),
    ]);
    const secondOf = (at: Date | undefined) =>
      at ? (at.getTime() - startedAt) / 1000 : -1;
    replay.game = game;
    replay.eventsUpTo = secondOf(event?.occurred_at);
    replay.itemsUpTo = secondOf(item?.purchased_at);

    const elapsed = Math.min(
      (Date.now() - startedAt) / 1000,
      recording.duration_seconds,
    );
    if (gold === 0 && elapsed > BACKFILL_STEP_SECONDS) {
      const timeline = this.timeline(replay, recording);
      const points = [];
      for (let t = 0; t < elapsed; t += BACKFILL_STEP_SECONDS) {
        const state = recordingAt(recording, timeline, t);
        const recorded_at = new Date(startedAt + t * 1000).toISOString();
        for (const [team_id, value] of Object.entries(state.gold)) {
          points.push({ team_id, gold: value, game_number: game, recorded_at });
        }
      }
      await this.economy.upsertEconomy(matchId, points);
    }
  }

  /** Writes the game as it stands at `elapsed` seconds. */
  private async play(
    matchId: string,
    replay: Replay,
    recording: Recording,
    startedAt: number,
    elapsed: number,
  ): Promise<void> {
    const t = Math.min(elapsed, recording.duration_seconds);
    const game_number = recording.game_number;
    const timeline = this.timeline(replay, recording);
    const state = recordingAt(recording, timeline, t);
    const at = (second: number) =>
      new Date(startedAt + Math.round(second * 1000)).toISOString();
    const recorded_at = at(t);

    await this.economy.upsertEconomy(
      matchId,
      Object.entries(state.gold).map(([team_id, gold]) => ({
        team_id,
        gold,
        game_number,
        recorded_at,
      })),
    );
    await this.matches.upsertLiveStats(
      matchId,
      state.players.map((player) => ({
        player_id: player.player_id,
        team_id: player.team_id,
        kills: player.kills,
        deaths: player.deaths,
        assists: player.assists,
        gold: player.gold,
        damage: player.damage,
        damage_taken: player.damage_taken,
        level: player.level,
        hero: player.hero,
        hero_icon_url: player.hero_icon_url,
        game_number,
        recorded_at,
      })),
    );

    const firstKill = timeline.find((moment) => moment.kind === 'kill');
    const events: MatchEventDto[] = timeline
      .filter(
        (moment) => moment.second > replay.eventsUpTo && moment.second <= t,
      )
      .flatMap((moment): MatchEventDto[] => {
        const base = {
          game_number,
          occurred_at: at(moment.second),
          // Real counts, reconstructed times (see replay.ts).
          details: { reconstructed: true },
        };
        if (moment.kind === 'death') return [];
        if (moment.kind === 'kill') {
          const killer = this.describe(replay, recording, moment.killer_id);
          const victim = moment.victim_id
            ? (replay.nicknames[moment.victim_id] ?? 'an enemy')
            : null;
          const first = moment === firstKill;
          return [
            {
              ...base,
              team_id: moment.team_id,
              player_id: moment.killer_id,
              event_type: first ? 'first_blood' : 'kill',
              title: first
                ? `First blood: ${killer}${victim ? ` on ${victim}` : ''}`
                : victim
                  ? `${killer} took down ${victim}`
                  : `${killer} scored a kill`,
            },
          ];
        }
        const team = replay.teamNames[moment.team_id] ?? 'A team';
        return [
          {
            ...base,
            team_id: moment.team_id,
            event_type: moment.kind,
            title:
              moment.kind === 'lord'
                ? `${team} secured the Lord`
                : moment.kind === 'turtle'
                  ? `${team} secured the Turtle`
                  : `${team} destroyed a tower`,
          },
        ];
      });
    if (events.length > 0) await this.matches.upsertEvents(matchId, events);
    replay.eventsUpTo = Math.max(replay.eventsUpTo, t);

    const purchases = purchasesBetween(recording, replay.itemsUpTo, t);
    if (purchases.length > 0) {
      await this.matches.upsertEquipment(
        matchId,
        purchases.map((purchase) => ({
          player_id: purchase.player_id,
          team_id: purchase.team_id,
          item_id: purchase.item_id,
          item_name: purchase.item_name,
          phase: purchase.tier === 3 ? 'phase3' : 'phase2',
          tier: purchase.tier,
          icon_url: purchase.icon_url,
          game_number,
          purchased_at: at(purchase.second),
        })),
      );
    }
    replay.itemsUpTo = Math.max(replay.itemsUpTo, t);
  }

  /** The recorded end: final statistics, then the real winner. */
  private async finishGame(
    matchId: string,
    replay: Replay,
    recording: Recording,
    startedAt: number,
  ): Promise<void> {
    await this.matches.upsertStatistics(matchId, finalStatistics(recording));
    const result = await this.matches.upsertGame(
      matchId,
      recording.game_number,
      {
        status: 'completed',
        winner_team_id: recording.winner_team_id,
        started_at: new Date(startedAt).toISOString(),
        ended_at: new Date(
          startedAt + recording.duration_seconds * 1000,
        ).toISOString(),
      },
    );
    replay.game = null;
    this.logger.log(
      `match ${matchId} game ${recording.game_number} ended: ${result.data.score_a}-${result.data.score_b}`,
    );
  }

  private async driftViewers(matchId: string, replay: Replay): Promise<void> {
    replay.ticks += 1;
    if (replay.ticks % VIEWER_DRIFT_EVERY !== 0) return;
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

  /**
   * Upcoming matches never actually start (live matches are recordings):
   * one about to start moves a day later, so the calendar always has
   * upcoming matches with tickets and no reminder announces a match that
   * will not happen.
   */
  async rollCalendar(): Promise<void> {
    const now = Date.now();
    if (now - this.lastRoll < ROLL_CHECK_MS) return;
    this.lastRoll = now;
    const soon = await this.prisma.match.findMany({
      where: {
        status: 'scheduled',
        scheduled_at: { lt: new Date(now + ROLL_WITHIN_MS) },
      },
      select: { id: true, scheduled_at: true },
    });
    for (const match of soon) {
      let at = match.scheduled_at.getTime();
      while (at < now + ROLL_WITHIN_MS) at += DAY_MS;
      await this.matches.update(match.id, {
        scheduled_at: new Date(at).toISOString(),
      });
    }
    if (soon.length > 0) {
      this.logger.log(`moved ${soon.length} upcoming matches a day later`);
    }
  }

  private timeline(replay: Replay, recording: Recording): Moment[] {
    let timeline = replay.timelines.get(recording.game_number);
    if (!timeline) {
      timeline = timelineOf(recording);
      replay.timelines.set(recording.game_number, timeline);
    }
    return timeline;
  }

  private describe(
    replay: Replay,
    recording: Recording,
    playerId: string,
  ): string {
    const nickname = replay.nicknames[playerId] ?? 'A player';
    const hero = recording.script.players.find(
      (p) => p.player_id === playerId,
    )?.hero;
    return hero ? `${nickname} (${hero})` : nickname;
  }

  private async load(matchId: string): Promise<Replay | null> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: {
        best_of: true,
        team_a_id: true,
        team_b_id: true,
        teamA: { select: { name: true } },
        teamB: { select: { name: true } },
        recordings: { orderBy: { game_number: 'asc' } },
      },
    });
    if (!match || match.recordings.length === 0) return null;
    const recordings = new Map(
      match.recordings.map((row) => [
        row.game_number,
        {
          match_id: matchId,
          game_number: row.game_number,
          duration_seconds: row.duration_seconds,
          winner_team_id: row.winner_team_id,
          script: row.script as unknown as GameScript,
        },
      ]),
    );
    const playerIds = [
      ...new Set(
        [...recordings.values()].flatMap((recording) =>
          recording.script.players.map((p) => p.player_id),
        ),
      ),
    ];
    const players = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: { id: true, nickname: true },
    });
    return {
      bestOf: match.best_of,
      teamNames: {
        [match.team_a_id]: match.teamA.name,
        [match.team_b_id]: match.teamB.name,
      },
      nicknames: Object.fromEntries(players.map((p) => [p.id, p.nickname])),
      recordings,
      timelines: new Map(),
      game: null,
      eventsUpTo: -1,
      itemsUpTo: -1,
      ticks: 0,
    };
  }
}
