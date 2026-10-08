import { Injectable } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import {
  SUMMARY_SELECT as TEAM_SUMMARY_SELECT,
  TeamSummary,
  toTeamSummary,
} from '../teams/teams.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { orNotFound } from '../../common/utils/not-found';

@Injectable()
export class AdminTeamsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTeamDto): Promise<{ data: TeamSummary }> {
    await this.prisma.team.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        short_name: dto.short_name ?? null,
        region: dto.region,
        logo_url: dto.logo_url,
        color_primary: dto.color_primary,
        color_secondary: dto.color_secondary,
        description: dto.description,
        founded_year: dto.founded_year,
        is_active: dto.is_active,
      },
    });

    return this.getSummary(dto.slug, 'slug');
  }

  async update(id: string, dto: UpdateTeamDto): Promise<{ data: TeamSummary }> {
    orNotFound(
      await this.prisma.team.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    await this.prisma.team.update({
      where: { id },
      data: {
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.short_name !== undefined && { short_name: dto.short_name }),
        ...(dto.region !== undefined && { region: dto.region }),
        ...(dto.logo_url !== undefined && { logo_url: dto.logo_url }),
        ...(dto.color_primary !== undefined && {
          color_primary: dto.color_primary,
        }),
        ...(dto.color_secondary !== undefined && {
          color_secondary: dto.color_secondary,
        }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
        ...(dto.founded_year !== undefined && {
          founded_year: dto.founded_year,
        }),
        ...(dto.is_active !== undefined && { is_active: dto.is_active }),
      },
    });

    return this.getSummary(id, 'id');
  }

  async remove(id: string): Promise<void> {
    orNotFound(
      await this.prisma.team.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const [matchCount, playerCount] = await Promise.all([
      this.prisma.match.count({
        where: {
          OR: [{ team_a_id: id }, { team_b_id: id }],
        },
      }),
      this.prisma.player.count({ where: { team_id: id } }),
    ]);
    if (matchCount > 0 || playerCount > 0) {
      throw new BusinessRuleException(
        'Cannot delete a team that has matches or players',
      );
    }

    await this.prisma.team.delete({ where: { id } });
  }

  private async getSummary(
    value: string,
    key: 'id' | 'slug',
  ): Promise<{ data: TeamSummary }> {
    const row = orNotFound(
      await this.prisma.team.findUnique({
        where: key === 'id' ? { id: value } : { slug: value },
        select: TEAM_SUMMARY_SELECT,
      }),
    );
    return { data: toTeamSummary(row) };
  }
}
