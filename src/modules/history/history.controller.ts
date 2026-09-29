import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Query,
} from '@nestjs/common';
import {
  CurrentUser,
  CurrentUser as CurrentUserPayload,
} from '../../common/decorators/current-user.decorator';
import { PaginationQueryDto } from '../../common/dto/pagination.dto';
import { PaginationMeta } from '../../common/utils/pagination';
import { HistoryMatchParamsDto } from './dto/history-match-params.dto';
import { UpdateWatchHistoryDto } from './dto/update-watch-history.dto';
import { HistoryService, WatchHistoryItem } from './history.service';

@Controller('me/history')
export class HistoryController {
  constructor(private readonly historyService: HistoryService) {}

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query() query: PaginationQueryDto,
  ): Promise<{ data: WatchHistoryItem[]; meta: PaginationMeta }> {
    return this.historyService.list(user.sub, query.page, query.pageSize);
  }

  @Put(':matchId')
  put(
    @Param() params: HistoryMatchParamsDto,
    @CurrentUser() user: CurrentUserPayload,
    @Body() body: UpdateWatchHistoryDto,
  ): Promise<{ data: WatchHistoryItem }> {
    return this.historyService.put(
      user.sub,
      params.matchId,
      body.duration_seconds,
      body.total_seconds,
    );
  }

  @Delete(':matchId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param() params: HistoryMatchParamsDto,
    @CurrentUser() user: CurrentUserPayload,
  ): Promise<void> {
    await this.historyService.remove(user.sub, params.matchId);
  }
}
