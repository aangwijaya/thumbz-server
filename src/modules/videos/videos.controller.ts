import { Controller, Get, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PaginationMeta } from '../../common/utils/pagination';
import { ListVideosDto } from './dto/list-videos.dto';
import { VideoSummary, VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videosService: VideosService) {}

  @Public()
  @Get()
  list(
    @Query() query: ListVideosDto,
  ): Promise<{ data: VideoSummary[]; meta: PaginationMeta }> {
    return this.videosService.list(query);
  }
}
