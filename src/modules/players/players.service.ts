import { Injectable } from '@nestjs/common';
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
import {
  SUMMARY_SELECT,
  TeamSummary,
  toTeamSummary,
} from '../teams/teams.service';
import {
  formatDateOnly,
  TournamentSummary,
} from '../tournaments/tournaments.service';
import { roundWinRate } from '../teams/teams.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ListPlayersDto } from './dto/list-players.dto';
import { PlayerMatchesDto } from './dto/player-matches.dto';
import { orNotFound } from '../../common/utils/not-found';
import { findPage, ListMeta } from '../../common/utils/find-page';

export const PLAYER_INCLUDE = {
  team: { select: SUMMARY_SELECT },
} satisfies Prisma.PlayerInclude;

type PlayerRow = Prisma.PlayerGetPayload<{ include: typeof PLAYER_INCLUDE }>;

const TOURNAMENT_SELECT = {
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

export interface PlayerSummary {
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

export interface PlayerStats {
  matches_played: number;
  avg_kills: number | null;
  avg_deaths: number | null;
  avg_assists: number | null;
  mvp_count: number;
  win_rate: number | null;
}

export interface PlayerDetail extends PlayerSummary {
  stats: PlayerStats;
  tournament_history: Array<{
    tournament: TournamentSummary;
    placement: string | null;
    matches_played: number;
  }>;
}

export interface PlayerStatistics extends PlayerStats {
  player_id: string;
  avg_gold: number | null;
  per_hero: Array<{
    hero: string;
    games: number;
    wins: number;
    avg_kills: number;
  }>;
}

export function toPlayerSummary(row: PlayerRow): PlayerSummary {
  return {
    id: row.id,
    slug: row.slug,
    nickname: row.nickname,
    real_name: row.real_name,
    role: row.role,
    country: row.country,
    team_id: row.team_id,
    team: row.team === null ? null : toTeamSummary(row.team),
    photo_url: row.photo_url,
    is_active: row.is_active,
  };
}

function roundOneDecimal(value: number): number {
  return Math.round(value * 10) / 10;
}

type StatRow = Prisma.PlayerMatchStatisticGetPayload<{
  include: {
    match: {
      select: {
        winner_team_id: true;
        status: true;
        tournament_id: true;
        games: { select: { game_number: true; winner_team_id: true } };
      };
    };
  };
}>;

function isCompleted(row: StatRow): boolean {
  return row.match.status === 'completed';
}

/** Rows are per game (§19): the game's winner, else the series winner. */
function wonGame(row: StatRow): boolean {
  const game = row.match.games.find((g) => g.game_number === row.game_number);
  return (game?.winner_team_id ?? row.match.winner_team_id) === row.team_id;
}

/** One entry per series: rows are per game, a series counts once. */
function perSeries(rows: StatRow[]): StatRow[] {
  const seen = new Map<string, StatRow>();
  for (const row of rows) {
    if (!seen.has(row.match_id)) seen.set(row.match_id, row);
  }
  return [...seen.values()];
}

@Injectable()
export class PlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListPlayersDto,
  ): Promise<{ data: PlayerSummary[]; meta: ListMeta }> {
    const order = query.order ?? 'asc';

    const where: Prisma.PlayerWhereInput = {};
    if (query.team_id) where.team_id = query.team_id;
    if (query.role) where.role = query.role;

    const { rows, meta } = await findPage({
      query,
      sort: { field: 'nickname', order, type: 'string' },
      where,
      findMany: (args) =>
        this.prisma.player.findMany({
          ...(args as Prisma.PlayerFindManyArgs),
          include: PLAYER_INCLUDE,
        }),
      count: (filter) => this.prisma.player.count({ where: filter }),
      sortValue: (row) => row.nickname,
    });

    return { data: rows.map(toPlayerSummary), meta };
  }

  private async statRows(playerId: string): Promise<StatRow[]> {
    return this.prisma.playerMatchStatistic.findMany({
      where: { player_id: playerId },
      include: {
        match: {
          select: {
            winner_team_id: true,
            status: true,
            tournament_id: true,
            games: { select: { game_number: true, winner_team_id: true } },
          },
        },
      },
    });
  }

  private computeStats(rows: StatRow[]): PlayerStats {
    // Averages are per game; matches played and win rate are per series.
    const completed = rows.filter(isCompleted);
    const series = perSeries(completed);
    const played = series.length;
    const won = series.filter(
      (row) => row.match.winner_team_id === row.team_id,
    ).length;
    const average = (pick: (row: StatRow) => number): number | null =>
      completed.length === 0
        ? null
        : roundOneDecimal(
            completed.reduce((sum, row) => sum + pick(row), 0) /
              completed.length,
          );

    return {
      matches_played: played,
      avg_kills: average((row) => row.kills),
      avg_deaths: average((row) => row.deaths),
      avg_assists: average((row) => row.assists),
      mvp_count: completed.filter((row) => row.mvp).length,
      win_rate: roundWinRate(won, played),
    };
  }

  async get(id: string): Promise<{ data: PlayerDetail }> {
    const player = orNotFound(
      await this.prisma.player.findUnique({
        where: { id },
        include: PLAYER_INCLUDE,
      }),
    );

    const rows = await this.statRows(id);
    const completed = perSeries(rows.filter(isCompleted));

    // tournament history groups completed matches per tournament
    const tournamentIds = [
      ...new Set(
        completed
          .map((row) => row.match.tournament_id)
          .filter((tid): tid is string => tid !== null),
      ),
    ];
    const tournaments = await this.prisma.tournament.findMany({
      where: { id: { in: tournamentIds } },
      select: TOURNAMENT_SELECT,
    });
    const tournamentById = new Map(tournaments.map((t) => [t.id, t]));

    const historyMap = new Map<
      string,
      { tournament_id: string; matches_played: number }
    >();
    for (const row of completed) {
      const tid = row.match.tournament_id;
      if (tid === null) continue;
      const existing = historyMap.get(tid) ?? {
        tournament_id: tid,
        matches_played: 0,
      };
      existing.matches_played += 1;
      historyMap.set(tid, existing);
    }

    const tournamentHistory = [...historyMap.values()]
      .map((entry) => {
        const tournament = tournamentById.get(entry.tournament_id);
        if (tournament === undefined) return null;
        return {
          tournament: {
            id: tournament.id,
            slug: tournament.slug,
            name: tournament.name,
            status: tournament.status,
            region: tournament.region,
            start_date: formatDateOnly(tournament.start_date),
            end_date: formatDateOnly(tournament.end_date),
            prize_pool: tournament.prize_pool,
            logo_url: tournament.logo_url,
            featured: tournament.featured,
            current_stage: null,
          },
          placement: null,
          matches_played: entry.matches_played,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
      .sort((a, b) => b.matches_played - a.matches_played);

    return {
      data: {
        ...toPlayerSummary(player),
        stats: this.computeStats(rows),
        tournament_history: tournamentHistory,
      },
    };
  }

  async playerMatches(
    id: string,
    query: PlayerMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    orNotFound(
      await this.prisma.player.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.MatchWhereInput = {
      playerStatistics: { some: { player_id: id } },
    };
    if (query.status) where.status = query.status;

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

  async statistics(id: string): Promise<{ data: PlayerStatistics }> {
    orNotFound(
      await this.prisma.player.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const rows = await this.statRows(id);
    const completed = rows.filter(isCompleted);
    const stats = this.computeStats(rows);

    const avgGold =
      completed.length === 0
        ? null
        : roundOneDecimal(
            completed.reduce((sum, row) => sum + row.gold, 0) /
              completed.length,
          );

    const heroMap = new Map<
      string,
      { hero: string; games: number; wins: number; kills: number }
    >();
    for (const row of completed) {
      const hero = row.hero_picked;
      if (hero === null) continue;
      const entry = heroMap.get(hero) ?? {
        hero,
        games: 0,
        wins: 0,
        kills: 0,
      };
      entry.games += 1;
      if (wonGame(row)) {
        entry.wins += 1;
      }
      entry.kills += row.kills;
      heroMap.set(hero, entry);
    }

    const perHero = [...heroMap.values()]
      .sort((a, b) => b.games - a.games)
      .slice(0, 10)
      .map((entry) => ({
        hero: entry.hero,
        games: entry.games,
        wins: entry.wins,
        avg_kills: roundOneDecimal(entry.kills / entry.games),
      }));

    return {
      data: {
        player_id: id,
        ...stats,
        avg_gold: avgGold,
        per_hero: perHero,
      },
    };
  }
}
