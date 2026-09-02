import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Matches (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const now = Date.now();
  const minute = 60_000;
  const hour = 3_600_000;
  const day = 24 * hour;

  let tournamentId: string;
  let otherTournamentId: string;
  let teamAId: string;
  let teamBId: string;
  const matchIds: Record<string, string> = {};

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
        slug: 'e2e-matches-tournament',
        name: 'E2E Matches Cup',
        status: 'ongoing',
        region: 'Indonesia',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    tournamentId = tournament.id;

    const other = await prisma.tournament.create({
      data: {
        slug: 'e2e-matches-other',
        name: 'E2E Other Cup',
        status: 'ongoing',
        region: 'Philippines',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    otherTournamentId = other.id;

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-matches-onic',
        name: 'E2E ONIC',
        region: 'Indonesia',
        color_primary: '#FFD700',
        logo_url: 'https://example.com/onic.png',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: { slug: 'e2e-matches-rrq', name: 'E2E RRQ', region: 'Indonesia' },
    });
    teamBId = teamB.id;

    const data = [
      {
        key: 'liveFeatured',
        data: {
          tournament_id: tournamentId,
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'live' as const,
          featured: true,
          viewer_count: 50000,
          started_at: new Date(now - 10 * minute),
          scheduled_at: new Date(now - 20 * minute),
          stream_url: 'https://example.com/stream-a',
        },
      },
      {
        key: 'liveOther',
        data: {
          tournament_id: tournamentId,
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'live' as const,
          featured: false,
          viewer_count: 30000,
          started_at: new Date(now - 5 * minute),
          scheduled_at: new Date(now - 10 * minute),
        },
      },
      {
        key: 'scheduledFuture',
        data: {
          tournament_id: tournamentId,
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'scheduled' as const,
          scheduled_at: new Date(now + 3 * day),
        },
      },
      {
        key: 'scheduledPast',
        data: {
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'scheduled' as const,
          scheduled_at: new Date(now - day),
        },
      },
      {
        key: 'scheduledOtherTournament',
        data: {
          tournament_id: otherTournamentId,
          team_a_id: teamBId,
          team_b_id: teamAId,
          status: 'scheduled' as const,
          scheduled_at: new Date(now + 5 * day),
        },
      },
      {
        key: 'completed',
        data: {
          tournament_id: tournamentId,
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'completed' as const,
          score_a: 2,
          score_b: 1,
          winner_team_id: teamAId,
          scheduled_at: new Date(now - 2 * day),
          ended_at: new Date(now - 2 * day + hour),
        },
      },
    ];

    for (const { key, data: match } of data) {
      const created = await prisma.match.create({ data: match });
      matchIds[key] = created.id;
    }
  });

  afterAll(async () => {
    await prisma.match.deleteMany({
      where: { id: { in: Object.values(matchIds) } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.tournament.deleteMany({
      where: { id: { in: [tournamentId, otherTournamentId] } },
    });
    await app.close();
  });

  it('lists matches with summary shape and meta', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches?team_id=${teamAId}`)
      .expect(200);

    const body = response.body as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.meta.total).toBe(6);
    const first = body.data[0];
    expect(first).toHaveProperty('tournament_id');
    expect(first).toHaveProperty('tournament');
    expect(first).toHaveProperty('team_a');
    expect(first).not.toHaveProperty('stream_url');
  });

  it('filters by status', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches?status=completed&team_id=${teamAId}`)
      .expect(200);

    const body = response.body as { data: Array<{ id: string }> };
    expect(body.data.map((m) => m.id)).toEqual([matchIds.completed]);
  });

  it('filters by tournament_id and team_id on either side', async () => {
    const byTournament = await request(app.getHttpServer())
      .get(`/api/v1/matches?tournament_id=${tournamentId}`)
      .expect(200);
    const body = byTournament.body as { data: unknown[] };
    expect(body.data).toHaveLength(4);

    const byTeam = await request(app.getHttpServer())
      .get(`/api/v1/matches?team_id=${teamAId}`)
      .expect(200);
    const teamBody = byTeam.body as { data: unknown[] };
    expect(teamBody.data).toHaveLength(6);

    const teamBOnly = await request(app.getHttpServer())
      .get(
        `/api/v1/matches?team_id=${teamBId}&tournament_id=${otherTournamentId}`,
      )
      .expect(200);
    const teamBOnlyBody = teamBOnly.body as { data: Array<{ id: string }> };
    expect(teamBOnlyBody.data.map((m) => m.id)).toEqual([
      matchIds.scheduledOtherTournament,
    ]);
  });

  it('filters by from/to on scheduled_at', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/matches?from=${new Date(now - day + 5 * minute).toISOString()}&to=${new Date(now + day).toISOString()}`,
      )
      .expect(200);

    const body = response.body as { data: Array<{ id: string }> };
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain(matchIds.liveFeatured);
    expect(ids).not.toContain(matchIds.completed);
    expect(ids).not.toContain(matchIds.scheduledFuture);
  });

  it('sorts by viewer_count desc', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches?sort=viewer_count&order=desc')
      .expect(200);

    const body = response.body as { data: Array<{ viewer_count: number }> };
    expect(body.data[0].viewer_count).toBe(50000);
    expect(body.data[1].viewer_count).toBe(30000);
  });

  it('GET /matches/live returns live matches ordered by viewers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/live')
      .expect(200);

    const body = response.body as {
      data: Array<{ id: string; status: string; viewer_count: number }>;
    };
    expect(body.data.every((m) => m.status === 'live')).toBe(true);

    // relative ordering of our two fixtures, robust to other specs' matches
    const indexOfFeatured = body.data.findIndex(
      (m) => m.id === matchIds.liveFeatured,
    );
    const indexOfOther = body.data.findIndex(
      (m) => m.id === matchIds.liveOther,
    );
    expect(indexOfFeatured).toBeGreaterThanOrEqual(0);
    expect(indexOfOther).toBeGreaterThan(indexOfFeatured);
  });

  it('GET /matches/upcoming excludes past and non-scheduled matches by default', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/upcoming')
      .expect(200);

    const body = response.body as { data: Array<{ id: string }> };
    const ids = body.data.map((m) => m.id);
    expect(ids).toContain(matchIds.scheduledFuture);
    expect(ids).toContain(matchIds.scheduledOtherTournament);
    expect(ids).not.toContain(matchIds.scheduledPast);
    expect(ids).not.toContain(matchIds.liveFeatured);
  });

  it('GET /matches/upcoming supports from and tournament_id', async () => {
    const response = await request(app.getHttpServer())
      .get(
        `/api/v1/matches/upcoming?from=${new Date(now + 4 * day).toISOString()}&tournament_id=${otherTournamentId}`,
      )
      .expect(200);

    const body = response.body as { data: Array<{ id: string }> };
    expect(body.data.map((m) => m.id)).toEqual([
      matchIds.scheduledOtherTournament,
    ]);
  });

  it('GET /matches/featured returns the most recently started featured live match', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/featured')
      .expect(200);

    const body = response.body as {
      data: {
        id: string;
        stream_url: string | null;
        team_a: { region: string };
        tournament: { status: string; region: string };
      };
    };
    expect(body.data.id).toBe(matchIds.liveFeatured);
    expect(body.data.stream_url).toBe('https://example.com/stream-a');
    expect(body.data.team_a.region).toBe('Indonesia');
    expect(body.data.tournament.status).toBe('ongoing');
  });

  it('GET /matches/:id returns match detail', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${matchIds.completed}`)
      .expect(200);

    const body = response.body as {
      data: { status: string; winner_team_id: string; score_a: number };
    };
    expect(body.data.status).toBe('completed');
    expect(body.data.score_a).toBe(2);
    expect(body.data.winner_team_id).toBe(teamAId);
  });

  it('returns 404 for an unknown match id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/00000000-0000-4000-8000-000000000000')
      .expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });

  it('returns 400 for a malformed match id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches/not-a-uuid')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an unknown status filter', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches?status=bogus')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for pageSize above the cap', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/matches?pageSize=999')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
