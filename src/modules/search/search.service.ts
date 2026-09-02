import { Injectable } from '@nestjs/common';
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
  TeamSummary,
  toTeamSummary,
} from '../teams/teams.service';
import {
  PLAYER_INCLUDE,
  PlayerSummary,
  toPlayerSummary,
} from '../players/players.service';
import {
  SUMMARY_SELECT as TOURNAMENT_SUMMARY_SELECT,
  TournamentSummary,
  toTournamentSummary,
} from '../tournaments/tournaments.service';
import { VideoSummary } from '../videos/videos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchDto, SearchType } from './dto/search.dto';

export interface SearchResults {
  query: string;
  matches: MatchSummary[];
  teams: TeamSummary[];
  players: PlayerSummary[];
  tournaments: TournamentSummary[];
  videos: VideoSummary[];
}

type SearchListKey = Exclude<keyof SearchResults, 'query'>;

interface EntitySearch<T> {
  rows: T[];
  total: number;
}

function relevanceScore(
  slug: string | null | undefined,
  text: string | null | undefined,
  q: string,
): number {
  const needle = q.toLowerCase();
  const slugLower = slug?.toLowerCase();
  const textLower = text?.toLowerCase();
  if (slugLower === needle) return 0;
  if (slugLower?.startsWith(needle)) return 1;
  if (textLower === needle) return 0;
  if (textLower?.startsWith(needle)) return 2;
  if (textLower?.includes(needle) || slugLower?.includes(needle)) return 3;
  return 4;
}

const ALL_TYPES: Array<Exclude<SearchType, 'all'>> = [
  'match',
  'team',
  'player',
  'tournament',
  'video',
];

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    query: SearchDto,
  ): Promise<{ data: SearchResults; meta: PaginationMeta }> {
    const q = query.q;
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 20);
    const types: Array<Exclude<SearchType, 'all'>> =
      query.type === undefined || query.type === 'all'
        ? ALL_TYPES
        : [query.type];

    const contains: Prisma.StringFilter = {
      contains: q,
      mode: 'insensitive',
    };

    const searchByType = async (
      type: Exclude<SearchType, 'all'>,
    ): Promise<{ key: SearchListKey; result: EntitySearch<unknown> }> => {
      switch (type) {
        case 'match': {
          const where: Prisma.MatchWhereInput = {
            OR: [
              { teamA: { name: contains } },
              { teamB: { name: contains } },
              { tournament: { name: contains } },
            ],
          };
          const [rows, total] = await Promise.all([
            this.prisma.match.findMany({
              where,
              orderBy: { scheduled_at: 'desc' },
              include: SUMMARY_INCLUDE,
            }),
            this.prisma.match.count({ where }),
          ]);
          return {
            key: 'matches',
            result: { rows: rows.map(toMatchSummary), total },
          };
        }
        case 'team': {
          const where: Prisma.TeamWhereInput = {
            OR: [{ name: contains }, { slug: contains }],
          };
          const [rows, total] = await Promise.all([
            this.prisma.team.findMany({ where, select: TEAM_SUMMARY_SELECT }),
            this.prisma.team.count({ where }),
          ]);
          return {
            key: 'teams',
            result: {
              rows: rows
                .map((row) => toTeamSummary(row))
                .sort(
                  (a, b) =>
                    relevanceScore(a.slug, a.name, q) -
                      relevanceScore(b.slug, b.name, q) ||
                    a.name.localeCompare(b.name),
                ),
              total,
            },
          };
        }
        case 'player': {
          const where: Prisma.PlayerWhereInput = {
            OR: [
              { nickname: contains },
              { real_name: contains },
              { slug: contains },
            ],
          };
          const [rows, total] = await Promise.all([
            this.prisma.player.findMany({ where, include: PLAYER_INCLUDE }),
            this.prisma.player.count({ where }),
          ]);
          return {
            key: 'players',
            result: {
              rows: rows
                .map((row) => toPlayerSummary(row))
                .sort(
                  (a, b) =>
                    relevanceScore(a.slug, a.nickname, q) -
                      relevanceScore(b.slug, b.nickname, q) ||
                    a.nickname.localeCompare(b.nickname),
                ),
              total,
            },
          };
        }
        case 'tournament': {
          const where: Prisma.TournamentWhereInput = {
            OR: [{ name: contains }, { slug: contains }],
          };
          const [rows, total] = await Promise.all([
            this.prisma.tournament.findMany({
              where,
              select: TOURNAMENT_SUMMARY_SELECT,
            }),
            this.prisma.tournament.count({ where }),
          ]);
          return {
            key: 'tournaments',
            result: {
              rows: rows
                .map((row) => toTournamentSummary(row))
                .sort(
                  (a, b) =>
                    relevanceScore(a.slug, a.name, q) -
                      relevanceScore(b.slug, b.name, q) ||
                    a.name.localeCompare(b.name),
                ),
              total,
            },
          };
        }
        case 'video': {
          const where: Prisma.VideoWhereInput = { title: contains };
          const [rows, total] = await Promise.all([
            this.prisma.video.findMany({ where }),
            this.prisma.video.count({ where }),
          ]);
          return {
            key: 'videos',
            result: {
              rows: rows
                .map((row) => ({
                  id: row.id,
                  match_id: row.match_id,
                  title: row.title,
                  type: row.type,
                  url: row.url,
                  thumbnail_url: row.thumbnail_url,
                  duration_seconds: row.duration_seconds,
                  published_at: row.published_at,
                }))
                .sort(
                  (a, b) =>
                    relevanceScore(null, a.title, q) -
                      relevanceScore(null, b.title, q) ||
                    a.title.localeCompare(b.title),
                ),
              total,
            },
          };
        }
      }
    };

    const searched = await Promise.all(types.map(searchByType));

    const empty: Record<
      'matches' | 'teams' | 'players' | 'tournaments' | 'videos',
      unknown[]
    > = {
      matches: [],
      teams: [],
      players: [],
      tournaments: [],
      videos: [],
    };
    for (const { key, result } of searched) {
      empty[key] = result.rows.slice(
        (page - 1) * pageSize,
        (page - 1) * pageSize + pageSize,
      );
    }

    const total = searched.reduce((sum, { result }) => sum + result.total, 0);

    return {
      data: {
        query: q,
        matches: empty.matches as MatchSummary[],
        teams: empty.teams as SearchResults['teams'],
        players: empty.players as PlayerSummary[],
        tournaments: empty.tournaments as TournamentSummary[],
        videos: empty.videos as VideoSummary[],
      },
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }
}
