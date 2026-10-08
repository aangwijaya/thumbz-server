import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsDto } from './dto/list-comments.dto';
import { orNotFound } from '../../common/utils/not-found';
import { DomainEvents } from '../../infra/events/domain-events';
import { REDIS } from '../../infra/redis/redis.constants';
import type { Redis } from 'ioredis';

export interface MatchComment {
  id: string;
  match_id: string;
  user_id: string;
  author_name: string;
  body: string;
  created_at: Date;
}

const COMMENT_SELECT = {
  id: true,
  match_id: true,
  user_id: true,
  author_name: true,
  body: true,
  created_at: true,
} as const;

const COMMENT_COOLDOWN_MS = 3_000;

@Injectable()
export class CommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: DomainEvents,
    @Inject(REDIS) private readonly redis: Redis | null,
  ) {}

  async list(
    matchId: string,
    query: ListCommentsDto,
  ): Promise<{
    data: MatchComment[];
    meta: { next_cursor: string | null; total: number };
  }> {
    await this.requireMatch(matchId);

    const where = {
      match_id: matchId,
      ...(query.after !== undefined
        ? { created_at: { gt: new Date(query.after) } }
        : {}),
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.matchComment.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: query.limit,
        select: COMMENT_SELECT,
      }),
      this.prisma.matchComment.count({ where: { match_id: matchId } }),
    ]);

    return {
      data: rows.map((row) => ({ ...row })),
      meta: {
        next_cursor: rows[0]?.created_at.toISOString() ?? null,
        total,
      },
    };
  }

  async create(
    matchId: string,
    user: CurrentUser,
    dto: CreateCommentDto,
  ): Promise<{ data: MatchComment }> {
    const match = orNotFound(
      await this.prisma.match.findUnique({
        where: { id: matchId },
        select: { status: true },
      }),
    );
    if (match.status !== 'live') {
      throw new BusinessRuleException(
        'comments are only open while the match is live',
      );
    }

    if (!(await this.claimCooldown(user.sub))) {
      throw new ThrottlerException();
    }

    const profile = await this.prisma.profile.findUnique({
      where: { id: user.sub },
      select: { username: true },
    });
    const authorName = user.name ?? profile?.username ?? 'User';

    const row = await this.prisma.matchComment.create({
      data: {
        match_id: matchId,
        user_id: user.sub,
        author_name: authorName,
        body: dto.body,
      },
      select: COMMENT_SELECT,
    });

    this.events.emit({
      type: 'comment.created',
      matchId: row.match_id,
      commentId: row.id,
    });
    return { data: { ...row } };
  }

  async removeOwn(userId: string, id: string): Promise<void> {
    const existing = await this.prisma.matchComment.findUnique({
      where: { id },
      select: { user_id: true, match_id: true },
    });
    if (existing === null) {
      return; // already gone (or never existed): idempotent
    }
    if (existing.user_id !== userId) {
      // someone else's comment: do not leak its existence
      throw new NotFoundException();
    }
    await this.deleteComment(id, existing.match_id);
  }

  async removeAny(id: string): Promise<void> {
    const existing = await this.prisma.matchComment.findUnique({
      where: { id },
      select: { match_id: true },
    });
    if (existing !== null) {
      await this.deleteComment(id, existing.match_id);
    }
  }

  private async deleteComment(id: string, matchId: string): Promise<void> {
    const deleted = await this.prisma.matchComment.deleteMany({
      where: { id },
    });
    if (deleted.count > 0) {
      this.events.emit({ type: 'comment.deleted', matchId, commentId: id });
    }
  }

  /**
   * One comment per user per cooldown window. With Redis this is a single
   * atomic SET NX (no race between concurrent posts); without it, fall back
   * to checking the user's latest comment.
   */
  private async claimCooldown(userId: string): Promise<boolean> {
    if (this.redis !== null && this.redis.status === 'ready') {
      try {
        const claimed = await this.redis.set(
          `thumbz:cooldown:comment:${userId}`,
          '1',
          'PX',
          COMMENT_COOLDOWN_MS,
          'NX',
        );
        return claimed === 'OK';
      } catch {
        // fall through to the database check
      }
    }
    const last = await this.prisma.matchComment.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    });
    return (
      last === null ||
      Date.now() - last.created_at.getTime() >= COMMENT_COOLDOWN_MS
    );
  }

  private async requireMatch(matchId: string): Promise<void> {
    orNotFound(
      await this.prisma.match.findUnique({
        where: { id: matchId },
        select: { id: true },
      }),
    );
  }
}
