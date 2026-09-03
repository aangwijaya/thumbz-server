import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginationMeta } from '../../common/utils/pagination';
import { MatchEconomyDto } from './dto/match-economy.dto';
import { MatchIdParamsDto } from './dto/match-id-params.dto';
import { ListMatchesDto } from './dto/list-matches.dto';
import { UpcomingMatchesDto } from './dto/upcoming-matches.dto';
import { MatchDetail, MatchSummary, MatchesService } from './matches.service';
@Controller('matches')
export class MatchesController {
  constructor(private readonly matchesService: MatchesService) {}

  @Public()
  @Get()
  list(
    @Query() query: ListMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.matchesService.list(query);
  }

  @Public()
  @Get('live')
  live(
    @Query() query: PaginationQueryDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.matchesService.live(query.page, query.pageSize);
  }

  @Public()
  @Get('upcoming')
  upcoming(
    @Query() query: UpcomingMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.matchesService.upcoming(query);
  }

  @Public()
  @Get('featured')
  featured(): Promise<{ data: MatchDetail | null }> {
    return this.matchesService.featured();
  }

  @Public()
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
  @Get(':id/roster')
  roster(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: Array<Record<string, unknown>> }> {
    return this.matchesService.roster(params.id);
  }

  @Public()
  @Get(':id/history')
  history(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: MatchSummary[] }> {
    return this.matchesService.history(params.id);
  }

  @Public()
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
  @Get(':id/equipment')
  equipment(@Param() params: MatchIdParamsDto): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    return this.matchesService.equipment(params.id);
  }

  @Public()
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
  @Get(':id/economy')
  economy(
    @Param() params: MatchIdParamsDto,
    @Query() query: MatchEconomyDto,
  ): Promise<{
    data: Array<{ team_id: string; gold: number; recorded_at: Date }>;
  }> {
    return this.matchesService.economy(params.id, query);
  }

  @Public()
  @Get(':id/broadcasts')
  broadcasts(@Param() params: MatchIdParamsDto): Promise<{
    data: Array<{ language: string; stream_url: string; viewer_count: number }>;
  }> {
    return this.matchesService.broadcasts(params.id);
  }

  @Public()
  @Get(':id/related')
  related(
    @Param() params: MatchIdParamsDto,
  ): Promise<{ data: MatchSummary[] }> {
    return this.matchesService.related(params.id);
  }

  @Public()
  @Get(':id')
  get(@Param() params: MatchIdParamsDto): Promise<{ data: MatchDetail }> {
    return this.matchesService.get(params.id);
  }
}
