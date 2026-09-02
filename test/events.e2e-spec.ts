import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Match events (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let teamAId: string;
  let teamBId: string;
  let playerId: string;
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
      data: { slug: 'e2e-ev-t1', name: 'E2E EV T1', region: 'e2e-ev-region' },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: { slug: 'e2e-ev-t2', name: 'E2E EV T2', region: 'e2e-ev-region' },
    });
    teamBId = teamB.id;
    const player = await prisma.player.create({
      data: {
        slug: 'e2e-ev-p1',
        nickname: 'E2E EV P1',
        role: 'gold',
        team_id: teamAId,
      },
    });
    playerId = player.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        viewer_count: 30,
        scheduled_at: new Date('2026-09-05T12:00:00Z'),
      },
    });
    matchId = match.id;

    await prisma.matchEvent.createMany({
      data: [
        {
          match_id: matchId,
          team_id: teamAId,
          player_id: playerId,
          event_type: 'first_blood',
          title: 'First blood',
          occurred_at: new Date('2026-09-05T12:04:00Z'),
        },
        {
          match_id: matchId,
          team_id: teamBId,
          event_type: 'lord',
          title: 'Lord secured',
          details: { objective: 'lord' },
          occurred_at: new Date('2026-09-05T12:20:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.player.delete({ where: { id: playerId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await app.close();
  });

  it('returns events ordered by occurred_at asc', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/events`)
      .expect(200);

    const body = response.body as {
      data: Array<{
        event_type: string;
        title: string;
        details: Record<string, unknown>;
      }>;
    };
    expect(body.data.map((e) => e.event_type)).toEqual(['first_blood', 'lord']);
    expect(body.data[1]).toMatchObject({ title: 'Lord secured' });
    expect(body.data[1]?.details).toEqual({ objective: 'lord' });
  });

  it('filters by from/to window', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/events?from=2026-09-05T12:10:00Z`)
      .expect(200);

    const body = response.body as { data: Array<{ event_type: string }> };
    expect(body.data.map((e) => e.event_type)).toEqual(['lord']);
  });

  it('returns 404 for an unknown match', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/00000000-0000-4000-8000-000000000000/events')
      .expect(404);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects anonymous admin writes', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/events`)
      .send({ events: [{ event_type: 'tower', title: 'Tower' }] })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
