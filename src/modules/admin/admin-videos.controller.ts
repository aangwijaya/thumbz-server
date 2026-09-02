import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { VideoSummary } from '../videos/videos.service';
import { AdminVideosService } from './admin-videos.service';
import { AdminIdParamsDto } from './dto/admin-id-params.dto';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';

@Controller('admin/videos')
export class AdminVideosController {
  constructor(private readonly adminVideos: AdminVideosService) {}

  @Roles('admin')
  @Post()
  create(@Body() body: CreateVideoDto): Promise<{ data: VideoSummary }> {
    return this.adminVideos.create(body);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpdateVideoDto,
  ): Promise<{ data: VideoSummary }> {
    return this.adminVideos.update(params.id, body);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: AdminIdParamsDto): Promise<void> {
    await this.adminVideos.remove(params.id);
  }
}
