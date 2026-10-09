import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginationMeta } from '../../common/utils/pagination';
import { MatchEconomyDto, MatchGameQueryDto } from './dto/match-economy.dto';
import { MatchIdParamsDto } from './dto/match-id-params.dto';
import { ListMatchesDto } from './dto/list-matches.dto';
import { UpcomingMatchesDto } from './dto/upcoming-matches.dto';
import { MatchDetail, MatchSummary, MatchesService } from './matches.service';
import { Cached } from '../../infra/cache/cached.decorator';
import { CacheTags } from '../../infra/cache/cache-tags';
import { ListMeta } from '../../common/utils/find-page';
@ApiTags('matches')
@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Public()
  @Cached({ ttl: 30, tags: () => [CacheTags.matches, CacheTags.catalog] })
  @Get()
  list(
    @Query() query: ListMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: ListMeta }> {
    return this.matchesService.list(query);
  }

  @Public()
  @Cached({ ttl: 10, tags: () => [CacheTags.live, CacheTags.catalog] })
  @Get('live')
  live(
    @Query() query: PaginationQueryDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.matchesService.live(query.page, query.pageSize);
  }

  @Public()
  @Cached({ ttl: 30, tags: () => [CacheTags.matches, CacheTags.catalog] })
  @Get('upcoming')
  upcoming(
    @Query() query: UpcomingMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.matchesService.upcoming(query);
  }

  @Public()
  @Cached({ ttl: 10, tags: () => [CacheTags.live, CacheTags.catalog] })
  @Get('featured')
  featured(): Promise<{ data: MatchDetail | null }> {
    return this.matchesService.featured();
  }

  @Public()
  @Cached({
    ttl: 15,
    tags: ({ id }) => [CacheTags.match(id), CacheTags.catalog],
  })
  @Get(':id/statistics')
  statistics(@Param() params: MatchIdParamsDto): Promise<{
    data: {
      match_id: string;
      teams: Array<Record<string, unknown>>;
      players: Array<Record<string, unknown>>;
    };
  }> {
    return this.matchesService.statistics(params.id);
  }

  @Public()
  @Cached({
    ttl: 60,
    tags: ({ id }) => [CacheTags.match(id), CacheTags.catalog],
  })
  @Get(':id/roster')
  roster(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    return this.matchesService.roster(params.id);
  }

  @Public()
  @Cached({
    ttl: 60,
    tags: ({ id }) => [CacheTags.match(id), CacheTags.catalog],
  })
  @Get(':id/history')
  history(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: MatchSummary[] }> {
    return this.matchesService.history(params.id);
  }

  @Public()
  @Cached({ ttl: 3, tags: ({ id }) => [CacheTags.matchLive(id)] })
  @Get(':id/events')
  events(
    @Param() params: MatchIdParamsDto,
    @Query() query: MatchEconomyDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    return this.matchesService.events(params.id, query);
  }

  @Public()
  @Cached({ ttl: 3, tags: ({ id }) => [CacheTags.matchLive(id)] })
  @Get(':id/equipment')
  equipment(
    @Param() params: MatchIdParamsDto,
    @Query() query: MatchGameQueryDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    return this.matchesService.equipment(params.id, query);
  }

  @Public()
  @Cached({ ttl: 3, tags: ({ id }) => [CacheTags.matchLive(id)] })
  @Get(':id/live-stats')
  liveStats(
    @Param() params: MatchIdParamsDto,
    @Query() query: MatchEconomyDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    return this.matchesService.liveStats(params.id, query);
  }

  @Public()
  @Cached({ ttl: 3, tags: ({ id }) => [CacheTags.matchLive(id)] })
  @Get(':id/economy')
  economy(
    @Param() params: MatchIdParamsDto,
    @Query() query: MatchEconomyDto,
  ): Promise<{
    data: Array<{
      team_id: string;
      gold: number;
      game_number: number;
      recorded_at: Date;
    }>;
  }> {
    return this.matchesService.economy(params.id, query);
  }

  @Public()
  @Cached({ ttl: 10, tags: ({ id }) => [CacheTags.matchLive(id)] })
  @Get(':id/broadcasts')
  broadcasts(@Param() params: MatchIdParamsDto): Promise<{
    data: Array<{ language: string; stream_url: string; viewer_count: number }>;
  }> {
    return this.matchesService.broadcasts(params.id);
  }

  @Public()
  @Cached({
    ttl: 60,
    tags: ({ id }) => [CacheTags.match(id), CacheTags.catalog],
  })
  @Get(':id/related')
  related(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: MatchSummary[] }> {
    return this.matchesService.related(params.id);
  }

  @Public()
  @Cached({
    ttl: 10,
    tags: ({ id }) => [CacheTags.match(id), CacheTags.catalog],
  })
  @Get(':id')
  get(@Param() params: MatchIdParamsDto): Promise<{ data: MatchDetail }> {
    return this.matchesService.get(params.id);
  }
}
