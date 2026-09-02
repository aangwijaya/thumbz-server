import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PaginationMeta,
  buildPaginationMeta,
} from '../../common/utils/pagination';
import { PrismaService } from '../../prisma/prisma.service';
import { ListVideosDto } from './dto/list-videos.dto';

export interface VideoSummary {
  id: string;
  match_id: string | null;
  title: string;
  type: string;
  url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: Date;
}

export function toVideoSummary(
  row: Prisma.VideoGetPayload<Record<string, never>>,
): VideoSummary {
  return {
    id: row.id,
    match_id: row.match_id,
    title: row.title,
    type: row.type,
    url: row.url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    published_at: row.published_at,
  };
}

@Injectable()
export class VideosService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListVideosDto,
  ): Promise<{ data: VideoSummary[]; meta: PaginationMeta }> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.VideoWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.match_id) where.match_id = query.match_id;

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.video.findMany({
        where,
        orderBy: { published_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.video.count({ where }),
    ]);

    return {
      data: rows.map(toVideoSummary),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }
}
