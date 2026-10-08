import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ThrottlerException } from '@nestjs/throttler';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ListCommentsDto } from './dto/list-comments.dto';
import {
  decodeCursor,
  encodeCursor,
  keysetWhere,
  SortSpec,
} from '../../common/utils/cursor';
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

const COMMENT_SORT: SortSpec = {
  field: 'created_at',
  order: 'desc',
  type: 'date',
};

type CommentRow = MatchComment;

export interface CommentsMeta {
  /** Pass as `after` to receive only newer comments. */
  next_cursor: string | null;
  /** Pass as `before` to page back through older comments; null at the start. */
  prev_cursor: string | null;
  /** With `after`: more new comments are waiting — fetch again right away. */
  has_more: boolean;
  total: number;
}

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T/;

/** Position of a cursor; legacy `after` timestamps have no id tie-breaker. */
function position(raw: string): { value: Date; id: string | null } {
  if (ISO_TIMESTAMP.test(raw)) {
    const value = new Date(raw);
    if (Number.isNaN(value.getTime())) {
      throw new BadRequestException({
        details: [
          { field: 'after', message: 'after must be a cursor or ISO date' },
        ],
      });
    }
    return { value, id: null };
  }
  const cursor = decodeCursor(raw, COMMENT_SORT);
  return { value: cursor.value as Date, id: cursor.id };
}

function newerThan(raw: string): Prisma.MatchCommentWhereInput {
  const { value, id } = position(raw);
  return id === null
    ? { created_at: { gt: value } }
    : keysetWhere({ ...COMMENT_SORT, order: 'asc' }, { value, id });
}

function olderThan(raw: string): Prisma.MatchCommentWhereInput {
  const { value, id } = position(raw);
  return id === null
    ? { created_at: { lt: value } }
    : keysetWhere(COMMENT_SORT, {
        value,
        id,
      });
}

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
  ): Promise<{ data: MatchComment[]; meta: CommentsMeta }> {
    if (query.after !== undefined && query.before !== undefined) {
      throw new BadRequestException({
        details: [
          { field: 'after', message: 'use either after or before, not both' },
        ],
      });
    }
    await this.requireMatch(matchId);
    const limit = query.limit;
    const base = { match_id: matchId };

    let rows: CommentRow[];
    let hasMore = false;
    let hasOlder = false;

    if (query.after !== undefined) {
      // Oldest-first after the cursor, so a burst larger than `limit` is
      // delivered over several polls instead of skipping the middle.
      const fetched = await this.prisma.matchComment.findMany({
        where: { AND: [base, newerThan(query.after)] },
        orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        select: COMMENT_SELECT,
      });
      hasMore = fetched.length > limit;
      rows = fetched.slice(0, limit).reverse();
    } else {
      const fetched = await this.prisma.matchComment.findMany({
        where:
          query.before !== undefined
            ? { AND: [base, olderThan(query.before)] }
            : base,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        select: COMMENT_SELECT,
      });
      hasOlder = fetched.length > limit;
      rows = fetched.slice(0, limit);
    }

    const total = await this.prisma.matchComment.count({ where: base });
    const newest = rows[0];
    const oldest = rows[rows.length - 1];
    return {
      data: rows.map((row) => ({ ...row })),
      meta: {
        // No new rows: keep polling from where the caller already is.
        next_cursor: newest
          ? encodeCursor(COMMENT_SORT, newest.created_at, newest.id)
          : (query.after ?? null),
        prev_cursor:
          hasOlder && oldest
            ? encodeCursor(COMMENT_SORT, oldest.created_at, oldest.id)
            : null,
        has_more: hasMore,
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
