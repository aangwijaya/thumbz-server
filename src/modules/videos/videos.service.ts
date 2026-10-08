import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { findPage, ListMeta } from '../../common/utils/find-page';
import { PrismaService } from '../../prisma/prisma.service';
import { orNotFound } from '../../common/utils/not-found';
import { ListVideosDto } from './dto/list-videos.dto';

export const VIDEO_WINNER_SELECT = {
  id: true,
  slug: true,
  name: true,
  short_name: true,
  region: true,
  logo_url: true,
  color_primary: true,
  color_secondary: true,
  is_active: true,
} satisfies Prisma.TeamSelect;

export const VIDEO_INCLUDE = {
  winningTeam: { select: VIDEO_WINNER_SELECT },
  media: { select: { id: true, protection: true, duration_seconds: true } },
} satisfies Prisma.VideoInclude;

export type VideoRow = Prisma.VideoGetPayload<{
  include: typeof VIDEO_INCLUDE;
}>;

export interface VideoSummary {
  id: string;
  match_id: string | null;
  title: string;
  type: string;
  url: string;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  published_at: Date;
  result: {
    game_number: number | null;
    winner_team: VideoRow['winningTeam'];
  } | null;
  /** Protected in-app playback (playback session required), when packaged. */
  media: { id: string; protection: string } | null;
}

export function toVideoSummary(row: VideoRow): VideoSummary {
  return {
    id: row.id,
    match_id: row.match_id,
    title: row.title,
    type: row.type,
    url: row.url,
    thumbnail_url: row.thumbnail_url,
    duration_seconds: row.duration_seconds,
    published_at: row.published_at,
    result:
      row.winning_team_id !== null
        ? { game_number: row.game_number, winner_team: row.winningTeam }
        : null,
    media: row.media
      ? { id: row.media.id, protection: row.media.protection }
      : null,
  };
}

@Injectable()
export class VideosService {
  constructor(private readonly prisma: PrismaService) {}

  async get(id: string): Promise<{ data: VideoSummary }> {
    const row = orNotFound(
      await this.prisma.video.findUnique({
        where: { id },
        include: VIDEO_INCLUDE,
      }),
    );
    return { data: toVideoSummary(row) };
  }

  async list(
    query: ListVideosDto,
  ): Promise<{ data: VideoSummary[]; meta: ListMeta }> {
    const where: Prisma.VideoWhereInput = {};
    if (query.type) where.type = query.type;
    if (query.match_id) where.match_id = query.match_id;

    const { rows, meta } = await findPage({
      query,
      sort: { field: 'published_at', order: 'desc', type: 'date' },
      where,
      findMany: (args) =>
        this.prisma.video.findMany({
          ...(args as Prisma.VideoFindManyArgs),
          include: VIDEO_INCLUDE,
        }),
      count: (filter) => this.prisma.video.count({ where: filter }),
      sortValue: (row) => row.published_at,
    });

    return { data: rows.map(toVideoSummary), meta };
  }
}
