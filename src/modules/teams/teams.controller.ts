import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { MatchSummary } from '../matches/matches.service';
import { ListTeamsDto } from './dto/list-teams.dto';
import { TeamIdParamsDto } from './dto/team-id-params.dto';
import { TeamMatchesDto } from './dto/team-matches.dto';
import {
  RosterPlayer,
  TeamDetail,
  TeamStatistics,
  TeamSummary,
  TeamsService,
} from './teams.service';

@ApiTags('teams')
@Controller('teams')
export class TeamsController {
  constructor(private readonly teamsService: TeamsService) {}

  @Public()
  @Get()
  list(
    @Query() query: ListTeamsDto,
  ): Promise<{ data: TeamSummary[]; meta: PaginationMeta }> {
    return this.teamsService.list(query);
  }

  @Public()
  @Get(':id/statistics')
  statistics(
    @Param() params: TeamIdParamsDto,
  ): Promise<{ data: TeamStatistics }> {
    return this.teamsService.statistics(params.id);
  }

  @Public()
  @Get(':id/roster')
  roster(@Param() params: TeamIdParamsDto): Promise<{ data: RosterPlayer[] }> {
    return this.teamsService.roster(params.id);
  }

  @Public()
  @Get(':id/matches')
  teamMatches(
    @Param() params: TeamIdParamsDto,
    @Query() query: TeamMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.teamsService.teamMatches(params.id, query);
  }

  @Public()
  @Get(':id')
  get(@Param() params: TeamIdParamsDto): Promise<{ data: TeamDetail }> {
    return this.teamsService.get(params.id);
  }
}
