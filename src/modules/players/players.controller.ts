import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
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
import { Cached } from '../../infra/cache/cached.decorator';
import { CacheTags } from '../../infra/cache/cache-tags';
import { ListMeta } from '../../common/utils/find-page';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly playersService: PlayersService) {}

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get()
  list(
    @Query() query: ListPlayersDto,
  ): Promise<{ data: PlayerSummary[]; meta: ListMeta }> {
    return this.playersService.list(query);
  }

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get(':id/matches')
  playerMatches(
    @Param() params: PlayerIdParamsDto,
    @Query() query: PlayerMatchesDto,
  ): Promise<{ data: MatchSummary[]; meta: PaginationMeta }> {
    return this.playersService.playerMatches(params.id, query);
  }

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get(':id/statistics')
  statistics(
    @Param() params: PlayerIdParamsDto,
  ): Promise<{ data: PlayerStatistics }> {
    return this.playersService.statistics(params.id);
  }

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get(':id')
  get(@Param() params: PlayerIdParamsDto): Promise<{ data: PlayerDetail }> {
    return this.playersService.get(params.id);
  }
}
