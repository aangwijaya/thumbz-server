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
import { TeamSummary } from '../teams/teams.service';
import { AdminTeamsService } from './admin-teams.service';
import { AdminIdParamsDto } from './dto/admin-id-params.dto';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';

@Controller('admin/teams')
export class AdminTeamsController {
  constructor(private readonly adminTeams: AdminTeamsService) {}

  @Roles('admin')
  @Post()
  create(@Body() body: CreateTeamDto): Promise<{ data: TeamSummary }> {
    return this.adminTeams.create(body);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpdateTeamDto,
  ): Promise<{ data: TeamSummary }> {
    return this.adminTeams.update(params.id, body);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: AdminIdParamsDto): Promise<void> {
    await this.adminTeams.remove(params.id);
  }
}
