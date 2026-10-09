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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlayerSummary } from '../players/players.service';
import { AdminPlayersService } from './admin-players.service';
import { AdminIdParamsDto } from './dto/admin-id-params.dto';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';

@ApiTags('admin')
@ApiBearerAuth()
@Controller('admin/players')
export class AdminPlayersController {
  constructor(private readonly adminPlayers: AdminPlayersService) {}

  @Roles('admin')
  @Post()
  create(@Body() body: CreatePlayerDto): Promise<{ data: PlayerSummary }> {
    return this.adminPlayers.create(body);
  }

  @Roles('admin')
  @Patch(':id')
  update(
    @Param() params: AdminIdParamsDto,
    @Body() body: UpdatePlayerDto,
  ): Promise<{ data: PlayerSummary }> {
    return this.adminPlayers.update(params.id, body);
  }

  @Roles('admin')
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param() params: AdminIdParamsDto): Promise<void> {
    await this.adminPlayers.remove(params.id);
  }
}
