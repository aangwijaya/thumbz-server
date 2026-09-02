import { randomUUID } from 'node:crypto';
import { HomeService } from './home.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('HomeService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let home: HomeService;
  const userId = randomUUID();

  let teamAId: string;
  let teamBId: string;
  let completedMatchId: string;
  let liveMatchId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    home = new HomeService(prisma);

    await prisma.profile.create({ data: { id: userId, role: 'user' } });
    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-home-ionic',
        name: 'E2E Home Ionic',
        region: 'e2e-home-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-home-pulse',
        name: 'E2E Home Pulse',
        region: 'e2e-home-region',
      },
    });
    teamBId = teamB.id;

    const live = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        viewer_count: 1111,
        scheduled_at: new Date('2026-09-01T10:00:00Z'),
        started_at: new Date('2026-09-01T10:05:00Z'),
      },
    });
    liveMatchId = live.id;

    const completed = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'completed',
        winner_team_id: teamAId,
        scheduled_at: new Date('2026-08-20T10:00:00Z'),
        ended_at: new Date('2026-08-20T12:00:00Z'),
      },
    });
    completedMatchId = completed.id;

    await prisma.watchHistory.create({
      data: {
        user_id: userId,
        match_id: completedMatchId,
        watched_at: new Date('2026-09-02T09:00:00Z'),
        duration_seconds: 1200,
      },
    });
  });

  afterAll(async () => {
    await prisma.watchHistory.deleteMany({ where: { user_id: userId } });
    await prisma.match.deleteMany({
      where: { id: { in: [completedMatchId, liveMatchId] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.profile.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('returns no continue_watching without a user', async () => {
    const { data } = await home.getHome();
    expect(data.continue_watching).toEqual([]);
  });

  it('includes watch history with embedded match for an authenticated user', async () => {
    const { data } = await home.getHome(userId);

    expect(data.continue_watching).toHaveLength(1);
    const item = data.continue_watching[0];
    expect(item?.match_id).toBe(completedMatchId);
    expect(item?.duration_seconds).toBe(1200);
    expect(item?.match.id).toBe(completedMatchId);
    expect(item?.match.status).toBe('completed');
  });
});
