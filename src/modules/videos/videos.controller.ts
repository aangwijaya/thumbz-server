import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { ListVideosDto } from './dto/list-videos.dto';
import { VideoSummary, VideosService } from './videos.service';
import { Cached } from '../../infra/cache/cached.decorator';
import { CacheTags } from '../../infra/cache/cache-tags';

@ApiTags('videos')
@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Public()
  @Cached({ ttl: 60, tags: () => [CacheTags.catalog] })
  @Get()
  list(
    @Query() query: ListVideosDto,
  ): Promise<{ data: VideoSummary[]; meta: PaginationMeta }> {
    return this.videosService.list(query);
  }
}
