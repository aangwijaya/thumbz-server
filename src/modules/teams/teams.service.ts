import { Injectable, NotFoundException } from '@nestjs/common';
import { player_role, Prisma } from '@prisma/client';
import {
  PaginationMeta,
  buildPaginationMeta,
} from '../../common/utils/pagination';
import {
  MatchSummary,
  SUMMARY_INCLUDE,
  toMatchSummary,
} from '../matches/matches.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListTeamsDto } from './dto/list-teams.dto';
import { TeamMatchesDto } from './dto/team-matches.dto';

export const SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  short_name: true,
  region: true,
  logo_url: true,
  color_primary: true,
  color_secondary: true,
  is_active: true,
} satisfies Prisma.TeamSelect;

export type TeamRow = Prisma.TeamGetPayload<{ select: typeof SUMMARY_SELECT }>;

export interface TeamSummary {
  short_name: string | null;
  id: string;
  slug: string;
  name: string;
  region: string;
  logo_url: string | null;
  color_primary: string | null;
  color_secondary: string | null;
  is_active: boolean;
}

export interface TeamStats {
  matches_played: number;
  matches_won: number;
  win_rate: number | null;
  current_form: Array<'W' | 'L'>;
}

export interface TeamDetail extends TeamSummary {
  description: string | null;
  founded_year: number | null;
  stats: TeamStats;
  live_match: MatchSummary | null;
  next_match: MatchSummary | null;
}

export function toTeamSummary(row: TeamRow): TeamSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    short_name: row.short_name,
    region: row.region,
    logo_url: row.logo_url,
    color_primary: row.color_primary,
    color_secondary: row.color_secondary,
    is_active: row.is_active,
  };
}

export function roundWinRate(won: number, played: number): number | null {
  if (played === 0) {
    return null;
  }
  return Math.round((won / played) * 1000) / 1000;
}

