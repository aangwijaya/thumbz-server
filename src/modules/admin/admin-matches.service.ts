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
import { UpdateMatchDto } from './dto/update-match.dto';
import { PlayerSnapshotDto } from './dto/upsert-live-stats.dto';
import { ItemPurchaseDto } from './dto/upsert-equipment.dto';
import { MatchEventDto } from './dto/upsert-events.dto';
import { UpsertStatisticsDto } from './dto/upsert-statistics.dto';
import { validateCompletedMatch, validateTransition } from './match-state';

@Injectable()
export class AdminMatchesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly matchesService: MatchesService,
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

    return this.getDetail(row.id);
  }

  async update(
    id: string,
    dto: UpdateMatchDto,
  ): Promise<{ data: MatchDetail }> {
    const existing = await this.prisma.match.findUnique({
      where: { id },
      select: {
        status: true,
        team_a_id: true,
        team_b_id: true,
        score_a: true,
        score_b: true,
        winner_team_id: true,
      },
    });
    if (existing === null) {
      throw new NotFoundException();
    }

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
      },
    });

    return this.getDetail(id);
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.match.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existing === null) {
      throw new NotFoundException();
    }

    // statistics rows cascade via the FK (ON DELETE CASCADE)
    await this.prisma.match.delete({ where: { id } });
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
    const tournament = await this.prisma.tournament.findUnique({
      where: { id: tournamentId },
      select: { id: true },
    });
    if (tournament === null) {
      throw new NotFoundException();
    }
  }

  private async getDetail(id: string): Promise<{ data: MatchDetail }> {
    const row = await this.prisma.match.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (row === null) {
      throw new NotFoundException();
    }
    return { data: toMatchDetail(row) };
  }

  async setLive(id: string, dto: LiveMatchDto): Promise<{ data: MatchDetail }> {
    const existing = await this.prisma.match.findUnique({
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
    });
    if (existing === null) {
      throw new NotFoundException();
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

    return this.getDetail(id);
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
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: { team_a_id: true, team_b_id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

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
            match_id_team_id: { match_id: id, team_id: row.team_id },
          },
          update: data,
          create: { match_id: id, team_id: row.team_id, ...data },
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
          mvp: row.mvp ?? false,
          details: (row.details ?? {}) as Prisma.InputJsonValue,
        };
        await tx.playerMatchStatistic.upsert({
          where: {
            match_id_player_id: { match_id: id, player_id: row.player_id },
          },
          update: data,
          create: {
            match_id: id,
            player_id: row.player_id,
            team_id: row.team_id,
            ...data,
          },
        });
      }
    });

    return this.matchesService.statistics(id);
  }

  async upsertLiveStats(
    id: string,
    snapshots: PlayerSnapshotDto[],
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: { team_a_id: true, team_b_id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

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
        recorded_at: true,
      },
    });

    return { data: rows.map((row) => ({ ...row })) };
  }

  async upsertEquipment(
    id: string,
    purchases: ItemPurchaseDto[],
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: { team_a_id: true, team_b_id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

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
        purchased_at: true,
      },
    });

    return { data: rows.map((row) => ({ ...row })) };
  }

  async upsertEvents(
    id: string,
    events: MatchEventDto[],
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    const match = await this.prisma.match.findUnique({
      where: { id },
      select: { team_a_id: true, team_b_id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

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
        occurred_at: true,
      },
    });

    return { data: rows.map((row) => ({ ...row })) };
  }
}
