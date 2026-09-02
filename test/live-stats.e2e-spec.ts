import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Live stats (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let teamAId: string;
  let teamBId: string;
  let player1Id: string;
  let player2Id: string;
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
      data: { slug: 'e2e-ls-t1', name: 'E2E LS T1', region: 'e2e-ls-region' },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: { slug: 'e2e-ls-t2', name: 'E2E LS T2', region: 'e2e-ls-region' },
    });
    teamBId = teamB.id;
    const player1 = await prisma.player.create({
      data: {
        slug: 'e2e-ls-p1',
        nickname: 'E2E LS P1',
        role: 'gold',
        team_id: teamAId,
      },
    });
    player1Id = player1.id;
    const player2 = await prisma.player.create({
      data: {
        slug: 'e2e-ls-p2',
        nickname: 'E2E LS P2',
        role: 'mid',
        team_id: teamBId,
      },
    });
    player2Id = player2.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        viewer_count: 50,
        scheduled_at: new Date('2026-09-05T12:00:00Z'),
      },
    });
    matchId = match.id;

    await prisma.playerMatchSnapshot.createMany({
      data: [
        {
          match_id: matchId,
          player_id: player1Id,
          team_id: teamAId,
          kills: 2,
          gold: 5000,
          damage: 10000,
          damage_taken: 3000,
          level: 6,
          recorded_at: new Date('2026-09-05T12:05:00Z'),
        },
        {
          match_id: matchId,
          player_id: player2Id,
          team_id: teamBId,
          kills: 1,
          gold: 4000,
          damage: 8000,
          damage_taken: 5000,
          level: 5,
          recorded_at: new Date('2026-09-05T12:10:00Z'),
        },
        {
          match_id: matchId,
          player_id: player1Id,
          team_id: teamAId,
          kills: 3,
          gold: 6000,
          damage: 14000,
          damage_taken: 4000,
          level: 7,
          recorded_at: new Date('2026-09-05T12:15:00Z'),
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.player.deleteMany({
      where: { id: { in: [player1Id, player2Id] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await app.close();
  });

  it('returns snapshots ordered asc with all fields', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/live-stats`)
      .expect(200);

    const body = response.body as {
      data: Array<{
        player_id: string;
        kills: number;
        damage: number;
        level: number | null;
      }>;
    };
    expect(body.data).toHaveLength(3);
    expect(body.data.map((s) => s.kills)).toEqual([2, 1, 3]);
    expect(body.data[0]).toMatchObject({
      player_id: player1Id,
      damage: 10000,
      damage_taken: 3000,
      level: 6,
    });
  });

  it('filters by from/to window', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/matches/${matchId}/live-stats?from=2026-09-05T12:08:00Z&to=2026-09-05T12:12:00Z`,
      )
      .expect(200);

    const body = response.body as { data: Array<{ kills: number }> };
    expect(body.data.map((s) => s.kills)).toEqual([1]);
  });

  it('returns 404 for an unknown match', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/00000000-0000-4000-8000-000000000000/live-stats')
      .expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });

  it('rejects anonymous admin writes', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/live-stats`)
      .send({ snapshots: [{ player_id: player1Id, team_id: teamAId }] })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
