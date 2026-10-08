import { Injectable } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import {
  PLAYER_INCLUDE,
  PlayerSummary,
  toPlayerSummary,
} from '../players/players.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePlayerDto } from './dto/create-player.dto';
import { UpdatePlayerDto } from './dto/update-player.dto';
import { orNotFound } from '../../common/utils/not-found';

@Injectable()
export class AdminPlayersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreatePlayerDto): Promise<{ data: PlayerSummary }> {
    await this.ensureTeamExists(dto.team_id);

    await this.prisma.player.create({
      data: {
        slug: dto.slug,
        nickname: dto.nickname,
        real_name: dto.real_name,
        role: dto.role,
        country: dto.country,
        team_id: dto.team_id,
        photo_url: dto.photo_url,
        is_active: dto.is_active,
      },
    });

    return this.getSummary(dto.slug, 'slug');
  }

  async update(
    id: string,
    dto: UpdatePlayerDto,
  ): Promise<{ data: PlayerSummary }> {
    orNotFound(
      await this.prisma.player.findUnique({
        where: { id },
        select: { id: true },
      }),
    );
    await this.ensureTeamExists(dto.team_id);

    await this.prisma.player.update({
      where: { id },
      data: {
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.nickname !== undefined && { nickname: dto.nickname }),
        ...(dto.real_name !== undefined && { real_name: dto.real_name }),
        ...(dto.role !== undefined && { role: dto.role }),
        ...(dto.country !== undefined && { country: dto.country }),
        ...(dto.team_id !== undefined && { team_id: dto.team_id }),
        ...(dto.photo_url !== undefined && { photo_url: dto.photo_url }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });

    return this.getSummary(id, 'id');
  }

  async remove(id: string): Promise<void> {
    orNotFound(
      await this.prisma.player.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const statsCount = await this.prisma.playerMatchStatistic.count({
      where: { player_id: id },
    });
    if (statsCount > 0) {
      throw new BusinessRuleException(
        'Cannot delete a player that has match statistics',
      );
    }

    await this.prisma.player.delete({ where: { id } });
  }

  private async ensureTeamExists(
    teamId: string | null | undefined,
  ): Promise<void> {
    if (teamId === undefined || teamId === null) {
      return;
    }
    orNotFound(
      await this.prisma.team.findUnique({
        where: { id: teamId },
        select: { id: true },
      }),
    );
  }

  private async getSummary(
    value: string,
    key: 'id' | 'slug',
  ): Promise<{ data: PlayerSummary }> {
    const row = orNotFound(
      await this.prisma.player.findUnique({
        where: key === 'id' ? { id: value } : { slug: value },
        include: PLAYER_INCLUDE,
      }),
    );
    return { data: toPlayerSummary(row) };
  }
}
