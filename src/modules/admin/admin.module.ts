import { Module } from '@nestjs/common';
import { MatchesModule } from '../matches/matches.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { AdminMatchesService } from './admin-matches.service';
import { AdminPlayersController } from './admin-players.controller';
import { AdminPlayersService } from './admin-players.service';
import { AdminTeamsController } from './admin-teams.controller';
import { AdminTeamsService } from './admin-teams.service';
import { AdminTournamentsController } from './admin-tournaments.controller';
import { AdminTournamentsService } from './admin-tournaments.service';
import { AdminVideosController } from './admin-videos.controller';
import { AdminVideosService } from './admin-videos.service';

@Module({
  imports: [MatchesModule],
  controllers: [
    AdminController,
    AdminTournamentsController,
    AdminTeamsController,
    AdminPlayersController,
    AdminVideosController,
  ],
  providers: [
    AdminService,
    AdminMatchesService,
    AdminTournamentsService,
    AdminTeamsService,
    AdminPlayersService,
    AdminVideosService,
  ],
  exports: [AdminMatchesService, AdminService],
})
export class AdminModule {}
