import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { MatchSummary } from '../matches/matches.service';
import { ListPlayersDto } from './dto/list-players.dto';
import { PlayerIdParamsDto } from './dto/player-id-params.dto';
import { PlayerMatchesDto } from './dto/player-matches.dto';
import {
  PlayerDetail,
  PlayerStatistics,
  PlayerSummary,
  PlayersService,
} from './players.service';

@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Public()
  @Get()
  list(
    @Query() query: ListPlayersDto,
  ): Promise<{ data: PlayerSummary[]; meta: PaginationMeta }> {
    return this.playersService.list(query);
  }

  @Public()
  @Get(':id/matches')
  playerMatches(
    @Param() params: PlayerIdParamsDto,
    @Query() query: PlayerMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.playersService.playerMatches(params.id, query);
  }

  @Public()
  @Get(':id/statistics')
  statistics(
    @Param() params: PlayerIdParamsDto,
  ): Promise<{ data: PlayerStatistics }> {
    return this.playersService.statistics(params.id);
  }

  @Public()
  @Get(':id')
  get(@Param() params: PlayerIdParamsDto): Promise<{ data: PlayerDetail }> {
    return this.playersService.get(params.id);
  }
}
