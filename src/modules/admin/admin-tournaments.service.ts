import { Injectable } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import {
  SUMMARY_SELECT as TOURNAMENT_SUMMARY_SELECT,
  TournamentSummary,
  toTournamentSummary,
} from '../tournaments/tournaments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTournamentDto } from './dto/create-tournament.dto';
import { UpdateTournamentDto } from './dto/update-tournament.dto';
import { orNotFound } from '../../common/utils/not-found';

@Injectable()
export class AdminTournamentsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateTournamentDto): Promise<{ data: TournamentSummary }> {
    await this.prisma.tournament.create({
      data: {
        slug: dto.slug,
        name: dto.name,
        status: dto.status,
        region: dto.region,
        start_date: new Date(dto.start_date),
        end_date: new Date(dto.end_date),
        prize_pool: dto.prize_pool,
        description: dto.description,
        logo_url: dto.logo_url,
        featured: dto.featured,
      },
    });

    return this.getSummary(dto.slug, 'slug');
  }

  async update(
    id: string,
    dto: UpdateTournamentDto,
  ): Promise<{ data: TournamentSummary }> {
    orNotFound(
      await this.prisma.tournament.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    await this.prisma.tournament.update({
      where: { id },
      data: {
        ...(dto.slug !== undefined && { slug: dto.slug }),
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.status !== undefined && { status: dto.status }),
        ...(dto.region !== undefined && { region: dto.region }),
        ...(dto.start_date !== undefined && {
          start_date: new Date(dto.start_date),
        }),
        ...(dto.end_date !== undefined && {
          end_date: new Date(dto.end_date),
        }),
        ...(dto.prize_pool !== undefined && { prize_pool: dto.prize_pool }),
        ...(dto.description !== undefined && {
          description: dto.description,
        }),
        ...(dto.logo_url !== undefined && { logo_url: dto.logo_url }),
        ...(dto.featured !== undefined && { featured: dto.featured }),
      },
    });

    return this.getSummary(id, 'id');
  }

  async remove(id: string): Promise<void> {
    orNotFound(
      await this.prisma.tournament.findUnique({
        where: { id },
        select: { id: true },
      }),
    );

    const matchCount = await this.prisma.match.count({
      where: { tournament_id: id },
    });
    if (matchCount > 0) {
      throw new BusinessRuleException(
        'Cannot delete a tournament that has matches',
      );
    }

    await this.prisma.tournament.delete({ where: { id } });
  }

  private async getSummary(
    value: string,
    key: 'id' | 'slug',
  ): Promise<{ data: TournamentSummary }> {
    const row = orNotFound(
      await this.prisma.tournament.findUnique({
        where: key === 'id' ? { id: value } : { slug: value },
        select: TOURNAMENT_SUMMARY_SELECT,
      }),
    );
    return { data: toTournamentSummary(row) };
  }
}
