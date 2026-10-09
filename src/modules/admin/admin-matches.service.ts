import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { match_status } from '@prisma/client';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import {
  DETAIL_INCLUDE,
  MatchDetail,
  MatchesService,
  toMatchDetail,
} from '../matches/matches.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateMatchDto } from './dto/create-match.dto';
import { LiveMatchDto } from './dto/live-match.dto';
import { UpsertGameDto } from './dto/upsert-game.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { PlayerSnapshotDto } from './dto/upsert-live-stats.dto';
import { ItemPurchaseDto } from './dto/upsert-equipment.dto';
import { MatchEventDto } from './dto/upsert-events.dto';
import { BroadcastDto } from './dto/upsert-broadcasts.dto';
import { UpsertStatisticsDto } from './dto/upsert-statistics.dto';
import { validateCompletedMatch, validateTransition } from './match-state';
import { orNotFound } from '../../common/utils/not-found';
import { DomainEvents } from '../../infra/events/domain-events';

/** Optional JSON column: absent/null stores SQL NULL (re-submission replaces). */
const jsonOrNull = (
  value: object | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull =>
  value == null
    ? Prisma.DbNull
    : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);

@Injectable()
export class AdminMatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matchesService: MatchesService,
    private readonly events: DomainEvents,
  ) {}

  async create(dto: CreateMatchDto): Promise<{ data: MatchDetail }> {
    if (dto.team_a_id === dto.team_b_id) {
      throw new BusinessRuleException(
        'team_a_id and team_b_id must be different teams',
      );
    }
    await this.ensureTeamsExist(dto.team_a_id, dto.team_b_id);
    await this.ensureTournamentExists(dto.tournament_id);
    if (dto.status === 'live') {
      throw new BusinessRuleException(
        'New matches cannot be created as live; use the live endpoint',
      );
    }
    if (dto.status === 'completed') {
      const error = validateCompletedMatch(
        dto.score_a ?? null,
        dto.score_b ?? null,
        dto.winner_team_id ?? null,
        dto.team_a_id,
        dto.team_b_id,
      );
      if (error !== null) {
        throw new BusinessRuleException(error);
      }
    }

    const row = await this.prisma.match.create({
      data: {
        tournament_id: dto.tournament_id ?? null,
        stage: dto.stage ?? null,
        round: dto.round ?? null,
        group_name: dto.group_name ?? null,
        best_of: dto.best_of ?? 1,
        game_number: dto.game_number ?? null,
        team_a_id: dto.team_a_id,
        team_b_id: dto.team_b_id,
        score_a: dto.score_a ?? null,
        score_b: dto.score_b ?? null,
        winner_team_id: dto.winner_team_id ?? null,
        status: dto.status ?? 'scheduled',
        scheduled_at: new Date(dto.scheduled_at),
        started_at: dto.started_at ? new Date(dto.started_at) : null,
        ended_at: dto.ended_at ? new Date(dto.ended_at) : null,
        stream_url: dto.stream_url ?? null,
        thumbnail_url: dto.thumbnail_url ?? null,
        viewer_count: dto.viewer_count ?? 0,
        featured: dto.featured ?? false,
      },
    });

    return this.publishChanged(await this.getDetail(row.id));
  }

  async update(
    id: string,
    dto: UpdateMatchDto,
  ): Promise<{ data: MatchDetail }> {
    const existing = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: {
          status: true,
          team_a_id: true,
          team_b_id: true,
          score_a: true,
          score_b: true,
          winner_team_id: true,
        },
      }),
    );

    const teamA = dto.team_a_id ?? existing.team_a_id;
    const teamB = dto.team_b_id ?? existing.team_b_id;
    if (teamA === teamB) {
      throw new BusinessRuleException(
        'team_a_id and team_b_id must be different teams',
      );
    }
    if (dto.team_a_id !== undefined || dto.team_b_id !== undefined) {
      await this.ensureTeamsExist(teamA, teamB);
    }
    if (dto.tournament_id !== undefined) {
      await this.ensureTournamentExists(dto.tournament_id);
    }

    if (dto.status !== undefined) {
      const transitionError = validateTransition(existing.status, dto.status);
      if (transitionError !== null) {
        throw new BusinessRuleException(transitionError);
      }
    }

    const resultingStatus: match_status = dto.status ?? existing.status;
    if (resultingStatus === 'completed') {
      const error = validateCompletedMatch(
        dto.score_a !== undefined ? dto.score_a : existing.score_a,
        dto.score_b !== undefined ? dto.score_b : existing.score_b,
        dto.winner_team_id !== undefined
          ? dto.winner_team_id
          : existing.winner_team_id,
        teamA,
        teamB,
      );
      if (error !== null) {
        throw new BusinessRuleException(error);
      }
    }

    await this.prisma.match.update({
      where: { id },
      data: {
        ...(dto.tournament_id !== undefined && {
          tournament_id: dto.tournament_id,
        }),
        ...(dto.stage !== undefined && { stage: dto.stage }),
        ...(dto.round !== undefined && { round: dto.round }),
        ...(dto.group_name !== undefined && { group_name: dto.group_name }),
        ...(dto.best_of !== undefined && { best_of: dto.best_of }),
        ...(dto.game_number !== undefined && {
          game_number: dto.game_number,
        }),
        ...(dto.team_a_id !== undefined && { team_a_id: dto.team_a_id }),
        ...(dto.team_b_id !== undefined && { team_b_id: dto.team_b_id }),
        ...(dto.score_a !== undefined && { score_a: dto.score_a }),
        ...(dto.score_b !== undefined && { score_b: dto.score_b }),
        ...(dto.winner_team_id !== undefined && {
          winner_team_id: dto.winner_team_id,
        }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.scheduled_at !== undefined && {
          scheduled_at: new Date(dto.scheduled_at),
        }),
        ...(dto.started_at !== undefined && {
          started_at: dto.started_at ? new Date(dto.started_at) : null,
        }),
        ...(dto.ended_at !== undefined && {
          ended_at: dto.ended_at ? new Date(dto.ended_at) : null,
        }),
        ...(dto.stream_url !== undefined && { stream_url: dto.stream_url }),
        ...(dto.thumbnail_url !== undefined && {
          thumbnail_url: dto.thumbnail_url,
        }),
        ...(dto.viewer_count !== undefined && {
          viewer_count: dto.viewer_count,
        }),
        ...(dto.featured !== undefined && { featured: dto.featured }),
        ...(dto.stream_delay_seconds !== undefined && {
          stream_delay_seconds: dto.stream_delay_seconds,
        }),
      },
    });

    return this.publishChanged(await this.getDetail(id));
  }

  async remove(id: string): Promise<void> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { tournament_id: true, team_a_id: true, team_b_id: true },
      }),
    );

    // statistics rows cascade via the FK (ON DELETE CASCADE)
    await this.prisma.match.delete({ where: { id } });
    this.events.emit({
      type: 'match.changed',
      matchId: id,
      tournamentId: match.tournament_id,
      teamIds: [match.team_a_id, match.team_b_id],
    });
  }

  private async ensureTeamsExist(
    teamAId: string,
    teamBId: string,
  ): Promise<void> {
    const count = await this.prisma.team.count({
      where: { id: { in: [teamAId, teamBId] } },
    });
    if (count !== 2) {
      throw new NotFoundException();
    }
  }

  private async ensureTournamentExists(
    tournamentId: string | null | undefined,
  ): Promise<void> {
    if (tournamentId === undefined || tournamentId === null) {
      return;
    }
    orNotFound(
      await this.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { id: true },
      }),
    );
  }

  private publishChanged(detail: { data: MatchDetail }): { data: MatchDetail } {
    this.events.emit({
      type: 'match.changed',
      matchId: detail.data.id,
      tournamentId: detail.data.tournament?.id ?? null,
      teamIds: [detail.data.team_a.id, detail.data.team_b.id],
    });
    return detail;
  }

  /**
   * Upserts one game of a series (contract §19). A live game becomes the
   * match's current game; completing one recomputes the series score from
   * completed games, so score and games can never disagree.
   */
  async upsertGame(
    id: string,
    gameNumber: number,
    dto: UpsertGameDto,
  ): Promise<{ data: MatchDetail }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: {
          team_a_id: true,
          team_b_id: true,
          best_of: true,
          games: {
            select: {
              game_number: true,
              status: true,
              started_at: true,
              ended_at: true,
            },
          },
        },
      }),
    );
    if (gameNumber > match.best_of) {
      throw new BusinessRuleException(
        `game_number must be between 1 and best_of (${match.best_of})`,
      );
    }
    const winner = dto.winner_team_id ?? null;
    if (dto.status === 'completed' && winner === null) {
      throw new BusinessRuleException('A completed game needs winner_team_id');
    }
    if (
      winner !== null &&
      ![match.team_a_id, match.team_b_id].includes(winner)
    ) {
      throw new BusinessRuleException(
        'winner_team_id must be one of the match teams',
      );
    }
    const otherLive = match.games.find(
      (game) => game.status === 'live' && game.game_number !== gameNumber,
    );
    if (dto.status === 'live' && otherLive) {
      throw new BusinessRuleException(
        `Game ${otherLive.game_number} is still live; complete it first`,
      );
    }

    const existing = match.games.find(
      (game) => game.game_number === gameNumber,
    );
    const now = new Date();
    const startedAt = dto.started_at
      ? new Date(dto.started_at)
      : (existing?.started_at ?? now);
    const endedAt =
      dto.status === 'completed'
        ? dto.ended_at
          ? new Date(dto.ended_at)
          : (existing?.ended_at ?? now)
        : null;
    const fields = {
      status: dto.status,
      winner_team_id: dto.status === 'completed' ? winner : null,
      started_at: startedAt,
      ended_at: endedAt,
      duration_seconds: endedAt
        ? Math.max(
            0,
            Math.round((endedAt.getTime() - startedAt.getTime()) / 1000),
          )
        : null,
    };

    await this.prisma.$transaction(async (tx) => {
      await tx.matchGame.upsert({
        where: {
          match_id_game_number: { match_id: id, game_number: gameNumber },
        },
        create: { match_id: id, game_number: gameNumber, ...fields },
        update: fields,
      });
      const completed = await tx.matchGame.findMany({
        where: { match_id: id, status: 'completed' },
        select: { winner_team_id: true },
      });
      await tx.match.update({
        where: { id },
        data: {
          ...(dto.status === 'live' ? { game_number: gameNumber } : {}),
          score_a: completed.filter((g) => g.winner_team_id === match.team_a_id)
            .length,
          score_b: completed.filter((g) => g.winner_team_id === match.team_b_id)
            .length,
        },
      });
    });

    await this.publishChangedById(id);
    return this.getDetail(id);
  }

  /**
   * Clears a series back to before game 1: games, score, per-game live data
   * and statistics. Internal (the demo replay loops a recorded series); not
   * exposed over HTTP.
   */
  async restartSeries(id: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.matchGame.deleteMany({ where: { match_id: id } }),
      this.prisma.matchGoldSnapshot.deleteMany({ where: { match_id: id } }),
      this.prisma.playerMatchSnapshot.deleteMany({ where: { match_id: id } }),
      this.prisma.matchItemEvent.deleteMany({ where: { match_id: id } }),
      this.prisma.matchEvent.deleteMany({ where: { match_id: id } }),
      this.prisma.playerMatchStatistic.deleteMany({ where: { match_id: id } }),
      this.prisma.matchTeamStatistic.deleteMany({ where: { match_id: id } }),
      this.prisma.match.update({
        where: { id },
        data: { score_a: 0, score_b: 0, game_number: null },
      }),
    ]);
    await this.publishChangedById(id);
    for (const kind of [
      'economy',
      'live-stats',
      'equipment',
      'events',
    ] as const) {
      this.events.emit({ type: 'match.live-data', matchId: id, kind });
    }
  }

  private async publishChangedById(id: string): Promise<void> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: { tournament_id: true, team_a_id: true, team_b_id: true },
    });
    if (match !== null) {
      this.events.emit({
        type: 'match.changed',
        matchId: id,
        tournamentId: match.tournament_id,
        teamIds: [match.team_a_id, match.team_b_id],
      });
    }
  }

  private async getDetail(id: string): Promise<{ data: MatchDetail }> {
    const row = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        include: DETAIL_INCLUDE,
      }),
    );
    return { data: toMatchDetail(row) };
  }

  async setLive(id: string, dto: LiveMatchDto): Promise<{ data: MatchDetail }> {
    const existing = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: {
          status: true,
          team_a_id: true,
          team_b_id: true,
          score_a: true,
          score_b: true,
          winner_team_id: true,
          started_at: true,
          ended_at: true,
        },
      }),
    );

    if (dto.status !== undefined) {
      const transitionError = validateTransition(existing.status, dto.status);
      if (transitionError !== null) {
        throw new BusinessRuleException(transitionError);
      }
    }

    const resultingStatus: match_status = dto.status ?? existing.status;
    if (resultingStatus === 'completed') {
      const error = validateCompletedMatch(
        dto.score_a !== undefined ? dto.score_a : existing.score_a,
        dto.score_b !== undefined ? dto.score_b : existing.score_b,
        dto.winner_team_id !== undefined
          ? dto.winner_team_id
          : existing.winner_team_id,
        existing.team_a_id,
        existing.team_b_id,
      );
      if (error !== null) {
        throw new BusinessRuleException(error);
      }
    }

    if (dto.viewer_count !== undefined && resultingStatus !== 'live') {
      throw new BusinessRuleException(
        'viewer_count can only be updated while the match is live',
      );
    }

    await this.prisma.match.update({
      where: { id },
      data: {
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.score_a !== undefined && { score_a: dto.score_a }),
        ...(dto.score_b !== undefined && { score_b: dto.score_b }),
        ...(dto.winner_team_id !== undefined && {
          winner_team_id: dto.winner_team_id,
        }),
        ...(dto.viewer_count !== undefined && {
          viewer_count: dto.viewer_count,
        }),
        ...(dto.stream_url !== undefined && { stream_url: dto.stream_url }),
        ...(resultingStatus === 'live' &&
          existing.started_at === null && { started_at: new Date() }),
        ...(resultingStatus === 'completed' &&
          existing.ended_at === null && { ended_at: new Date() }),
      },
    });

    return this.publishChanged(await this.getDetail(id));
  }

  async upsertStatistics(
    id: string,
    dto: UpsertStatisticsDto,
  ): Promise<{
    data: {
      match_id: string;
      teams: Array<Record<string, unknown>>;
      players: Array<Record<string, unknown>>;
    };
  }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { team_a_id: true, team_b_id: true },
      }),
    );
    // Same default as the read (§19): current game, else last, else 1.
    const gameNumber = await this.matchesService.gameOf(id, dto.game_number);

    const validTeamIds = [match.team_a_id, match.team_b_id];
    const teamRows = dto.teams ?? [];
    const playerRows = dto.players ?? [];

    const allTeamIds = [
      ...teamRows.map((row) => row.team_id),
      ...playerRows.map((row) => row.team_id),
    ];
    const invalidTeam = allTeamIds.some((t) => !validTeamIds.includes(t));
    if (invalidTeam) {
      throw new BusinessRuleException('team_id must be one of the match teams');
    }

    const playerIds = [...new Set(playerRows.map((row) => row.player_id))];
    if (playerIds.length > 0) {
      const found = await this.prisma.player.count({
        where: { id: { in: playerIds } },
      });
      if (found !== playerIds.length) {
        throw new NotFoundException();
      }
    }

    await this.prisma.$transaction(async (tx) => {
      for (const row of teamRows) {
        const data = {
          kills: row.kills ?? 0,
          deaths: row.deaths ?? 0,
          assists: row.assists ?? 0,
          gold: row.gold ?? 0,
          towers_destroyed: row.towers_destroyed ?? 0,
          game_duration_seconds: row.game_duration_seconds ?? null,
          details: (row.details ?? {}) as Prisma.InputJsonValue,
        };
        await tx.matchTeamStatistic.upsert({
          where: {
            match_id_team_id_game_number: {
              match_id: id,
              team_id: row.team_id,
              game_number: gameNumber,
            },
          },
          update: data,
          create: {
            match_id: id,
            team_id: row.team_id,
            game_number: gameNumber,
            ...data,
          },
        });
      }
      for (const row of playerRows) {
        const data = {
          kills: row.kills ?? 0,
          deaths: row.deaths ?? 0,
          assists: row.assists ?? 0,
          gold: row.gold ?? 0,
          damage: row.damage ?? 0,
          damage_taken: row.damage_taken ?? 0,
          level: row.level ?? null,
          hero_picked: row.hero_picked ?? null,
          hero_icon_url: row.hero_icon_url ?? null,
          tower_damage: row.tower_damage ?? 0,
          emblem: jsonOrNull(row.emblem),
          talents: jsonOrNull(row.talents),
          items: jsonOrNull(row.items),
          mvp: row.mvp ?? false,
          details: (row.details ?? {}) as Prisma.InputJsonValue,
        };
        await tx.playerMatchStatistic.upsert({
          where: {
            match_id_player_id_game_number: {
              match_id: id,
              player_id: row.player_id,
              game_number: gameNumber,
            },
          },
          update: data,
          create: {
            match_id: id,
            player_id: row.player_id,
            team_id: row.team_id,
            game_number: gameNumber,
            ...data,
          },
        });
      }
    });

    const statistics = await this.matchesService.statistics(id, gameNumber);
    await this.publishChangedById(id);
    return statistics;
  }

  async upsertLiveStats(
    id: string,
    snapshots: PlayerSnapshotDto[],
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { team_a_id: true, team_b_id: true, game_number: true },
      }),
    );

    const validTeamIds = [match.team_a_id, match.team_b_id];
    const invalidTeam = snapshots.some(
      (snapshot) => !validTeamIds.includes(snapshot.team_id),
    );
    if (invalidTeam) {
      throw new BusinessRuleException('team_id must be one of the match teams');
    }

    const playerIds = [...new Set(snapshots.map((s) => s.player_id))];
    const found = await this.prisma.player.count({
      where: { id: { in: playerIds } },
    });
    if (found !== playerIds.length) {
      throw new NotFoundException();
    }

    const now = new Date();
    const prepared = snapshots.map((snapshot) => ({
      match_id: id,
      player_id: snapshot.player_id,
      team_id: snapshot.team_id,
      kills: snapshot.kills ?? 0,
      deaths: snapshot.deaths ?? 0,
      assists: snapshot.assists ?? 0,
      gold: snapshot.gold ?? 0,
      damage: snapshot.damage ?? 0,
      damage_taken: snapshot.damage_taken ?? 0,
      level: snapshot.level ?? null,
      hero: snapshot.hero ?? null,
      hero_icon_url: snapshot.hero_icon_url ?? null,
      game_number: snapshot.game_number ?? match.game_number ?? 1,
      recorded_at:
        snapshot.recorded_at !== undefined
          ? new Date(snapshot.recorded_at)
          : now,
    }));

    await this.prisma.playerMatchSnapshot.createMany({
      data: prepared,
      skipDuplicates: true,
    });

    const rows = await this.prisma.playerMatchSnapshot.findMany({
      where: {
        match_id: id,
        OR: prepared.map((row) => ({
          player_id: row.player_id,
          recorded_at: row.recorded_at,
        })),
      },
      orderBy: { recorded_at: 'asc' },
      select: {
        player_id: true,
        team_id: true,
        kills: true,
        deaths: true,
        assists: true,
        gold: true,
        damage: true,
        damage_taken: true,
        level: true,
        hero: true,
        hero_icon_url: true,
        game_number: true,
        recorded_at: true,
      },
    });

    this.events.emit({
      type: 'match.live-data',
      matchId: id,
      kind: 'live-stats',
    });
    return { data: rows.map((row) => ({ ...row })) };
  }

  async upsertEquipment(
    id: string,
    purchases: ItemPurchaseDto[],
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { team_a_id: true, team_b_id: true, game_number: true },
      }),
    );

    const validTeamIds = [match.team_a_id, match.team_b_id];
    const invalidTeam = purchases.some(
      (purchase) => !validTeamIds.includes(purchase.team_id),
    );
    if (invalidTeam) {
      throw new BusinessRuleException('team_id must be one of the match teams');
    }

    const playerIds = [...new Set(purchases.map((p) => p.player_id))];
    const found = await this.prisma.player.count({
      where: { id: { in: playerIds } },
    });
    if (found !== playerIds.length) {
      throw new NotFoundException();
    }

    const now = new Date();
    const prepared = purchases.map((purchase) => ({
      match_id: id,
      player_id: purchase.player_id,
      team_id: purchase.team_id,
      item_id: purchase.item_id,
      item_name: purchase.item_name,
      phase: purchase.phase,
      slot: purchase.slot ?? null,
      tier: purchase.tier ?? null,
      icon_url: purchase.icon_url ?? null,
      game_number: purchase.game_number ?? match.game_number ?? 1,
      purchased_at:
        purchase.purchased_at !== undefined
          ? new Date(purchase.purchased_at)
          : now,
    }));

    await this.prisma.matchItemEvent.createMany({
      data: prepared,
      skipDuplicates: true,
    });

    const rows = await this.prisma.matchItemEvent.findMany({
      where: {
        match_id: id,
        OR: prepared.map((row) => ({
          player_id: row.player_id,
          item_name: row.item_name,
          purchased_at: row.purchased_at,
        })),
      },
      orderBy: { purchased_at: 'asc' },
      select: {
        player_id: true,
        team_id: true,
        item_id: true,
        item_name: true,
        phase: true,
        slot: true,
        tier: true,
        icon_url: true,
        game_number: true,
        purchased_at: true,
      },
    });

    this.events.emit({
      type: 'match.live-data',
      matchId: id,
      kind: 'equipment',
    });
    return { data: rows.map((row) => ({ ...row })) };
  }

  async upsertEvents(
    id: string,
    events: MatchEventDto[],
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { team_a_id: true, team_b_id: true, game_number: true },
      }),
    );

    const validTeamIds = [match.team_a_id, match.team_b_id];
    const invalidTeam = events.some(
      (event) =>
        event.team_id !== undefined &&
        event.team_id !== null &&
        !validTeamIds.includes(event.team_id),
    );
    if (invalidTeam) {
      throw new BusinessRuleException('team_id must be one of the match teams');
    }

    const playerIds = [
      ...new Set(
        events
          .map((event) => event.player_id)
          .filter((pid): pid is string => pid !== undefined && pid !== null),
      ),
    ];
    if (playerIds.length > 0) {
      const found = await this.prisma.player.count({
        where: { id: { in: playerIds } },
      });
      if (found !== playerIds.length) {
        throw new NotFoundException();
      }
    }

    const now = new Date();
    await this.prisma.matchEvent.createMany({
      data: events.map((event) => ({
        match_id: id,
        team_id: event.team_id ?? null,
        player_id: event.player_id ?? null,
        event_type: event.event_type,
        title: event.title,
        details: (event.details ?? {}) as Prisma.InputJsonValue,
        game_number: event.game_number ?? match.game_number ?? 1,
        occurred_at:
          event.occurred_at !== undefined ? new Date(event.occurred_at) : now,
      })),
    });

    const rows = await this.prisma.matchEvent.findMany({
      where: { match_id: id },
      orderBy: { occurred_at: 'asc' },
      select: {
        id: true,
        team_id: true,
        player_id: true,
        event_type: true,
        title: true,
        details: true,
        game_number: true,
        occurred_at: true,
      },
    });

    this.events.emit({ type: 'match.live-data', matchId: id, kind: 'events' });
    return { data: rows.map((row) => ({ ...row })) };
  }

  async upsertBroadcasts(
    id: string,
    broadcasts: BroadcastDto[],
  ): Promise<{
    data: Array<{ language: string; stream_url: string; viewer_count: number }>;
  }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const languages = broadcasts.map((b) => b.language);
    if (new Set(languages).size !== languages.length) {
      throw new BusinessRuleException(
        'each broadcast language may appear only once',
      );
    }

    await this.prisma.$transaction([
      this.prisma.matchBroadcast.deleteMany({ where: { match_id: id } }),
      ...(broadcasts.length > 0
        ? [
            this.prisma.matchBroadcast.createMany({
              data: broadcasts.map((b) => ({
                match_id: id,
                language: b.language,
                stream_url: b.stream_url,
                viewer_count: b.viewer_count ?? 0,
              })),
            }),
          ]
        : []),
    ]);

    const rows = await this.prisma.matchBroadcast.findMany({
      where: { match_id: id },
      orderBy: { viewer_count: 'desc' },
      select: { language: true, stream_url: true, viewer_count: true },
    });

    this.events.emit({
      type: 'match.live-data',
      matchId: id,
      kind: 'broadcasts',
    });
    return { data: rows.map((row) => ({ ...row })) };
  }
}
