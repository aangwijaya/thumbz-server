import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Search (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  let tournamentId: string;
  let teamExactId: string; // slug exactly 'e2esearch'
  let teamPrefixId: string; // slug 'e2esearch-prime'
  let teamContainsId: string; // slug 'zebra-e2esearch'
  let matchAId: string;
  let playerId: string;
  let videoId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const tournament = await prisma.tournament.create({
      data: {
        slug: 'e2esearch-tour',
        name: 'E2ESearch Cup',
        status: 'ongoing',
        region: 'e2esearch-region',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    tournamentId = tournament.id;

    const exact = await prisma.team.create({
      data: {
        slug: 'e2esearch',
        name: 'Exact Search Team',
        region: 'e2esearch-region',
      },
    });
    teamExactId = exact.id;
    const prefix = await prisma.team.create({
      data: {
        slug: 'e2esearch-prime',
        name: 'Alpha Search Team',
        region: 'e2esearch-region',
      },
    });
    teamPrefixId = prefix.id;
    const contains = await prisma.team.create({
      data: {
        slug: 'zebra-e2esearch',
        name: 'Zebra Search Team',
        region: 'e2esearch-region',
      },
    });
    teamContainsId = contains.id;

    const match = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: exact.id,
        team_b_id: prefix.id,
        status: 'completed',
        winner_team_id: exact.id,
        scheduled_at: new Date('2026-09-01T10:00:00Z'),
        ended_at: new Date('2026-09-01T12:00:00Z'),
      },
    });
    matchAId = match.id;

    const player = await prisma.player.create({
      data: {
        slug: 'e2esearch-star',
        nickname: 'E2ESearch Star',
        role: 'gold',
        team_id: exact.id,
      },
    });
    playerId = player.id;

    const video = await prisma.video.create({
      data: {
        title: 'E2ESearch Grand Final Replay',
        type: 'replay',
        url: 'https://example.com/e2esearch-replay',
        match_id: matchAId,
      },
    });
    videoId = video.id;
  });

  afterAll(async () => {
    await prisma.video.deleteMany({ where: { id: videoId } });
    await prisma.match.deleteMany({ where: { id: matchAId } });
    await prisma.player.deleteMany({ where: { id: playerId } });
    await prisma.team.deleteMany({
      where: {
        slug: { in: ['e2esearch', 'e2esearch-prime', 'zebra-e2esearch'] },
      },
    });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    await app.close();
  });

  it('orders team results by relevance: exact slug, prefix, then substring', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=e2esearch&type=team')
      .expect(200);

    const body = response.body as {
      data: {
        query: string;
        teams: Array<{ id: string }>;
        matches: unknown[];
        players: unknown[];
        tournaments: unknown[];
        videos: unknown[];
      };
      meta: { total: number };
    };
    expect(body.data.query).toBe('e2esearch');
    const ids = body.data.teams
      .filter((t) => [teamExactId, teamPrefixId, teamContainsId].includes(t.id))
      .map((t) => t.id);
    expect(ids).toEqual([teamExactId, teamPrefixId, teamContainsId]);
    expect(body.data.matches).toEqual([]);
    expect(body.data.players).toEqual([]);
    expect(body.data.tournaments).toEqual([]);
    expect(body.data.videos).toEqual([]);
    expect(body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('searches all entity types with type=all', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=e2esearch')
      .expect(200);

    const body = response.body as {
      data: {
        teams: Array<{ id: string }>;
        tournaments: Array<{ id: string }>;
        players: Array<{ id: string }>;
        videos: Array<{ id: string }>;
        matches: Array<{ id: string }>;
      };
    };
    expect(body.data.teams.map((t) => t.id)).toContain(teamExactId);
    expect(body.data.tournaments.map((t) => t.id)).toContain(tournamentId);
    expect(body.data.players.map((t) => t.id)).toContain(playerId);
    expect(body.data.videos.map((t) => t.id)).toContain(videoId);
    expect(body.data.matches.map((t) => t.id)).toContain(matchAId);
  });

  it('searches matches via team names only', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=alpha&type=match')
      .expect(200);

    const body = response.body as { data: { matches: Array<{ id: string }> } };
    expect(body.data.matches.map((m) => m.id)).toContain(matchAId);
  });

  it('tolerates typos (trigram word similarity)', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=zebraa&type=team')
      .expect(200);
    const body = response.body as {
      data: { teams: Array<{ id: string }> };
      meta: { counts: { teams: number } };
    };
    expect(body.data.teams.map((t) => t.id)).toContain(teamContainsId);
    expect(body.meta.counts.teams).toBeGreaterThanOrEqual(1);
  });

  it('treats tsquery syntax in q as plain text', async () => {
    await request(app.getHttpServer())
      .get(`/api/v1/search?q=${encodeURIComponent("e2esearch & !(x) | ':*")}`)
      .expect(200);
  });

  it('suggests teams, players and tournaments for the typeahead', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search/suggest?q=e2esearch&limit=5')
      .expect(200);
    const body = response.body as {
      data: Array<{ type: string; id: string; label: string }>;
    };
    expect(body.data.length).toBeLessThanOrEqual(5);
    expect(new Set(body.data.map((item) => item.type))).toEqual(
      new Set(['team', 'player', 'tournament']),
    );
  });

  it('clamps pageSize to 20 for search', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=e2esearch&pageSize=30')
      .expect(200);

    const body = response.body as { meta: { pageSize: number } };
    expect(body.meta.pageSize).toBe(20);
  });

  it('returns 400 when q is missing', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when q is empty or whitespace only', async () => {
    for (const q of ['', '   ']) {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/search?q=${encodeURIComponent(q)}`)
        .expect(400);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 400 when q exceeds 100 characters', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/search?q=${'a'.repeat(101)}`)
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an unknown type', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/search?q=e2esearch&type=bogus')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
