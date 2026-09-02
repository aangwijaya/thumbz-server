import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Economy (e2e)', () => {
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

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-econ-api-t1',
        name: 'E2E Econ API T1',
        region: 'e2e-econ-api-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-econ-api-t2',
        name: 'E2E Econ API T2',
        region: 'e2e-econ-api-region',
      },
    });
    teamBId = teamB.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        viewer_count: 100,
        scheduled_at: new Date('2026-09-05T10:00:00Z'),
      },
    });
    matchId = match.id;

    await prisma.matchGoldSnapshot.createMany({
      data: [
        {
          match_id: matchId,
          team_id: teamAId,
          gold: 20000,
          recorded_at: new Date('2026-09-05T10:05:00Z'),
        },
        {
          match_id: matchId,
          team_id: teamBId,
          gold: 19500,
          recorded_at: new Date('2026-09-05T10:10:00Z'),
        },
        {
          match_id: matchId,
          team_id: teamAId,
          gold: 21000,
          recorded_at: new Date('2026-09-05T10:15:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await app.close();
  });

  it('returns gold snapshots ordered by recorded_at asc', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/economy`)
      .expect(200);

    const body = response.body as {
      data: Array<{ team_id: string; gold: number; recorded_at: string }>;
    };
    expect(body.data).toHaveLength(3);
    expect(body.data.map((s) => s.gold)).toEqual([20000, 19500, 21000]);
    expect(body.data.every((s) => [teamAId, teamBId].includes(s.team_id))).toBe(
      true,
    );
  });

  it('filters by from/to window', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/matches/${matchId}/economy?from=2026-09-05T10:07:00Z&to=2026-09-05T10:13:00Z`,
      )
      .expect(200);

    const body = response.body as { data: Array<{ gold: number }> };
    expect(body.data.map((s) => s.gold)).toEqual([19500]);
  });

  it('returns 404 for an unknown match', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/00000000-0000-4000-8000-000000000000/economy')
      .expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });

  it('returns 400 for a malformed from value', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/economy?from=banana`)
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects anonymous admin economy writes', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/economy`)
      .send({ snapshots: [{ team_id: teamAId, gold: 22000 }] })
      .expect(401);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
