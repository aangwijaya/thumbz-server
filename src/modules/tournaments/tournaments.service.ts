import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PaginationMeta,
  buildPaginationMeta,
} from '../../common/utils/pagination';
import {
  MatchSummary,
  SUMMARY_INCLUDE,
  toMatchSummary,
} from '../matches/matches.service';
import {
  SUMMARY_SELECT as TEAM_SUMMARY_SELECT,
  toTeamSummary,
} from '../teams/teams.service';
import { roundWinRate } from '../teams/teams.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTournamentsDto } from './dto/list-tournaments.dto';
import { TournamentScheduleDto } from './dto/tournament-schedule.dto';

const STAGE_ORDER = [
  'group_stage',
  'regular_season',
  'playoffs',
  'semifinal',
  'third_place',
  'grand_final',
] as const;

export const SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  region: true,
  start_date: true,
  end_date: true,
  prize_pool: true,
  logo_url: true,
  featured: true,
} satisfies Prisma.TournamentSelect;

export interface TournamentSummary {
  current_stage: string | null;
  id: string;
  slug: string;
  name: string;
  status: string;
  region: string;
  start_date: string;
  end_date: string;
  prize_pool: string | null;
  logo_url: string | null;
  featured: boolean;
}

export interface TournamentDetail extends TournamentSummary {
  description: string | null;
}

export function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export interface StandingsInput {
  team_id: string;
  name: string;
  played: number;
  wins: number;
}

export interface RankedStanding extends StandingsInput {
  losses: number;
  win_rate: number | null;
  rank: number;
}

export function rankStandings(rows: StandingsInput[]): RankedStanding[] {
  const sorted = [...rows].sort((a, b) => {
    const winRateA = roundWinRate(a.wins, a.played) ?? -1;
    const winRateB = roundWinRate(b.wins, b.played) ?? -1;
    if (a.wins !== b.wins) return b.wins - a.wins;
    if (winRateA !== winRateB) return winRateB - winRateA;
    return a.name.localeCompare(b.name);
  });

  const ranked: RankedStanding[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i];
    const previous = sorted[i - 1];
    const winRate = roundWinRate(row.wins, row.played);
    const tiesWithPrevious =
      previous !== undefined &&
      previous.wins === row.wins &&
      roundWinRate(previous.wins, previous.played) === winRate;
    const rank = i === 0 || !tiesWithPrevious ? i + 1 : ranked[i - 1].rank;
    ranked.push({
      ...row,
      losses: row.played - row.wins,
      win_rate: winRate,
      rank,
    });
  }
  return ranked;
}

export function toTournamentSummary(
  row: Prisma.TournamentGetPayload<{ select: typeof SUMMARY_SELECT }>,
  currentStage: string | null = null,
): TournamentSummary {
  return {
    ...row,
    start_date: formatDateOnly(row.start_date),
    end_date: formatDateOnly(row.end_date),
    current_stage: currentStage,
  };
}

export async function computeCurrentStages(
  prisma: PrismaService,
  tournamentIds: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (tournamentIds.length === 0) {
    return result;
  }
  const rows = await prisma.match.findMany({
    where: { tournament_id: { in: tournamentIds }, stage: { not: null } },
    select: {
      tournament_id: true,
      stage: true,
      status: true,
      scheduled_at: true,
    },
  });
  const orderOf = (stage: string): number =>
    STAGE_ORDER.indexOf(stage as (typeof STAGE_ORDER)[number]);

  for (const id of tournamentIds) {
    const mine = rows.filter((r) => r.tournament_id === id);
    const live = mine.filter((r) => r.status === 'live');
    const scheduled = mine.filter((r) => r.status === 'scheduled');
    const completed = mine.filter((r) => r.status === 'completed');
    let stage: string | null = null;
    if (live.length > 0) {
      stage = live.reduce((best, r) =>
        orderOf(r.stage as string) > orderOf(best.stage as string) ? r : best,
      ).stage;
    } else if (scheduled.length > 0) {
      const next = scheduled.sort(
        (a, b) =>
          orderOf(a.stage as string) - orderOf(b.stage as string) ||
          a.scheduled_at.getTime() - b.scheduled_at.getTime(),
      )[0];
      stage = next?.stage;
    } else if (completed.length > 0) {
      stage = completed.reduce((best, r) =>
        orderOf(r.stage as string) > orderOf(best.stage as string) ? r : best,
      ).stage;
    }
    result.set(id, stage);
  }
  return result;
}

