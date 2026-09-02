import { Injectable, NotFoundException } from '@nestjs/common';
import { favorite_type, Prisma } from '@prisma/client';
import {
  SUMMARY_SELECT as TEAM_SUMMARY_SELECT,
  TeamSummary,
  toTeamSummary,
} from '../teams/teams.service';
import {
  PLAYER_INCLUDE,
  PlayerSummary,
  toPlayerSummary,
} from '../players/players.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface Favorite {
  entity_type: favorite_type;
  entity_id: string;
  created_at: Date;
  entity: TeamSummary | PlayerSummary | null;
}

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string): Promise<{ data: Favorite[] }> {
    const rows = await this.prisma.favorite.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });

    const teamIds = rows
      .filter((row) => row.entity_type === 'team')
      .map((row) => row.entity_id);
    const playerIds = rows
      .filter((row) => row.entity_type === 'player')
      .map((row) => row.entity_id);

    const [teams, players] = await Promise.all([
      teamIds.length > 0
        ? this.prisma.team.findMany({
            where: { id: { in: teamIds } },
            select: TEAM_SUMMARY_SELECT,
          })
        : Promise.resolve([]),
      playerIds.length > 0
        ? this.prisma.player.findMany({
            where: { id: { in: playerIds } },
            include: PLAYER_INCLUDE,
          })
        : Promise.resolve([]),
    ]);
    const teamById = new Map(teams.map((team) => [team.id, team]));
    const playerById = new Map(players.map((player) => [player.id, player]));

    return {
      data: rows.map((row) => ({
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        created_at: row.created_at,
        entity:
          row.entity_type === 'team'
            ? (() => {
                const team = teamById.get(row.entity_id);
                return team === undefined ? null : toTeamSummary(team);
              })()
            : (() => {
                const player = playerById.get(row.entity_id);
                return player === undefined ? null : toPlayerSummary(player);
              })(),
      })),
    };
  }

  async add(
    userId: string,
    entityType: favorite_type,
    entityId: string,
  ): Promise<{ data: Favorite }> {
    const exists =
      entityType === 'team'
        ? await this.prisma.team.findUnique({
            where: { id: entityId },
            select: { id: true },
          })
        : await this.prisma.player.findUnique({
            where: { id: entityId },
            select: { id: true },
          });
    if (exists === null) {
      throw new NotFoundException();
    }

    const row = await this.prisma.favorite.upsert({
      where: {
        user_id_entity_type_entity_id: {
          user_id: userId,
          entity_type: entityType,
          entity_id: entityId,
        },
      },
      update: {},
      create: {
        user_id: userId,
        entity_type: entityType,
        entity_id: entityId,
      },
    });

    return { data: await this.embed(row) };
  }

  async remove(
    userId: string,
    entityType: favorite_type,
    entityId: string,
  ): Promise<void> {
    await this.prisma.favorite.deleteMany({
      where: { user_id: userId, entity_type: entityType, entity_id: entityId },
    });
  }

  private async embed(
    row: Prisma.FavoriteGetPayload<Record<string, never>>,
  ): Promise<Favorite> {
    const { data } = await this.list(row.user_id);
    const favorite = data.find(
      (item) =>
        item.entity_type === row.entity_type &&
        item.entity_id === row.entity_id,
    );
    return (
      favorite ?? {
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        created_at: row.created_at,
        entity: null,
      }
    );
  }
}
