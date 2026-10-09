import { NotFoundException } from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { CommentsService } from './comments.service';
import { PrismaService } from '../../prisma/prisma.service';
import { testEvents } from '../../infra/events/testing';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

const USER_ID = '00000000-0000-4000-8000-0000000000c1';
const OTHER_USER_ID = '00000000-0000-4000-8000-0000000000c2';

describe('CommentsService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let comments: CommentsService;

  let teamAId: string;
  let teamBId: string;
  let liveMatchId: string;
  let scheduledMatchId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    comments = new CommentsService(prisma, testEvents(), null);

    await prisma.matchComment.deleteMany({
      where: { user_id: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.profile.deleteMany({
      where: { id: { in: [USER_ID, OTHER_USER_ID] } },
    });

    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-comments-a', 'e2e-comments-b'] } },
      select: { id: true },
    });
    const oldIds = oldTeams.map((t) => t.id);
    if (oldIds.length > 0) {
      await prisma.match.deleteMany({
        where: {
          OR: [{ team_a_id: { in: oldIds } }, { team_b_id: { in: oldIds } }],
        },
      });
      await prisma.team.deleteMany({ where: { id: { in: oldIds } } });
    }

    const teamA = await prisma.team.create({
      data: { slug: 'e2e-comments-a', name: 'E2E Comments A', region: 'e2e' },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: { slug: 'e2e-comments-b', name: 'E2E Comments B', region: 'e2e' },
    });
    teamBId = teamB.id;

    const live = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        scheduled_at: new Date(Date.now() - 3_600_000),
        started_at: new Date(Date.now() - 3_600_000),
      },
    });
    liveMatchId = live.id;
    const scheduled = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 3_600_000),
      },
    });
    scheduledMatchId = scheduled.id;

    await prisma.profile.createMany({
      data: [
        { id: USER_ID, username: 'e2e-comments-user' },
        { id: OTHER_USER_ID, username: 'e2e-comments-other' },
      ],
    });
  });

  afterAll(async () => {
    await prisma.matchComment.deleteMany({
      where: { user_id: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.match.deleteMany({
      where: { id: { in: [liveMatchId, scheduledMatchId] } },
    });
    await prisma.profile.deleteMany({
      where: { id: { in: [USER_ID, OTHER_USER_ID] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.$disconnect();
  });

  it('posts a comment using the JWT display name', async () => {
    const { data } = await comments.create(
      liveMatchId,
      { sub: USER_ID, name: 'Raka' },
      { body: 'RRQ setup-nya bagus' },
    );
    expect(data.author_name).toBe('Raka');
    expect(data.body).toBe('RRQ setup-nya bagus');
    expect(data.match_id).toBe(liveMatchId);
  });

  it('falls back to the profile username when the JWT has no name', async () => {
    await prisma.matchComment.deleteMany({ where: { user_id: USER_ID } });
    const { data } = await comments.create(
      liveMatchId,
      { sub: USER_ID },
      { body: 'Tanpa nama JWT' },
    );
    expect(data.author_name).toBe('e2e-comments-user');
  });

  it('rejects comments when the match is not live', async () => {
    await prisma.matchComment.deleteMany({ where: { user_id: USER_ID } });
    await expect(
      comments.create(
        scheduledMatchId,
        { sub: USER_ID, name: 'Raka' },
        { body: 'Terlalu cepat' },
      ),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('enforces the per-user 3s cooldown', async () => {
    await prisma.matchComment.deleteMany({ where: { user_id: USER_ID } });
    await comments.create(
      liveMatchId,
      { sub: USER_ID, name: 'Raka' },
      { body: 'Pertama' },
    );
    await expect(
      comments.create(
        liveMatchId,
        { sub: USER_ID, name: 'Raka' },
        { body: 'Kedua' },
      ),
    ).rejects.toBeInstanceOf(ThrottlerException);
  });

  it('lists newest first and supports the after cursor for deltas', async () => {
    await prisma.matchComment.deleteMany({ where: { match_id: liveMatchId } });
    const first = await comments.create(
      liveMatchId,
      { sub: USER_ID, name: 'Raka' },
      { body: 'Satu' },
    );
    // bypass the cooldown for test setup
    await prisma.matchComment.update({
      where: { id: first.data.id },
      data: { created_at: new Date(Date.now() - 60_000) },
    });
    const second = await comments.create(
      liveMatchId,
      { sub: USER_ID, name: 'Raka' },
      { body: 'Dua' },
    );

    const all = await comments.list(liveMatchId, { limit: 30 });
    expect(all.data.map((c) => c.body)).toEqual(['Dua', 'Satu']);
    expect(all.meta.total).toBe(2);
    expect(all.meta.prev_cursor).toBeNull();

    const delta = await comments.list(liveMatchId, {
      limit: 30,
      after: all.meta.next_cursor ?? undefined,
    });
    expect(delta.data).toEqual([]);
    // Polling with no news keeps the caller's position.
    expect(delta.meta.next_cursor).toBe(all.meta.next_cursor);

    // Legacy clients may still pass an ISO timestamp.
    const legacy = await comments.list(liveMatchId, {
      limit: 30,
      after: second.data.created_at.toISOString(),
    });
    expect(legacy.data).toEqual([]);
  });

  async function seedBurst(count: number, at: Date): Promise<void> {
    await prisma.matchComment.createMany({
      data: Array.from({ length: count }, (_, index) => ({
        match_id: liveMatchId,
        user_id: OTHER_USER_ID,
        author_name: 'Burst',
        body: `b${String(index).padStart(2, '0')}`,
        // Every comment shares one timestamp: only the id orders them.
        created_at: at,
      })),
    });
  }

  it('delivers a burst larger than the page over several polls, losing nothing', async () => {
    await prisma.matchComment.deleteMany({ where: { match_id: liveMatchId } });
    const start = await comments.list(liveMatchId, { limit: 5 });
    await seedBurst(12, new Date());

    const received: string[] = [];
    let cursor = start.meta.next_cursor ?? new Date(0).toISOString();
    for (let poll = 0; poll < 10; poll += 1) {
      const page = await comments.list(liveMatchId, {
        limit: 5,
        after: cursor,
      });
      received.push(...page.data.map((c) => c.id));
      cursor = page.meta.next_cursor ?? cursor;
      if (!page.meta.has_more) break;
    }

    expect(received).toHaveLength(12);
    expect(new Set(received).size).toBe(12);
  });

  it('pages back through older comments with before', async () => {
    await prisma.matchComment.deleteMany({ where: { match_id: liveMatchId } });
    await seedBurst(7, new Date(Date.now() - 120_000));

    const latest = await comments.list(liveMatchId, { limit: 3 });
    const seen = latest.data.map((c) => c.id);
    let before = latest.meta.prev_cursor;
    while (before !== null) {
      const older = await comments.list(liveMatchId, { limit: 3, before });
      seen.push(...older.data.map((c) => c.id));
      before = older.meta.prev_cursor;
    }

    expect(seen).toHaveLength(7);
    expect(new Set(seen).size).toBe(7);
  });

  it('rejects after and before together', async () => {
    await expect(
      comments.list(liveMatchId, {
        limit: 5,
        after: new Date().toISOString(),
        before: new Date().toISOString(),
      }),
    ).rejects.toThrow();
  });

  it('throws 404 listing comments of an unknown match', async () => {
    await expect(
      comments.list('00000000-0000-4000-8000-000000000000', { limit: 30 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes own comments and hides other users comments', async () => {
    await prisma.matchComment.deleteMany({ where: { match_id: liveMatchId } });
    const mine = await comments.create(
      liveMatchId,
      { sub: USER_ID, name: 'Raka' },
      { body: 'Milik sendiri' },
    );
    await comments.removeOwn(USER_ID, mine.data.id);
    expect(
      await prisma.matchComment.count({ where: { id: mine.data.id } }),
    ).toBe(0);

    const theirs = await comments.create(
      liveMatchId,
      { sub: OTHER_USER_ID, name: 'Adrian' },
      { body: 'Milik orang lain' },
    );
    await expect(
      comments.removeOwn(USER_ID, theirs.data.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      await prisma.matchComment.count({ where: { id: theirs.data.id } }),
    ).toBe(1);

    // admin removal and idempotency
    await comments.removeAny(theirs.data.id);
    await comments.removeAny(theirs.data.id);
    expect(
      await prisma.matchComment.count({ where: { id: theirs.data.id } }),
    ).toBe(0);
  });
});