@Injectable()
export class TournamentsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListTournamentsDto,
  ): Promise<{ data: TournamentSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sort = query.sort ?? 'start_date';
    const order = query.order ?? (sort === 'name' ? 'asc' : 'desc');

    const where: Prisma.TournamentWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.region) where.region = query.region;
    if (query.featured !== undefined) where.featured = query.featured;

    const orderBy: Prisma.TournamentOrderByWithRelationInput =
      sort === 'name' ? { name: order } : { start_date: order };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tournament.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SUMMARY_SELECT,
      }),
      this.prisma.tournament.count({ where }),
    ]);

    const stages = await computeCurrentStages(
      this.prisma,
      rows.map((row) => row.id),
    );
    return {
      data: rows.map((row) =>
        toTournamentSummary(row, stages.get(row.id) ?? null),
      ),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async get(id: string): Promise<{ data: TournamentDetail }> {
    const row = await this.prisma.tournament.findUnique({
      where: { id },
      select: { ...SUMMARY_SELECT, description: true },
    });
    if (row === null) {
      throw new NotFoundException();
    }
    const stages = await computeCurrentStages(this.prisma, [id]);
    return {
      data: {
        ...toTournamentSummary(row, stages.get(id) ?? null),
        description: row.description,
      },
    };
  }

  private async requireTournament(id: string): Promise<void> {
    const tournament = await this.prisma.tournament.findUnique({
      where: { id },
      select: { id: true },
    });
    if (tournament === null) {
      throw new NotFoundException();
    }
  }

  async schedule(
    id: string,
    query: TournamentScheduleDto,
  ): Promise<{
    data: Array<{ stage: string; matches: MatchSummary[] }>;
    meta: PaginationMeta;
  }> {
    await this.requireTournament(id);

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.MatchWhereInput = {
      tournament_id: id,
      stage: { not: null },
    };
    if (query.stage) where.stage = query.stage;
    if (query.status) where.status = query.status;
    const scheduledAt: Prisma.DateTimeFilter = {};
    if (query.from) scheduledAt.gte = new Date(query.from);
    if (query.to) scheduledAt.lte = new Date(query.to);
    if (Object.keys(scheduledAt).length > 0) {
      where.scheduled_at = scheduledAt;
    }

    const rows = await this.prisma.match.findMany({
      where,
      // stage asc follows the DB enum order, which matches the contract
      // progression order (group_stage ... grand_final)
      orderBy: [{ stage: 'asc' }, { scheduled_at: 'asc' }],
      include: SUMMARY_INCLUDE,
    });

    const groups: Array<{ stage: string; matches: MatchSummary[] }> = [];
    for (const row of rows) {
      const stage = row.stage as string | null;
      if (stage === null) continue;
      const existing = groups.find((group) => group.stage === stage);
      if (existing) {
        existing.matches.push(toMatchSummary(row));
      } else {
        groups.push({ stage, matches: [toMatchSummary(row)] });
      }
    }

    const start = (page - 1) * pageSize;
    return {
      data: groups.slice(start, start + pageSize),
      meta: buildPaginationMeta(page, pageSize, groups.length),
    };
  }

  async standings(id: string): Promise<{
    data: { tournament_id: string; standings: Array<Record<string, unknown>> };
  }> {
    await this.requireTournament(id);

    const completed = await this.prisma.match.findMany({
      where: { tournament_id: id, status: 'completed' },
      select: { team_a_id: true, team_b_id: true, winner_team_id: true },
    });

    const statsByTeam = new Map<
      string,
      { team_id: string; played: number; wins: number }
    >();
    for (const match of completed) {
      for (const teamId of [match.team_a_id, match.team_b_id]) {
        const entry = statsByTeam.get(teamId) ?? {
          team_id: teamId,
          played: 0,
          wins: 0,
        };
        entry.played += 1;
        statsByTeam.set(teamId, entry);
      }
      const winner = match.winner_team_id;
      if (winner !== null) {
        const entry = statsByTeam.get(winner);
        if (entry) entry.wins += 1;
      }
    }

    const teams = await this.prisma.team.findMany({
      where: { id: { in: [...statsByTeam.keys()] } },
      select: TEAM_SUMMARY_SELECT,
    });
    const teamById = new Map(teams.map((team) => [team.id, team]));

    const ranked = rankStandings(
      [...statsByTeam.values()].map((entry) => ({
        team_id: entry.team_id,
        name: teamById.get(entry.team_id)?.name ?? '',
        played: entry.played,
        wins: entry.wins,
      })),
    );

    return {
      data: {
        tournament_id: id,
        standings: ranked
          .map((entry) => {
            const team = teamById.get(entry.team_id);
            if (team === undefined) return null;
            return {
              rank: entry.rank,
              team: toTeamSummary(team),
              played: entry.played,
              wins: entry.wins,
              losses: entry.losses,
              win_rate: entry.win_rate,
            };
          })
          .filter(
            (entry): entry is NonNullable<typeof entry> => entry !== null,
          ),
      },
    };
  }

  async results(
    id: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    await this.requireTournament(id);

    const where: Prisma.MatchWhereInput = {
      tournament_id: id,
      status: 'completed',
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        orderBy: { ended_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.match.count({ where }),
    ]);

    return {
      data: rows.map(toMatchSummary),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async stages(id: string): Promise<{
    data: Array<{
      stage: string;
      match_count: number;
      completed_count: number;
      live_count: number;
    }>;
  }> {
    await this.requireTournament(id);

    const rows = await this.prisma.match.findMany({
      where: { tournament_id: id, stage: { not: null } },
      select: { stage: true, status: true },
    });

    const counts = new Map<
      string,
      { match_count: number; completed_count: number; live_count: number }
    >();
    for (const row of rows) {
      const stage = row.stage as string | null;
      if (stage === null) continue;
      const entry = counts.get(stage) ?? {
        match_count: 0,
        completed_count: 0,
        live_count: 0,
      };
      entry.match_count += 1;
      if (row.status === 'completed') entry.completed_count += 1;
      if (row.status === 'live') entry.live_count += 1;
      counts.set(stage, entry);
    }

    const data = STAGE_ORDER.flatMap((stage) => {
      const entry = counts.get(stage);
      if (entry === undefined) return [];
      return [{ stage: stage, ...entry }];
    });

    return { data };
  }
}
