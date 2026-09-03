import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { PrismaService } from './../src/prisma/prisma.service';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';

describe('Match broadcasts (e2e)', () => {
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
      where: { slug: { in: ['e2e-bcast-a', 'e2e-bcast-b'] } },
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
        slug: 'e2e-bcast-a',
        name: 'E2E Broadcast A',
        region: 'e2e-bcast-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-bcast-b',
        name: 'E2E Broadcast B',
        region: 'e2e-bcast-region',
      },
    });
    teamBId = teamB.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        started_at: new Date(Date.now() - 600_000),
        scheduled_at: new Date(Date.now() - 600_000),
        viewer_count: 50000,
        featured: true,
      },
    });
    matchId = match.id;
    await prisma.matchBroadcast.createMany({
      data: [
        {
          match_id: matchId,
          language: 'en',
          stream_url: 'https://e2e.example.com/b-en.m3u8',
          viewer_count: 2100,
        },
        {
          match_id: matchId,
          language: 'id',
          stream_url: 'https://e2e.example.com/b-id.m3u8',
          viewer_count: 4000,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.matchBroadcast.deleteMany({ where: { match_id: matchId } });
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.team.deleteMany({ where: { id: { in: [teamAId, teamBId] } } });
    await app.close();
  });

  it('embeds broadcasts on the live match detail and list', async () => {
    const detail = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}`)
      .expect(200);
    const detailBody = detail.body as {
      data: {
        broadcasts: Array<{
          language: string;
          stream_url: string;
          viewer_count: number;
        }>;
      };
    };
    expect(detailBody.data.broadcasts).toEqual([
      {
        language: 'id',
        stream_url: 'https://e2e.example.com/b-id.m3u8',
        viewer_count: 4000,
      },
      {
        language: 'en',
        stream_url: 'https://e2e.example.com/b-en.m3u8',
        viewer_count: 2100,
      },
    ]);

    const live = await request(app.getHttpServer())
      .get('/api/v1/matches/live')
      .expect(200);
    const liveBody = live.body as {
      data: Array<{
        id: string;
        broadcasts: Array<{ language: string }>;
      }>;
    };
    const own = liveBody.data.find((m) => m.id === matchId);
    expect(own).toBeDefined();
    expect(own?.broadcasts.map((b) => b.language)).toEqual(['id', 'en']);
  });

  it('serves GET /matches/:id/broadcasts ordered by viewer_count desc', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchId}/broadcasts`)
      .expect(200);
    const body = response.body as {
      data: Array<{ language: string; viewer_count: number }>;
    };
    expect(body.data).toEqual([
      {
        language: 'id',
        stream_url: 'https://e2e.example.com/b-id.m3u8',
        viewer_count: 4000,
      },
      {
        language: 'en',
        stream_url: 'https://e2e.example.com/b-en.m3u8',
        viewer_count: 2100,
      },
    ]);
  });

  it('returns an empty array for a match without variants', async () => {
    const other = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 86_400_000),
      },
    });
    try {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/matches/${other.id}/broadcasts`)
        .expect(200);
      const body = response.body as { data: unknown[] };
      expect(body.data).toEqual([]);
    } finally {
      await prisma.match.delete({ where: { id: other.id } });
    }
  });

  it('rejects anonymous admin PUT with 401', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/v1/admin/matches/${matchId}/broadcasts`)
      .send({ broadcasts: [] })
      .expect(401);
    const errorBody = response.body as { error: { code: string } };
    expect(errorBody.error.code).toBe('AUTHENTICATION_REQUIRED');
  });
});
