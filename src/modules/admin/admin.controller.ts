import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { MatchDetail } from '../matches/matches.service';
import { AdminMatchesService } from './admin-matches.service';
import { AdminService } from './admin.service';
import { AdminIdParamsDto } from './dto/admin-id-params.dto';
import { CreateMatchDto } from './dto/create-match.dto';
import { LiveMatchDto } from './dto/live-match.dto';
import { UpdateMatchDto } from './dto/update-match.dto';
import { UpsertEconomyDto } from './dto/upsert-economy.dto';
import { UpsertEquipmentDto } from './dto/upsert-equipment.dto';
import { UpsertEventsDto } from './dto/upsert-events.dto';
import { UpsertLiveStatsDto } from './dto/upsert-live-stats.dto';
import { UpsertStatisticsDto } from './dto/upsert-statistics.dto';

@Controller('admin/matches')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly adminMatches: AdminMatchesService,
  ) {}

  @Roles('admin')
  @Post()
  create(@Body() body: CreateMatchDto): Promise<{ data: MatchDetail }> {
    return this.adminMatches.create(body);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpdateMatchDto,
  ): Promise<{ data: MatchDetail }> {
    return this.adminMatches.update(params.id, body);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: AdminIdParamsDto): Promise<void> {
    await this.adminMatches.remove(params.id);
  }

  @Roles('admin')
  @Put(':id/events')
  upsertEvents(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpsertEventsDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    return this.adminMatches.upsertEvents(params.id, body.events);
  }

  @Roles('admin')
  @Put(':id/equipment')
  upsertEquipment(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpsertEquipmentDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    return this.adminMatches.upsertEquipment(params.id, body.purchases);
  }

  @Roles('admin')
  @Put(':id/live-stats')
  upsertLiveStats(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpsertLiveStatsDto,
  ): Promise<{
    data: Array<Record<string, unknown>>;
  }> {
    return this.adminMatches.upsertLiveStats(params.id, body.snapshots);
  }

  @Roles('admin')
  @Put(':id/live')
  setLive(
    @Param() params: AdminIdParamsDto,
    @Body() body: LiveMatchDto,
  ): Promise<{ data: MatchDetail }> {
    return this.adminMatches.setLive(params.id, body);
  }

  @Roles('admin')
  @Put(':id/statistics')
  upsertStatistics(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpsertStatisticsDto,
  ): Promise<{
    data: {
      match_id: string;
      teams: Array<Record<string, unknown>>;
      players: Array<Record<string, unknown>>;
    };
  }> {
    return this.adminMatches.upsertStatistics(params.id, body);
  }

  @Roles('admin')
  @Put(':id/economy')
  upsertEconomy(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpsertEconomyDto,
  ): Promise<{
    data: Array<{ team_id: string; gold: number; recorded_at: Date }>;
  }> {
    return this.adminService.upsertEconomy(params.id, body.snapshots);
  }
}
