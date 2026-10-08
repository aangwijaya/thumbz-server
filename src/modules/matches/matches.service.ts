import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PaginationMeta,
  buildPaginationMeta,
} from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { ListMatchesDto } from './dto/list-matches.dto';
import { MatchEconomyDto } from './dto/match-economy.dto';
import { UpcomingMatchesDto } from './dto/upcoming-matches.dto';
import { orNotFound } from '../../common/utils/not-found';
import { findPage, ListMeta } from '../../common/utils/find-page';

export const SUMMARY_INCLUDE = {
  tournament: { select: { id: true, name: true, slug: true } },
  teamA: {
    select: {
      id: true,
      name: true,
      slug: true,
      logo_url: true,
      color_primary: true,
    },
  },
  teamB: {
    select: {
      id: true,
      name: true,
      slug: true,
      logo_url: true,
      color_primary: true,
    },
  },
  broadcasts: {
    orderBy: { viewer_count: 'desc' },
    select: { language: true, stream_url: true, viewer_count: true },
  },
} satisfies Prisma.MatchInclude;

export const DETAIL_INCLUDE = {
  tournament: {
    select: { id: true, name: true, slug: true, status: true, region: true },
  },
  teamA: {
    select: {
      id: true,
      slug: true,
      name: true,
      region: true,
      logo_url: true,
      color_primary: true,
      color_secondary: true,
      is_active: true,
    },
  },
  teamB: {
    select: {
      id: true,
      slug: true,
      name: true,
      region: true,
      logo_url: true,
      color_primary: true,
      color_secondary: true,
      is_active: true,
    },
  },
  broadcasts: {
    orderBy: { viewer_count: 'desc' },
    select: { language: true, stream_url: true, viewer_count: true },
  },
} satisfies Prisma.MatchInclude;

type SummaryRow = Prisma.MatchGetPayload<{ include: typeof SUMMARY_INCLUDE }>;
type DetailRow = Prisma.MatchGetPayload<{ include: typeof DETAIL_INCLUDE }>;

export interface BroadcastSummary {
  language: string;
  stream_url: string;
  viewer_count: number;
}

export interface MatchSummary {
  id: string;
  tournament_id: string | null;
  tournament: { id: string; name: string; slug: string } | null;
  stage: string | null;
  round: number | null;
  group_name: string | null;
  best_of: number;
  game_number: number | null;
  team_a: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    color_primary: string | null;
  };
  team_b: {
    id: string;
    name: string;
    slug: string;
    logo_url: string | null;
    color_primary: string | null;
  };
  score_a: number | null;
  score_b: number | null;
  winner_team_id: string | null;
  status: string;
  scheduled_at: Date;
  started_at: Date | null;
  ended_at: Date | null;
  thumbnail_url: string | null;
  viewer_count: number;
  featured: boolean;
  stream_delay_seconds: number;
  broadcasts: BroadcastSummary[];
}

export interface MatchDetail extends MatchSummary {
  stream_url: string | null;
  tournament: {
    id: string;
    name: string;
    slug: string;
    status: string;
    region: string;
  } | null;
  team_a: MatchSummary['team_a'] & {
    region: string;
    color_secondary: string | null;
    is_active: boolean;
  };
  team_b: MatchSummary['team_b'] & {
    region: string;
    color_secondary: string | null;
    is_active: boolean;
  };
}

export function toMatchSummary(row: SummaryRow): MatchSummary {
  return {
    id: row.id,
    tournament_id: row.tournament_id,
    tournament: row.tournament,
    stage: row.stage,
    round: row.round,
    group_name: row.group_name,
    best_of: row.best_of,
    game_number: row.game_number,
    team_a: {
      id: row.teamA.id,
      name: row.teamA.name,
      slug: row.teamA.slug,
      logo_url: row.teamA.logo_url,
      color_primary: row.teamA.color_primary,
    },
    team_b: {
      id: row.teamB.id,
      name: row.teamB.name,
      slug: row.teamB.slug,
      logo_url: row.teamB.logo_url,
      color_primary: row.teamB.color_primary,
    },
    score_a: row.score_a,
    score_b: row.score_b,
    winner_team_id: row.winner_team_id,
    status: row.status,
    scheduled_at: row.scheduled_at,
    started_at: row.started_at,
    ended_at: row.ended_at,
    thumbnail_url: row.thumbnail_url,
    viewer_count: row.viewer_count,
    featured: row.featured,
    stream_delay_seconds: row.stream_delay_seconds,
    broadcasts:
      row.status === 'live'
        ? row.broadcasts.map((b) => ({
            language: b.language,
            stream_url: b.stream_url,
            viewer_count: b.viewer_count,
          }))
        : [],
  };
}

