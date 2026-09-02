import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PaginationMeta,
  buildPaginationMeta,
} from '../../common/utils/pagination';
import {
  MatchSummary,
  SUMMARY_INCLUDE,
  toMatchSummary,
} from '../matches/matches.service';
import { PrismaService } from '../../prisma/prisma.service';

export interface WatchHistoryItem {
  match_id: string;
  watched_at: Date;
  duration_seconds: number | null;
  match: MatchSummary;
}

function toItem(
  row: Prisma.WatchHistoryGetPayload<{
    include: { match: { include: typeof SUMMARY_INCLUDE } };
  }>,
): WatchHistoryItem {
  return {
    match_id: row.match_id,
    watched_at: row.watched_at,
    duration_seconds: row.duration_seconds,
    match: toMatchSummary(row.match),
  };
}

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{ data: WatchHistoryItem[]; meta: PaginationMeta }> {
    const where: Prisma.WatchHistoryWhereInput = { user_id: userId };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.watchHistory.findMany({
        where,
        orderBy: { watched_at: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { match: { include: SUMMARY_INCLUDE } },
      }),
      this.prisma.watchHistory.count({ where }),
    ]);

    return {
      data: rows.map(toItem),
      meta: buildPaginationMeta(page, pageSize, total),
    };
  }

  async put(
    userId: string,
    matchId: string,
    durationSeconds?: number,
  ): Promise<{ data: WatchHistoryItem }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

    await this.prisma.watchHistory.upsert({
      where: {
        user_id_match_id: { user_id: userId, match_id: matchId },
      },
      update: {
        watched_at: new Date(),
        ...(durationSeconds !== undefined && {
          duration_seconds: durationSeconds,
        }),
      },
      create: {
        user_id: userId,
        match_id: matchId,
        watched_at: new Date(),
        duration_seconds: durationSeconds ?? null,
      },
    });

    const row = await this.prisma.watchHistory.findUniqueOrThrow({
      where: { user_id_match_id: { user_id: userId, match_id: matchId } },
      include: { match: { include: SUMMARY_INCLUDE } },
    });
    return { data: toItem(row) };
  }

  async remove(userId: string, matchId: string): Promise<void> {
    await this.prisma.watchHistory.deleteMany({
      where: { user_id: userId, match_id: matchId },
    });
  }
}