function roundOneDecimal(value: number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

export interface TeamStatistics {
  team_id: string;
  matches_played: number;
  matches_won: number;
  win_rate: number | null;
  avg_kills: number | null;
  avg_deaths: number | null;
  avg_gold: number | null;
  per_tournament: Array<{
    tournament: { id: string; name: string; slug: string };
    matches_played: number;
    wins: number;
  }>;
}

export interface RosterPlayer {
  id: string;
  slug: string;
  nickname: string;
  real_name: string | null;
  role: player_role;
  country: string | null;
  team_id: string | null;
  team: TeamSummary | null;
  photo_url: string | null;
  is_active: boolean;
}

export function buildCurrentForm(
  completedMatches: Array<{ winner_team_id: string | null }>,
  teamId: string,
): Array<'W' | 'L'> {
  return completedMatches
    .slice()
    .reverse()
    .map((match) => (match.winner_team_id === teamId ? 'W' : 'L'));
}

@Injectable()
export class TeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListTeamsDto,
  ): Promise<{ data: TeamSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const sort = query.sort ?? 'name';
    const order = query.order ?? 'asc';

    const where: Prisma.TeamWhereInput = {};
    if (query.region) where.region = query.region;
    if (query.tournament_id) {
      where.OR = [
        { matchTeamA: { some: { tournament_id: query.tournament_id } } },
        { matchTeamB: { some: { tournament_id: query.tournament_id } } },
      ];
    }

    const orderBy: Prisma.TeamOrderByWithRelationInput =
      sort === 'created_at' ? { created_at: order } : { name: order };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.team.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: SUMMARY_SELECT,
      }),
      this.prisma.team.count({ where }),
    ]);

    return {
      data: rows.map(toTeamSummary),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async get(id: string): Promise<{ data: TeamDetail }> {
    const team = await this.prisma.team.findUnique({
      where: { id },
      select: {
        ...SUMMARY_SELECT,
        description: true,
        founded_year: true,
        created_at: true,
      },
    });
    if (team === null) {
      throw new NotFoundException();
    }

    const involvedWhere: Prisma.MatchWhereInput = {
      OR: [{ team_a_id: id }, { team_b_id: id }],
    };

    const played = await this.prisma.match.count({
      where: { ...involvedWhere, status: 'completed' },
    });
    const won = await this.prisma.match.count({
      where: {
        ...involvedWhere,
        status: 'completed',
        winner_team_id: id,
      },
    });

    const formMatches = await this.prisma.match.findMany({
      where: { ...involvedWhere, status: 'completed' },
      orderBy: { ended_at: 'desc' },
      take: 5,
      select: { winner_team_id: true },
    });

    const liveMatch = await this.prisma.match.findFirst({
      where: { ...involvedWhere, status: 'live' },
      orderBy: { scheduled_at: 'asc' },
      include: SUMMARY_INCLUDE,
    });

    const nextMatch = await this.prisma.match.findFirst({
      where: {
        ...involvedWhere,
        status: 'scheduled',
        scheduled_at: { gte: new Date() },
      },
      orderBy: { scheduled_at: 'asc' },
      include: SUMMARY_INCLUDE,
    });

    return {
      data: {
        ...toTeamSummary(team),
        description: team.description,
        founded_year: team.founded_year,
        stats: {
          matches_played: played,
          matches_won: won,
          win_rate: roundWinRate(won, played),
          current_form: buildCurrentForm(formMatches, id),
        },
        live_match: liveMatch === null ? null : toMatchSummary(liveMatch),
        next_match: nextMatch === null ? null : toMatchSummary(nextMatch),
      },
    };
  }

  async teamMatches(
    id: string,
    query: TeamMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    const team = await this.prisma.team.findUnique({
      where: { id },
      select: { id: true },
    });
    if (team === null) {
      throw new NotFoundException();
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.MatchWhereInput = {
      OR: [{ team_a_id: id }, { team_b_id: id }],
    };
    if (query.status) where.status = query.status;
    const scheduledAt: Prisma.DateTimeFilter = {};
    if (query.from) scheduledAt.gte = new Date(query.from);
    if (query.to) scheduledAt.lte = new Date(query.to);
    if (Object.keys(scheduledAt).length > 0) {
      where.scheduled_at = scheduledAt;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        orderBy: { scheduled_at: 'desc' },
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

  async statistics(id: string): Promise<{ data: TeamStatistics }> {
    const team = await this.prisma.team.findUnique({
      where: { id },
      select: { id: true },
    });
    if (team === null) {
      throw new NotFoundException();
    }

    const involvedWhere: Prisma.MatchWhereInput = {
      OR: [{ team_a_id: id }, { team_b_id: id }],
    };

    const completed = await this.prisma.match.findMany({
      where: { ...involvedWhere, status: 'completed' },
      select: {
        id: true,
        winner_team_id: true,
        tournament: { select: { id: true, name: true, slug: true } },
      },
    });

    const played = completed.length;
    const won = completed.filter((m) => m.winner_team_id === id).length;

    const perTournamentMap = new Map<
      string,
      {
        tournament: { id: string; name: string; slug: string };
        matches_played: number;
        wins: number;
      }
    >();
    for (const match of completed) {
      if (match.tournament === null) {
        continue;
      }
      const existing = perTournamentMap.get(match.tournament.id) ?? {
        tournament: match.tournament,
        matches_played: 0,
        wins: 0,
      };
      existing.matches_played += 1;
      if (match.winner_team_id === id) {
        existing.wins += 1;
      }
      perTournamentMap.set(match.tournament.id, existing);
    }
    const perTournament = [...perTournamentMap.values()].sort((a, b) =>
      a.tournament.name.localeCompare(b.tournament.name),
    );

    const avg = await this.prisma.matchTeamStatistic.aggregate({
      where: { team_id: id, match_id: { in: completed.map((m) => m.id) } },
      _avg: { kills: true, deaths: true, gold: true },
    });

    return {
      data: {
        team_id: id,
        matches_played: played,
        matches_won: won,
        win_rate: roundWinRate(won, played),
        avg_kills: roundOneDecimal(avg._avg.kills),
        avg_deaths: roundOneDecimal(avg._avg.deaths),
        avg_gold: roundOneDecimal(avg._avg.gold),
        per_tournament: perTournament,
      },
    };
  }

  async roster(id: string): Promise<{ data: RosterPlayer[] }> {
    const team = await this.prisma.team.findUnique({
      where: { id },
      select: { id: true },
    });
    if (team === null) {
      throw new NotFoundException();
    }

    // role order follows the DB enum declaration order, which matches the
    // contract order: gold, mid, exp, jungle, roam, flex, coach
    const players = await this.prisma.player.findMany({
      where: { team_id: id, is_active: true },
      orderBy: [{ role: 'asc' }, { nickname: 'asc' }],
      include: { team: { select: SUMMARY_SELECT } },
    });

    return {
      data: players.map((player) => ({
        id: player.id,
        slug: player.slug,
        nickname: player.nickname,
        real_name: player.real_name,
        role: player.role,
        country: player.country,
        team_id: player.team_id,
        team: player.team,
        photo_url: player.photo_url,
        is_active: player.is_active,
      })),
    };
  }
}
