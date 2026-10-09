import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { MatchIdParamsDto } from '../matches/dto/match-id-params.dto';
import { ListVideosDto } from './dto/list-videos.dto';
import { VideoSummary, VideosService } from './videos.service';
import { Cached } from '../../infra/cache/cached.decorator';
import { CacheTags } from '../../infra/cache/cache-tags';
import { ListMeta } from '../../common/utils/find-page';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get()
  list(
    @Query() query: ListVideosDto,
  ): Promise<{ data: VideoSummary[]; meta: ListMeta }> {
    return this.videosService.list(query);
  }

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get(':id')
  get(@Param() params: MatchIdParamsDto): Promise<{ data: VideoSummary }> {
    return this.videosService.get(params.id);
  }
}
