import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

const USER_ID = '00000000-0000-4000-8000-0000000000e1';

describe('Match comments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let teamAId: string;
  let teamBId: string;
  let matchId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-comments-e-a', 'e2e-comments-e-b'] } },
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
      data: {
        slug: 'e2e-comments-e-a',
        name: 'E2E CommentsE A',
        region: 'e2e',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-comments-e-b',
        name: 'E2E CommentsE B',
        region: 'e2e',
      },
    });
    teamBId = teamB.id;

    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        scheduled_at: new Date(Date.now() - 3_600_000),
        started_at: new Date(Date.now() - 3_600_000),
      },
    });
    matchId = match.id;

    await prisma.profile.upsert({
      where: { id: USER_ID },
      create: { id: USER_ID, username: 'e2e-comments-e2e' },
      update: {},
    });
    await prisma.matchComment.create({
      data: {
        match_id: matchId,
        user_id: USER_ID,
        author_name: 'Raka',
        body: 'RRQ setup-nya bagus',
      },
    });
  });

  afterAll(async () => {
    await prisma.matchComment.deleteMany({ where: { match_id: matchId } });
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.profile.deleteMany({ where: { id: USER_ID } });
    await prisma.team.deleteMany({ where: { id: { in: [teamAId, teamBId] } } });
    await app.close();
  });

  it('serves the newest comments publicly with a next_cursor', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/comments`)
      .expect(200);
    const body = response.body as {
      data: Array<{ author_name: string; body: string }>;
      meta: { next_cursor: string | null; total: number };
    };
    expect(body.data[0]).toEqual(
      expect.objectContaining({
        author_name: 'Raka',
        body: 'RRQ setup-nya bagus',
      }),
    );
    expect(body.meta.total).toBe(1);
    expect(typeof body.meta.next_cursor).toBe('string');
  });

  it('returns an empty delta after the latest cursor', async () => {
    const latest = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/comments`)
      .expect(200);
    const cursor = (latest.body as { meta: { next_cursor: string } }).meta
      .next_cursor;
    const delta = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/comments`)
      .query({ after: cursor })
      .expect(200);
    const body = delta.body as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('validates the limit parameter', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/comments`)
      .query({ limit: 51 })
      .expect(400);
  });

  it('returns 404 for an unknown match', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/matches/00000000-0000-4000-8000-000000000000/comments')
      .expect(404);
  });

  it('rejects anonymous reads on admin delete and posts', async () => {
    const post = await request(app.getHttpServer())
      .post(`/api/v1/matches/${matchId}/comments`)
      .send({ body: 'Halo' })
      .expect(401);
    expect((post.body as { error: { code: string } }).error.code).toBe(
      'AUTHENTICATION_REQUIRED',
    );

    await request(app.getHttpServer())
      .delete(`/api/v1/me/comments/${matchId}`)
      .expect(401);

    await request(app.getHttpServer())
      .delete(`/api/v1/admin/comments/${matchId}`)
      .expect(401);
  });
});
