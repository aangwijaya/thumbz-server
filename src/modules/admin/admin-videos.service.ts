import { Injectable, NotFoundException } from '@nestjs/common';
import { toVideoSummary, VideoSummary } from '../videos/videos.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateVideoDto } from './dto/create-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';

@Injectable()
export class AdminVideosService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateVideoDto): Promise<{ data: VideoSummary }> {
    await this.ensureMatchExists(dto.match_id);

    const row = await this.prisma.video.create({
      data: {
        match_id: dto.match_id ?? null,
        title: dto.title,
        type: dto.type,
        url: dto.url,
        thumbnail_url: dto.thumbnail_url ?? null,
        duration_seconds: dto.duration_seconds ?? null,
      },
    });

    return { data: toVideoSummary(row) };
  }

  async update(
    id: string,
    dto: UpdateVideoDto,
  ): Promise<{ data: VideoSummary }> {
    const existing = await this.prisma.video.findUnique({
      where: { id },
      select: { id: true },
    });
    if (existing === null) {
      throw new NotFoundException();
    }
    await this.ensureMatchExists(dto.match_id);

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
      },
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
