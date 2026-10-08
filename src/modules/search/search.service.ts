import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  buildPaginationMeta,
  PaginationMeta,
} from '../../common/utils/pagination';
import {
  MatchSummary,
  SUMMARY_INCLUDE,
  toMatchSummary,
} from '../matches/matches.service';
import {
  PLAYER_INCLUDE,
  PlayerSummary,
  toPlayerSummary,
} from '../players/players.service';
import {
  SUMMARY_SELECT as TEAM_SUMMARY_SELECT,
  TeamSummary,
  toTeamSummary,
} from '../teams/teams.service';
import {
  SUMMARY_SELECT as TOURNAMENT_SUMMARY_SELECT,
  TournamentSummary,
  toTournamentSummary,
} from '../tournaments/tournaments.service';
import {
  toVideoSummary,
  VIDEO_INCLUDE,
  VideoSummary,
} from '../videos/videos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { SearchDto, SearchType, SuggestDto } from './dto/search.dto';
import { buildSearchTerms, SearchTerms } from './search-terms';

export interface SearchResults {
  query: string;
  matches: MatchSummary[];
  teams: TeamSummary[];
  players: PlayerSummary[];
  tournaments: TournamentSummary[];
  videos: VideoSummary[];
}

export type SearchCounts = Record<
  Exclude<keyof SearchResults, 'query'>,
  number
>;

export interface SearchSuggestion {
  type: 'team' | 'player' | 'tournament';
  id: string;
  slug: string;
  label: string;
  /** Secondary line: player's team / real name, team region, tournament status. */
  sublabel: string | null;
  image_url: string | null;
}

type EntityType = Exclude<SearchType, 'all' | 'match'>;

/**
 * Whitelisted per-entity SQL fragments. Identifiers never come from input;
 * only `q` and its derived terms are bound as parameters.
 */
const ENTITY_SQL: Record<
  EntityType,
  { table: Prisma.Sql; label: Prisma.Sql; slug: Prisma.Sql | null }
> = {
  team: {
    table: Prisma.sql`teams`,
    label: Prisma.sql`name`,
    slug: Prisma.sql`slug`,
  },
  player: {
    table: Prisma.sql`players`,
    label: Prisma.sql`nickname`,
    slug: Prisma.sql`slug`,
  },
  tournament: {
    table: Prisma.sql`tournaments`,
    label: Prisma.sql`name`,
    slug: Prisma.sql`slug`,
  },
  video: { table: Prisma.sql`videos`, label: Prisma.sql`title`, slug: null },
};

const ALL_TYPES: Array<Exclude<SearchType, 'all'>> = [
  'match',
  'team',
  'player',
  'tournament',
  'video',
];

/** Candidate teams/tournaments considered when searching matches by name. */
const MATCH_ENTITY_CANDIDATES = 50;

function orderedBy<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.map((id) => byId.get(id)).filter((row): row is T => !!row);
}

