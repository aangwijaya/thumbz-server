import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
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
}
