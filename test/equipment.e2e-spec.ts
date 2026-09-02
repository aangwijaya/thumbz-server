import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Equipment (e2e)', () => {
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
      data: { slug: 'e2e-eq-t1', name: 'E2E EQ T1', region: 'e2e-eq-region' },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: { slug: 'e2e-eq-t2', name: 'E2E EQ T2', region: 'e2e-eq-region' },
    });
    teamBId = teamB.id;
    const player = await prisma.player.create({
      data: {
        slug: 'e2e-eq-p1',
        nickname: 'E2E EQ P1',
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
        viewer_count: 25,
        scheduled_at: new Date('2026-09-05T12:00:00Z'),
      },
    });
    matchId = match.id;

    await prisma.matchItemEvent.createMany({
      data: [
        {
          match_id: matchId,
          player_id: playerId,
          team_id: teamAId,
          item_id: 'fury-hammer',
          item_name: 'Fury Hammer',
          phase: 'phase2',
          purchased_at: new Date('2026-09-05T12:03:00Z'),
        },
        {
          match_id: matchId,
          player_id: playerId,
          team_id: teamAId,
          item_id: 'war-axe',
          item_name: 'War Axe',
          phase: 'phase3',
          slot: 1,
          purchased_at: new Date('2026-09-05T12:09:00Z'),
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

  it('returns purchases ordered by purchased_at asc', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/equipment`)
      .expect(200);

    const body = response.body as {
      data: Array<{ item_name: string; phase: string; slot: number | null }>;
    };
    expect(body.data.map((p) => p.item_name)).toEqual([
      'Fury Hammer',
      'War Axe',
    ]);
    expect(body.data[1]).toMatchObject({ phase: 'phase3', slot: 1 });
  });

  it('returns 404 for an unknown match', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/00000000-0000-4000-8000-000000000000/equipment')
      .expect(404);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('rejects anonymous admin writes', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/equipment`)
      .send({
        purchases: [
          {
            player_id: playerId,
            team_id: teamAId,
            item_id: 'x',
            item_name: 'X',
            phase: 'phase2',
          },
        ],
      })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