@Injectable()
export class SearchService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Ranked, typo-tolerant search. Per entity: matches on the full-text
   * document (token prefixes), substring (trigram index) or trigram
   * similarity; ranked by exact/prefix hits, ts_rank and similarity, with
   * paging done in SQL.
   */
  async search(query: SearchDto): Promise<{
    data: SearchResults;
    meta: PaginationMeta & { counts: SearchCounts };
  }> {
    const terms = buildSearchTerms(query.q);
    const page = query.page ?? 1;
    const pageSize = Math.min(query.pageSize ?? 20, 20);
    const offset = (page - 1) * pageSize;
    const types =
      query.type === undefined || query.type === 'all'
        ? ALL_TYPES
        : [query.type];

    const data: SearchResults = {
      query: terms.q,
      matches: [],
      teams: [],
      players: [],
      tournaments: [],
      videos: [],
    };
    const counts: SearchCounts = {
      matches: 0,
      teams: 0,
      players: 0,
      tournaments: 0,
      videos: 0,
    };

    await Promise.all(
      types.map(async (type) => {
        switch (type) {
          case 'match': {
            const result = await this.searchMatches(terms, pageSize, offset);
            data.matches = result.rows;
            counts.matches = result.total;
            return;
          }
          case 'team': {
            const { ids, total } = await this.rank(
              'team',
              terms,
              pageSize,
              offset,
            );
            const rows = await this.prisma.team.findMany({
              where: { id: { in: ids } },
              select: TEAM_SUMMARY_SELECT,
            });
            data.teams = orderedBy(ids, rows).map((row) => toTeamSummary(row));
            counts.teams = total;
            return;
          }
          case 'player': {
            const { ids, total } = await this.rank(
              'player',
              terms,
              pageSize,
              offset,
            );
            const rows = await this.prisma.player.findMany({
              where: { id: { in: ids } },
              include: PLAYER_INCLUDE,
            });
            data.players = orderedBy(ids, rows).map((row) =>
              toPlayerSummary(row),
            );
            counts.players = total;
            return;
          }
          case 'tournament': {
            const { ids, total } = await this.rank(
              'tournament',
              terms,
              pageSize,
              offset,
            );
            const rows = await this.prisma.tournament.findMany({
              where: { id: { in: ids } },
              select: TOURNAMENT_SUMMARY_SELECT,
            });
            data.tournaments = orderedBy(ids, rows).map((row) =>
              toTournamentSummary(row),
            );
            counts.tournaments = total;
            return;
          }
          case 'video': {
            const { ids, total } = await this.rank(
              'video',
              terms,
              pageSize,
              offset,
            );
            const rows = await this.prisma.video.findMany({
              where: { id: { in: ids } },
              include: VIDEO_INCLUDE,
            });
            data.videos = orderedBy(ids, rows).map((row) =>
              toVideoSummary(row),
            );
            counts.videos = total;
            return;
          }
        }
      }),
    );

    const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
    return {
      data,
      meta: { ...buildPaginationMeta(page, pageSize, total), counts },
    };
  }

  /** Typeahead: a few best teams, players and tournaments for the header box. */
  async suggest(query: SuggestDto): Promise<{ data: SearchSuggestion[] }> {
    const terms = buildSearchTerms(query.q);
    const limit = query.limit ?? 8;
    const [teams, players, tournaments] = await Promise.all([
      this.rank('team', terms, limit, 0, false),
      this.rank('player', terms, limit, 0, false),
      this.rank('tournament', terms, limit, 0, false),
    ]);

    const [teamRows, playerRows, tournamentRows] = await Promise.all([
      this.prisma.team.findMany({
        where: { id: { in: teams.ids } },
        select: {
          id: true,
          slug: true,
          name: true,
          region: true,
          logo_url: true,
        },
      }),
      this.prisma.player.findMany({
        where: { id: { in: players.ids } },
        select: {
          id: true,
          slug: true,
          nickname: true,
          real_name: true,
          photo_url: true,
          team: { select: { name: true } },
        },
      }),
      this.prisma.tournament.findMany({
        where: { id: { in: tournaments.ids } },
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          logo_url: true,
        },
      }),
    ]);

    // Interleave by rank so one entity type cannot crowd out the others.
    const lists: SearchSuggestion[][] = [
      orderedBy(teams.ids, teamRows).map((row) => ({
        type: 'team' as const,
        id: row.id,
        slug: row.slug,
        label: row.name,
        sublabel: row.region,
        image_url: row.logo_url,
      })),
      orderedBy(players.ids, playerRows).map((row) => ({
        type: 'player' as const,
        id: row.id,
        slug: row.slug,
        label: row.nickname,
        sublabel: row.team?.name ?? row.real_name,
        image_url: row.photo_url,
      })),
      orderedBy(tournaments.ids, tournamentRows).map((row) => ({
        type: 'tournament' as const,
        id: row.id,
        slug: row.slug,
        label: row.name,
        sublabel: row.status,
        image_url: row.logo_url,
      })),
    ];
    const merged: SearchSuggestion[] = [];
    for (let rank = 0; merged.length < limit; rank += 1) {
      const round = lists.map((list) => list[rank]).filter(Boolean);
      if (round.length === 0) break;
      merged.push(...round);
    }
    return { data: merged.slice(0, limit) };
  }

  private async rank(
    type: EntityType,
    terms: SearchTerms,
    limit: number,
    offset: number,
    withTotal = true,
  ): Promise<{ ids: string[]; total: number }> {
    const { table, label, slug } = ENTITY_SQL[type];
    const tsquery = terms.tsquery
      ? Prisma.sql`to_tsquery('simple', ${terms.tsquery})`
      : null;

    const where = Prisma.join(
      [
        ...(tsquery ? [Prisma.sql`search_document @@ ${tsquery}`] : []),
        Prisma.sql`${label} ILIKE ${terms.contains}`,
        Prisma.sql`${label} % ${terms.q}`,
      ],
      ' OR ',
    );
    const exact = slug
      ? Prisma.sql`(lower(${label}) = lower(${terms.q}) OR ${slug} = ${terms.slug})`
      : Prisma.sql`lower(${label}) = lower(${terms.q})`;
    const score = Prisma.sql`(
      CASE WHEN ${exact} THEN 4 ELSE 0 END
      + CASE WHEN ${label} ILIKE ${terms.prefix} THEN 2 ELSE 0 END
      + ${tsquery ? Prisma.sql`ts_rank(search_document, ${tsquery})` : Prisma.sql`0`}
      + similarity(${label}, ${terms.q})
    )`;

    const [rows, counted] = await Promise.all([
      this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM ${table}
        WHERE ${where}
        ORDER BY ${score} DESC, ${label} ASC, id ASC
        LIMIT ${limit} OFFSET ${offset}`,
      withTotal
        ? this.prisma.$queryRaw<Array<{ total: bigint }>>`
            SELECT count(*) AS total FROM ${table} WHERE ${where}`
        : Promise.resolve([{ total: 0n }]),
    ]);
    return {
      ids: rows.map((row) => row.id),
      total: Number(counted[0]?.total ?? 0n),
    };
  }

  /** Matches whose team (A or B) or tournament matches the query. */
  private async searchMatches(
    terms: SearchTerms,
    limit: number,
    offset: number,
  ): Promise<{ rows: MatchSummary[]; total: number }> {
    const [teams, tournaments] = await Promise.all([
      this.rank('team', terms, MATCH_ENTITY_CANDIDATES, 0, false),
      this.rank('tournament', terms, MATCH_ENTITY_CANDIDATES, 0, false),
    ]);
    if (teams.ids.length === 0 && tournaments.ids.length === 0) {
      return { rows: [], total: 0 };
    }
    const where: Prisma.MatchWhereInput = {
      OR: [
        { team_a_id: { in: teams.ids } },
        { team_b_id: { in: teams.ids } },
        { tournament_id: { in: tournaments.ids } },
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.match.findMany({
        where,
        orderBy: [{ scheduled_at: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        include: SUMMARY_INCLUDE,
      }),
      this.prisma.match.count({ where }),
    ]);
    return { rows: rows.map(toMatchSummary), total };
  }
}
