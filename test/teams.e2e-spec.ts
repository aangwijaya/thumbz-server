import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Teams (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;

  let tournamentId: string;
  let teamAId: string;
  let teamBId: string;
  let teamCId: string;

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
        slug: 'e2e-teams-tournament',
        name: 'E2E Teams Cup',
        status: 'ongoing',
        region: 'e2e-teams-region',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    tournamentId = tournament.id;

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-teams-onic',
        name: 'E2E ONIC',
        region: 'e2e-teams-region',
        description: 'champions of everything',
        founded_year: 2018,
        color_primary: '#FFD700',
      },
    });
    teamAId = teamA.id;

    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-teams-rrq',
        name: 'E2E RRQ',
        region: 'e2e-teams-region',
      },
    });
    teamBId = teamB.id;

    const teamC = await prisma.team.create({
      data: {
        slug: 'e2e-teams-evos',
        name: 'E2E EVOS',
        region: 'e2e-teams-other-region',
      },
    });
    teamCId = teamC.id;

    // Team A record: 3 completed (2 wins, 1 loss) + 1 live + 1 scheduled future
    const results = [
      {
        score_a: 0,
        score_b: 1,
        winner_team_id: teamBId,
        ended_at: new Date(now - 3 * day),
      },
      {
        score_a: 2,
        score_b: 1,
        winner_team_id: teamAId,
        ended_at: new Date(now - 2 * day),
      },
      {
        score_a: 2,
        score_b: 0,
        winner_team_id: teamAId,
        ended_at: new Date(now - day),
      },
    ];
    const completedMatchIds: string[] = [];
    for (const result of results) {
      const created = await prisma.match.create({
        data: {
          tournament_id: tournamentId,
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'completed',
          scheduled_at: new Date(result.ended_at.getTime() - hour),
          ...result,
        },
      });
      completedMatchIds.push(created.id);
    }

    // team statistics rows for two of the three completed matches
    await prisma.matchTeamStatistic.create({
      data: {
        match_id: completedMatchIds[0],
        team_id: teamAId,
        kills: 10,
        deaths: 4,
        gold: 40000,
      },
    });
    await prisma.matchTeamStatistic.create({
      data: {
        match_id: completedMatchIds[1],
        team_id: teamAId,
        kills: 20,
        deaths: 10,
        gold: 60000,
      },
    });

    // roster players: team A active in several roles + one inactive
    const players = [
      { slug: 'e2e-p-kairi', nickname: 'Kairi', role: 'jungle' as const },
      { slug: 'e2e-p-alpha', nickname: 'Alpha', role: 'gold' as const },
      { slug: 'e2e-p-goldy', nickname: 'Goldy', role: 'gold' as const },
      { slug: 'e2e-p-middy', nickname: 'Middy', role: 'mid' as const },
      { slug: 'e2e-p-coach', nickname: 'Zed Coach', role: 'coach' as const },
      {
        slug: 'e2e-p-ghost',
        nickname: 'Ghost',
        role: 'gold' as const,
        is_active: false,
      },
    ];
    for (const player of players) {
      await prisma.player.create({
        data: {
          team_id: teamAId,
          country: 'Indonesia',
          ...player,
        },
      });
    }

    await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        scheduled_at: new Date(now - 30 * 60_000),
        started_at: new Date(now - 25 * 60_000),
        viewer_count: 500,
      },
    });

    await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date(now + 3 * day),
      },
    });
  });

  afterAll(async () => {
    await prisma.match.deleteMany({
      where: {
        OR: [{ team_a_id: teamAId }, { team_b_id: teamAId }],
      },
    });
    await prisma.player.deleteMany({ where: { team_id: teamAId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId, teamCId] } },
    });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    await app.close();
  });

  it('lists teams with summary shape and meta', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/teams?region=e2e-teams-region')
      .expect(200);

    const body = response.body as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.meta).toEqual(
      expect.objectContaining({ page: 1, pageSize: 20, total: 2 }),
    );
    expect(body.data[0]).toHaveProperty('color_primary');
    expect(body.data[0]).not.toHaveProperty('description');
  });

  it('filters by region exact match', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/teams?region=e2e-teams-other-region')
      .expect(200);
    const body = response.body as { data: Array<{ slug: string }> };
    expect(body.data.map((t) => t.slug)).toEqual(['e2e-teams-evos']);
  });

  it('filters by tournament_id through matches', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams?tournament_id=${tournamentId}`)
      .expect(200);
    const body = response.body as { data: Array<{ slug: string }> };
    const slugs = body.data.map((t) => t.slug);
    expect(slugs).toContain('e2e-teams-onic');
    expect(slugs).toContain('e2e-teams-rrq');
    expect(slugs).not.toContain('e2e-teams-evos');
  });

  it('sorts by created_at', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/teams?region=e2e-teams-region&sort=created_at&order=asc')
      .expect(200);
    const body = response.body as { data: Array<{ slug: string }> };
    expect(body.data[0].slug).toBe('e2e-teams-onic');
  });

  it('paginates', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/teams?region=e2e-teams-region&pageSize=1')
      .expect(200);
    const body = response.body as {
      data: unknown[];
      meta: { totalPages: number };
    };
    expect(body.data).toHaveLength(1);
    expect(body.meta.totalPages).toBe(2);
  });

  it('returns team detail with stats, form, live and next match', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamAId}`)
      .expect(200);

    const body = response.body as {
      data: {
        description: string;
        founded_year: number;
        stats: {
          matches_played: number;
          matches_won: number;
          win_rate: number | null;
          current_form: string[];
        };
        live_match: { id: string } | null;
        next_match: { id: string } | null;
      };
    };
    expect(body.data.description).toBe('champions of everything');
    expect(body.data.founded_year).toBe(2018);
    expect(body.data.stats).toEqual({
      matches_played: 3,
      matches_won: 2,
      win_rate: 0.667,
      current_form: ['L', 'W', 'W'],
    });
    expect(body.data.live_match).not.toBeNull();
    expect(body.data.next_match).not.toBeNull();
    expect(body.data.live_match?.id).not.toBe(body.data.next_match?.id);
  });

  it('returns empty stats and null live/next for a team without matches', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamCId}`)
      .expect(200);

    const body = response.body as {
      data: {
        stats: {
          matches_played: number;
          matches_won: number;
          win_rate: number | null;
          current_form: unknown[];
        };
        live_match: unknown;
        next_match: unknown;
      };
    };
    expect(body.data.stats).toEqual({
      matches_played: 0,
      matches_won: 0,
      win_rate: null,
      current_form: [],
    });
    expect(body.data.live_match).toBeNull();
    expect(body.data.next_match).toBeNull();
  });

  it('lists team matches newest first', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamAId}/matches?status=completed`)
      .expect(200);

    const body = response.body as {
      data: Array<{ status: string; ended_at: string | null }>;
    };
    expect(body.data).toHaveLength(3);
    expect(body.data.every((m) => m.status === 'completed')).toBe(true);
    const endedAts = body.data.map((m) => new Date(m.ended_at ?? 0).getTime());
    expect(endedAts[0]).toBeGreaterThanOrEqual(endedAts[1]);
    expect(endedAts[1]).toBeGreaterThanOrEqual(endedAts[2]);
  });

  it('returns 404 for an unknown team id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/teams/00000000-0000-4000-8000-000000000000')
      .expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });

  it('returns 400 for a malformed team id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/teams/not-a-uuid')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an unknown status filter on team matches', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamAId}/matches?status=bogus`)
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns team statistics with averages and per_tournament', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamAId}/statistics`)
      .expect(200);

    const body = response.body as {
      data: {
        team_id: string;
        matches_played: number;
        matches_won: number;
        win_rate: number | null;
        avg_kills: number | null;
        avg_deaths: number | null;
        avg_gold: number | null;
        per_tournament: Array<{
          tournament: { id: string; name: string };
          matches_played: number;
          wins: number;
        }>;
      };
    };
    expect(body.data).toEqual({
      team_id: teamAId,
      matches_played: 3,
      matches_won: 2,
      win_rate: 0.667,
      avg_kills: 15,
      avg_deaths: 7,
      avg_gold: 50000,
      per_tournament: [
        {
          tournament: {
            id: tournamentId,
            name: 'E2E Teams Cup',
            slug: 'e2e-teams-tournament',
          },
          matches_played: 3,
          wins: 2,
        },
      ],
    });
  });

  it('returns nullable statistics for a team without matches', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamCId}/statistics`)
      .expect(200);

    const body = response.body as {
      data: {
        matches_played: number;
        matches_won: number;
        win_rate: number | null;
        avg_kills: number | null;
        avg_deaths: number | null;
        avg_gold: number | null;
        per_tournament: unknown[];
      };
    };
    expect(body.data).toEqual({
      team_id: teamCId,
      matches_played: 0,
      matches_won: 0,
      win_rate: null,
      avg_kills: null,
      avg_deaths: null,
      avg_gold: null,
      per_tournament: [],
    });
  });

  it('returns the roster in role order with only active players', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamAId}/roster`)
      .expect(200);

    const body = response.body as {
      data: Array<{
        nickname: string;
        role: string;
        is_active: boolean;
        team: { name: string } | null;
      }>;
    };
    expect(body.data.map((p) => p.nickname)).toEqual([
      'Alpha',
      'Goldy',
      'Middy',
      'Kairi',
      'Zed Coach',
    ]);
    expect(body.data.every((p) => p.is_active)).toBe(true);
    expect(body.data.every((p) => p.team?.name === 'E2E ONIC')).toBe(true);
  });

  it('returns an empty roster for a team without players', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/teams/${teamCId}/roster`)
      .expect(200);
    const body = response.body as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns 404 for statistics of an unknown team', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/teams/00000000-0000-4000-8000-000000000000/statistics')
      .expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });
});
