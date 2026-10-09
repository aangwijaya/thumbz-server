import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginationMeta } from '../../common/utils/pagination';
import { MatchSummary } from '../matches/matches.service';
import { TournamentIdParamsDto } from './dto/tournament-id-params.dto';
import { ListTournamentsDto } from './dto/list-tournaments.dto';
import { TournamentScheduleDto } from './dto/tournament-schedule.dto';
import {
  TournamentDetail,
  TournamentSummary,
  TournamentsService,
} from './tournaments.service';
import { Cached } from '../../infra/cache/cached.decorator';
import { CacheTags } from '../../infra/cache/cache-tags';

@ApiTags('tournaments')
@Controller('tournaments')
export class TournamentsController {
  constructor(private readonly tournamentsService: TournamentsService) {}

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get()
  list(
    @Query() query: ListTournamentsDto,
  ): Promise<{ data: TournamentSummary[]; meta: PaginationMeta }> {
    return this.tournamentsService.list(query);
  }

  @Public()
  @Cached({
    ttl: 30,
    tags: ({ id }) => [CacheTags.tournament(id), CacheTags.catalog],
  })
  @Get(':id/schedule')
  schedule(
    @Param() params: TournamentIdParamsDto,
    @Query() query: TournamentScheduleDto,
  ): Promise<{
    data: Array<{ stage: string; matches: MatchSummary[] }>;
    meta: PaginationMeta;
  }> {
    return this.tournamentsService.schedule(params.id, query);
  }

  @Public()
  @Cached({
    ttl: 30,
    tags: ({ id }) => [CacheTags.tournament(id), CacheTags.catalog],
  })
  @Get(':id/standings')
  standings(@Param() params: TournamentIdParamsDto): Promise<{
    data: { tournament_id: string; standings: Array<Record<string, unknown>> };
  }> {
    return this.tournamentsService.standings(params.id);
  }

  @Public()
  @Cached({
    ttl: 30,
    tags: ({ id }) => [CacheTags.tournament(id), CacheTags.catalog],
  })
  @Get(':id/results')
  results(
    @Param() params: TournamentIdParamsDto,
    @Query() query: PaginationQueryDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.tournamentsService.results(
      params.id,
      query.page,
      query.pageSize,
    );
  }

  @Public()
  @Cached({
    ttl: 30,
    tags: ({ id }) => [CacheTags.tournament(id), CacheTags.catalog],
  })
  @Get(':id/stages')
  stages(@Param() params: TournamentIdParamsDto): Promise<{
    data: Array<{
      stage: string;
      match_count: number;
      completed_count: number;
      live_count: number;
    }>;
  }> {
    return this.tournamentsService.stages(params.id);
  }

  @Public()
  @Cached({
    ttl: 30,
    tags: ({ id }) => [CacheTags.tournament(id), CacheTags.catalog],
  })
  @Get(':id')
  get(
    @Param() params: TournamentIdParamsDto,
  ): Promise<{ data: TournamentDetail }> {
    return this.tournamentsService.get(params.id);
  }
}
