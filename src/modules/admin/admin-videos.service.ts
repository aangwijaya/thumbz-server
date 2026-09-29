import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import {
  VIDEO_INCLUDE,
  toVideoSummary,
  VideoSummary,
} from '../videos/videos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';

@Injectable()
export class AdminVideosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVideoDto): Promise<{ data: VideoSummary }> {
    await this.ensureMatchExists(dto.match_id);

    await this.ensureResultValid(
      dto.match_id ?? null,
      dto.winning_team_id ?? null,
      dto.game_number ?? null,
    );

    const row = await this.prisma.video.create({
      data: {
        match_id: dto.match_id ?? null,
        title: dto.title,
        type: dto.type,
        url: dto.url,
        thumbnail_url: dto.thumbnail_url ?? null,
        duration_seconds: dto.duration_seconds ?? null,
        game_number: dto.game_number ?? null,
        winning_team_id: dto.winning_team_id ?? null,
      },
      include: VIDEO_INCLUDE,
    });

    return { data: toVideoSummary(row) };
  }

  async update(
    id: string,
    dto: UpdateVideoDto,
  ): Promise<{ data: VideoSummary }> {
    const existing = await this.prisma.video.findUnique({
      where: { id },
      select: {
        id: true,
        match_id: true,
        winning_team_id: true,
        game_number: true,
      },
    });
    if (existing === null) {
      throw new NotFoundException();
    }
    await this.ensureMatchExists(dto.match_id);

    const finalMatchId =
      dto.match_id !== undefined ? dto.match_id : existing.match_id;
    const finalWinner =
      dto.winning_team_id !== undefined
        ? dto.winning_team_id
        : existing.winning_team_id;
    const finalGame =
      dto.game_number !== undefined ? dto.game_number : existing.game_number;
    await this.ensureResultValid(finalMatchId, finalWinner, finalGame);

    const row = await this.prisma.video.update({
      where: { id },
      data: {
        ...(dto.match_id !== undefined && { match_id: dto.match_id }),
        ...(dto.title !== undefined && { title: dto.title }),
        ...(dto.type !== undefined && { type: dto.type }),
        ...(dto.url !== undefined && { url: dto.url }),
        ...(dto.thumbnail_url !== undefined && {
          thumbnail_url: dto.thumbnail_url,
        }),
        ...(dto.duration_seconds !== undefined && {
          duration_seconds: dto.duration_seconds,
        }),
        ...(dto.game_number !== undefined && {
          game_number: dto.game_number,
        }),
        ...(dto.winning_team_id !== undefined && {
          winning_team_id: dto.winning_team_id,
        }),
      },
      include: VIDEO_INCLUDE,
    });

    return { data: toVideoSummary(row) };
  }

  async remove(id: string): Promise<void> {
    const existing = await this.prisma.video.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existing === null) {
      throw new NotFoundException();
    }

    await this.prisma.video.delete({ where: { id } });
  }

  private async ensureResultValid(
    matchId: string | null,
    winningTeamId: string | null,
    gameNumber: number | null,
  ): Promise<void> {
    if (winningTeamId === null) {
      return;
    }
    if (matchId === null || gameNumber === null) {
      throw new BusinessRuleException(
        'winning_team_id requires match_id and game_number',
      );
    }
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { team_a_id: true, team_b_id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }
    if (
      winningTeamId !== match.team_a_id &&
      winningTeamId !== match.team_b_id
    ) {
      throw new BusinessRuleException(
        'winning_team_id must be one of the match teams',
      );
    }
  }

  private async ensureMatchExists(
    matchId: string | null | undefined,
  ): Promise<void> {
    if (matchId === undefined || matchId === null) {
      return;
    }
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }
  }
}
