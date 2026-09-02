import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Videos (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let matchId: string;
  let teamAId: string;
  let teamBId: string;
  const videoIds: string[] = [];
  const hour = 3_600_000;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    // own teams + one scheduled match so a video can reference a real match
    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-videos-onic',
        name: 'E2E Videos ONIC',
        region: 'e2e-videos-region',
      },
    });
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-videos-rrq',
        name: 'E2E Videos RRQ',
        region: 'e2e-videos-region',
      },
    });
    const match = await prisma.match.create({
      data: {
        team_a_id: teamA.id,
        team_b_id: teamB.id,
        status: 'scheduled',
        scheduled_at: new Date(Date.now() + 7 * 24 * hour),
      },
    });
    matchId = match.id;
    teamAId = teamA.id;
    teamBId = teamB.id;

    const now = Date.now();
    const videos = [
      {
        title: 'E2E Replay Grand Final',
        type: 'replay' as const,
        url: 'https://example.com/replay-final',
        published_at: new Date(now - hour),
      },
      {
        title: 'E2E Highlight Week 3',
        type: 'highlight' as const,
        url: 'https://example.com/hl-week3',
        published_at: new Date(now - 2 * hour),
      },
      {
        title: 'E2E VOD Day 12',
        type: 'vod' as const,
        url: 'https://example.com/vod-day12',
        published_at: new Date(now - 3 * hour),
      },
      {
        title: 'E2E Replay Semifinal',
        type: 'replay' as const,
        url: 'https://example.com/replay-semi',
        match_id: matchId,
        duration_seconds: 5400,
        published_at: new Date(now - 4 * hour),
      },
    ];
    for (const video of videos) {
      const created = await prisma.video.create({ data: video });
      videoIds.push(created.id);
    }
  });

  afterAll(async () => {
    await prisma.video.deleteMany({ where: { id: { in: videoIds } } });
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await app.close();
  });

  it('lists videos newest first with summary shape', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/videos')
      .expect(200);

    const body = response.body as {
      data: Array<{
        id: string;
        title: string;
        published_at: string;
        match_id: string | null;
      }>;
      meta: { total: number };
    };
    expect(body.meta.total).toBeGreaterThanOrEqual(4);
    for (const id of videoIds) {
      expect(body.data.map((v) => v.id)).toContain(id);
    }
    const ours = body.data.filter((v) => videoIds.includes(v.id));
    const times = ours.map((v) => new Date(v.published_at).getTime());
    for (let i = 1; i < times.length; i++) {
      expect(times[i - 1]).toBeGreaterThanOrEqual(times[i]);
    }
    const sample = ours[0];
    expect(sample).toHaveProperty('title');
    expect(sample).toHaveProperty('type');
    expect(sample).toHaveProperty('url');
    expect(sample).toHaveProperty('thumbnail_url');
    expect(sample).toHaveProperty('duration_seconds');
  });

  it('filters by type', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/videos?type=replay')
      .expect(200);

    const body = response.body as {
      data: Array<{ id: string; type: string }>;
    };
    expect(body.data.filter((v) => videoIds.includes(v.id))).toHaveLength(2);
    expect(body.data.every((v) => v.type === 'replay')).toBe(true);
  });

  it('filters by match_id', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/videos?match_id=${matchId}`)
      .expect(200);

    const body = response.body as {
      data: Array<{ id: string; match_id: string | null }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].match_id).toBe(matchId);
    expect(body.data[0].id).toBe(videoIds[3]);
  });

  it('paginates', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/videos?pageSize=2')
      .expect(200);
    const body = response.body as {
      data: unknown[];
      meta: { totalPages: number };
    };
    expect(body.data).toHaveLength(2);
    expect(body.meta.totalPages).toBeGreaterThanOrEqual(2);
  });

  it('returns 400 for an unknown type filter', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/videos?type=bogus')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a malformed match_id filter', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/videos?match_id=not-a-uuid')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
