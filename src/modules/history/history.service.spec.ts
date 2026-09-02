import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { HistoryService } from './history.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('HistoryService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let history: HistoryService;
  const userId = randomUUID();

  let teamAId: string;
  let teamBId: string;
  let match1Id: string;
  let match2Id: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    history = new HistoryService(prisma);

    await prisma.profile.create({ data: { id: userId, role: 'user' } });
    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-hist-t1',
        name: 'E2E History T1',
        region: 'e2e-hist-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-hist-t2',
        name: 'E2E History T2',
        region: 'e2e-hist-region',
      },
    });
    teamBId = teamB.id;

    const match1 = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date('2026-09-10T10:00:00Z'),
      },
    });
    match1Id = match1.id;
    const match2 = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date('2026-09-11T10:00:00Z'),
      },
    });
    match2Id = match2.id;
  });

  afterAll(async () => {
    await prisma.watchHistory.deleteMany({ where: { user_id: userId } });
    await prisma.match.deleteMany({
      where: { id: { in: [match1Id, match2Id] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.profile.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('creates a history row and embeds the match', async () => {
    const { data } = await history.put(userId, match1Id, 1200);
    expect(data.match_id).toBe(match1Id);
    expect(data.duration_seconds).toBe(1200);
    expect(data.match.id).toBe(match1Id);
    expect(data.match.status).toBe('scheduled');
  });

  it('upserts on refresh, updating watched_at and duration', async () => {
    const first = await history.put(userId, match1Id, 1500);
    const rows = await prisma.watchHistory.count({
      where: { user_id: userId, match_id: match1Id },
    });
    expect(rows).toBe(1);
    expect(first.data.duration_seconds).toBe(1500);
  });

  it('throws 404 when the match does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(history.put(userId, missing, 100)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('keeps the duration when a refresh omits it', async () => {
    const { data } = await history.put(userId, match1Id);
    expect(data.duration_seconds).toBe(1500);
  });

  it('lists history newest first with meta', async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    await history.put(userId, match2Id);

    const { data, meta } = await history.list(userId, 1, 20);
    expect(meta.total).toBe(2);
    expect(data.map((item) => item.match_id)).toEqual([match2Id, match1Id]);
  });

  it('paginates history', async () => {
    const { data, meta } = await history.list(userId, 1, 1);
    expect(data).toHaveLength(1);
    expect(meta.totalPages).toBe(2);
  });

  it('removes history idempotently', async () => {
    await history.remove(userId, match1Id);
    await history.remove(userId, match1Id); // no error

    const { meta } = await history.list(userId, 1, 20);
    expect(meta.total).toBe(1);
  });
});