export function toMatchDetail(row: DetailRow): MatchDetail {
  return {
    ...toMatchSummary(row),
    stream_url: row.stream_url,
    tournament: row.tournament,
    team_a: {
      id: row.teamA.id,
      name: row.teamA.name,
      slug: row.teamA.slug,
      logo_url: row.teamA.logo_url,
      color_primary: row.teamA.color_primary,
      color_secondary: row.teamA.color_secondary,
      region: row.teamA.region,
      is_active: row.teamA.is_active,
    },
    team_b: {
      id: row.teamB.id,
      name: row.teamB.name,
      slug: row.teamB.slug,
      logo_url: row.teamB.logo_url,
      color_primary: row.teamB.color_primary,
      color_secondary: row.teamB.color_secondary,
      region: row.teamB.region,
      is_active: row.teamB.is_active,
    },
  };
}

@Injectable()
export class MatchesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: ListMeta }> {
    const sort = query.sort ?? 'scheduled_at';
    const order = query.order ?? 'asc';

    const where: Prisma.MatchWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.tournament_id) where.tournament_id = query.tournament_id;
    if (query.team_id) {
      where.OR = [{ team_a_id: query.team_id }, { team_b_id: query.team_id }];
    }
    if (query.featured !== undefined) where.featured = query.featured;
    const scheduledAt: Prisma.DateTimeFilter = {};
    if (query.from) scheduledAt.gte = new Date(query.from);
    if (query.to) scheduledAt.lte = new Date(query.to);
    if (Object.keys(scheduledAt).length > 0) {
      where.scheduled_at = scheduledAt;
    }

    const { rows, meta } = await findPage({
      query,
      sort:
        sort === 'viewer_count'
          ? { field: 'viewer_count', order, type: 'number' }
          : { field: 'scheduled_at', order, type: 'date' },
      where,
      findMany: (args) =>
        this.prisma.match.findMany({
          ...(args as Prisma.MatchFindManyArgs),
          include: SUMMARY_INCLUDE,
        }),
      count: (filter) => this.prisma.match.count({ where: filter }),
      sortValue: (row) =>
        sort === 'viewer_count' ? row.viewer_count : row.scheduled_at,
    });

    return { data: rows.map(toMatchSummary), meta };
  }

  async live(
    page: number,
    pageSize: number,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    const where: Prisma.MatchWhereInput = { status: 'live' };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        orderBy: [{ viewer_count: 'desc' }, { started_at: 'asc' }],
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

  async upcoming(
    query: UpcomingMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.MatchWhereInput = {
      status: 'scheduled',
      scheduled_at: { gte: query.from ? new Date(query.from) : new Date() },
    };
    if (query.tournament_id) where.tournament_id = query.tournament_id;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.match.findMany({
        where,
        orderBy: { scheduled_at: 'asc' },
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

  async featured(): Promise<{ data: MatchDetail | null }> {
    const row = await this.prisma.match.findFirst({
      where: { status: 'live', featured: true },
      orderBy: { started_at: 'desc' },
      include: DETAIL_INCLUDE,
    });
    if (row === null) {
      return { data: null };
    }
    return { data: toMatchDetail(row) };
  }

  async get(id: string): Promise<{ data: MatchDetail }> {
    const row = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        include: DETAIL_INCLUDE,
      }),
    );
    return { data: toMatchDetail(row) };
  }

  async statistics(id: string): Promise<{
    data: {
      match_id: string;
      teams: Array<Record<string, unknown>>;
      players: Array<Record<string, unknown>>;
    };
  }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const teamRows = await this.prisma.matchTeamStatistic.findMany({
      where: { match_id: id },
      orderBy: { team_id: 'asc' },
      include: {
        team: {
          select: {
            id: true,
            name: true,
            slug: true,
            logo_url: true,
            color_primary: true,
          },
        },
      },
    });
    const playerRows = await this.prisma.playerMatchStatistic.findMany({
      where: { match_id: id },
      orderBy: { player: { nickname: 'asc' } },
      include: {
        player: {
          select: {
            id: true,
            nickname: true,
            slug: true,
            role: true,
            photo_url: true,
          },
        },
      },
    });

    return {
      data: {
        match_id: id,
        teams: teamRows.map((row) => ({
          team_id: row.team_id,
          team: row.team,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          gold: row.gold,
          towers_destroyed: row.towers_destroyed,
          game_duration_seconds: row.game_duration_seconds,
          details: row.details,
        })),
        players: playerRows.map((row) => ({
          player_id: row.player_id,
          player: row.player,
          team_id: row.team_id,
          kills: row.kills,
          deaths: row.deaths,
          assists: row.assists,
          gold: row.gold,
          damage: row.damage,
          damage_taken: row.damage_taken,
          level: row.level,
          hero_picked: row.hero_picked,
          mvp: row.mvp,
          details: row.details,
        })),
      },
    };
  }

  async roster(id: string): Promise<{ data: Array<Record<string, unknown>> }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const rows = await this.prisma.playerMatchStatistic.findMany({
      where: { match_id: id },
      orderBy: { player: { nickname: 'asc' } },
      include: {
        player: {
          include: {
            team: {
              select: {
                id: true,
                slug: true,
                name: true,
                region: true,
                logo_url: true,
                color_primary: true,
                color_secondary: true,
                is_active: true,
              },
            },
          },
        },
      },
    });

    return {
      data: rows.map((row) => ({
        id: row.player.id,
        slug: row.player.slug,
        nickname: row.player.nickname,
        real_name: row.player.real_name,
        role: row.player.role,
        country: row.player.country,
        team_id: row.player.team_id,
        team: row.player.team,
        photo_url: row.player.photo_url,
        is_active: row.player.is_active,
      })),
    };
  }

  async history(id: string): Promise<{ data: MatchSummary[] }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { team_a_id: true, team_b_id: true },
      }),
    );

    const rows = await this.prisma.match.findMany({
      where: {
        id: { not: id },
        status: 'completed',
        OR: [
          { team_a_id: match.team_a_id, team_b_id: match.team_b_id },
          { team_a_id: match.team_b_id, team_b_id: match.team_a_id },
        ],
      },
      orderBy: { ended_at: 'desc' },
      take: 20,
      include: SUMMARY_INCLUDE,
    });

    return { data: rows.map(toMatchSummary) };
  }

  async related(id: string): Promise<{ data: MatchSummary[] }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: {
          id: true,
          team_a_id: true,
          team_b_id: true,
          tournament_id: true,
        },
      }),
    );

    const teamIds = [match.team_a_id, match.team_b_id];
    const candidates = await this.prisma.match.findMany({
      where: {
        id: { not: id },
        OR: [
          { tournament_id: match.tournament_id },
          { team_a_id: { in: teamIds } },
          { team_b_id: { in: teamIds } },
        ],
      },
      orderBy: { scheduled_at: 'desc' },
      take: 60,
      include: SUMMARY_INCLUDE,
    });

    const isPreferred = (status: string): boolean =>
      status === 'completed' || status === 'live';
    const ranked = candidates
      .map((candidate) => ({
        match: candidate,
        score: {
          inTournament: candidate.tournament_id === match.tournament_id ? 0 : 1,
          preferred: isPreferred(candidate.status) ? 0 : 1,
        },
      }))
      .sort((a, b) => {
        if (a.score.inTournament !== b.score.inTournament) {
          return a.score.inTournament - b.score.inTournament;
        }
        if (a.score.preferred !== b.score.preferred) {
          return a.score.preferred - b.score.preferred;
        }
        return b.match.scheduled_at.getTime() - a.match.scheduled_at.getTime();
      })
      .slice(0, 12)
      .map((entry) => toMatchSummary(entry.match));

    return { data: ranked };
  }

  async economy(
    id: string,
    query: MatchEconomyDto,
  ): Promise<{
    data: Array<{ team_id: string; gold: number; recorded_at: Date }>;
  }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const where: Prisma.MatchGoldSnapshotWhereInput = { match_id: id };
    const recordedAt: Prisma.DateTimeFilter = {};
    if (query.from) recordedAt.gte = new Date(query.from);
    if (query.to) recordedAt.lte = new Date(query.to);
    if (Object.keys(recordedAt).length > 0) {
      where.recorded_at = recordedAt;
    }

    const rows = await this.prisma.matchGoldSnapshot.findMany({
      where,
      orderBy: { recorded_at: 'asc' },
      select: { team_id: true, gold: true, recorded_at: true },
    });

    return {
      data: rows.map((row) => ({
        team_id: row.team_id,
        gold: row.gold,
        recorded_at: row.recorded_at,
      })),
    };
  }

  async liveStats(
    id: string,
    query: MatchEconomyDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const where: Prisma.PlayerMatchSnapshotWhereInput = { match_id: id };
    const recordedAt: Prisma.DateTimeFilter = {};
    if (query.from) recordedAt.gte = new Date(query.from);
    if (query.to) recordedAt.lte = new Date(query.to);
    if (Object.keys(recordedAt).length > 0) {
      where.recorded_at = recordedAt;
    }

    const rows = await this.prisma.playerMatchSnapshot.findMany({
      where,
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

  async equipment(id: string): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const rows = await this.prisma.matchItemEvent.findMany({
      where: { match_id: id },
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

  async events(
    id: string,
    query: MatchEconomyDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const where: Prisma.MatchEventWhereInput = { match_id: id };
    const occurredAt: Prisma.DateTimeFilter = {};
    if (query.from) occurredAt.gte = new Date(query.from);
    if (query.to) occurredAt.lte = new Date(query.to);
    if (Object.keys(occurredAt).length > 0) {
      where.occurred_at = occurredAt;
    }

    const rows = await this.prisma.matchEvent.findMany({
      where,
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

  async broadcasts(id: string): Promise<{ data: BroadcastSummary[] }> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const rows = await this.prisma.matchBroadcast.findMany({
      where: { match_id: id },
      orderBy: { viewer_count: 'desc' },
      select: { language: true, stream_url: true, viewer_count: true },
    });

    return {
      data: rows.map((row) => ({
        language: row.language,
        stream_url: row.stream_url,
        viewer_count: row.viewer_count,
      })),
    };
  }
}
