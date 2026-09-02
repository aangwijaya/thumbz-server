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
import { TournamentSummary } from '../tournaments/tournaments.service';
import { AdminTournamentsService } from './admin-tournaments.service';
import { AdminIdParamsDto } from './dto/admin-id-params.dto';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';

@Controller('admin/tournaments')
export class AdminTournamentsController {
  constructor(private readonly adminTournaments: AdminTournamentsService) {}

  @Roles('admin')
  @Post()
  create(
    @Body() body: CreateTournamentDto,
  ): Promise<{ data: TournamentSummary }> {
    return this.adminTournaments.create(body);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpdateTournamentDto,
  ): Promise<{ data: TournamentSummary }> {
    return this.adminTournaments.update(params.id, body);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: AdminIdParamsDto): Promise<void> {
    await this.adminTournaments.remove(params.id);
  }
}
