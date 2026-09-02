import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Tournament detail endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;

  let tournamentId: string;
  let teamAId: string;
  let teamBId: string;
  let teamCId: string;
  const matchIds: string[] = [];

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
        slug: 'e2e-tdetail-tour',
        name: 'E2E Tournament Detail Cup',
        status: 'ongoing',
        region: 'e2e-tdetail-region',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    tournamentId = tournament.id;

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-tdetail-a',
        name: 'E2E TD A',
        region: 'e2e-tdetail-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-tdetail-b',
        name: 'E2E TD B',
        region: 'e2e-tdetail-region',
      },
    });
    teamBId = teamB.id;
    const teamC = await prisma.team.create({
      data: {
        slug: 'e2e-tdetail-c',
        name: 'E2E TD C',
        region: 'e2e-tdetail-region',
      },
    });
    teamCId = teamC.id;

    const fixtures: Array<{
      key: string;
      stage: 'group_stage' | 'playoffs';
      status: 'completed' | 'live' | 'scheduled';
      team_a: string;
      team_b: string;
      winner: string | null;
      ended: Date | null;
      viewers: number;
    }> = [
      {
        // standings: A and B each 1 win -> tied; C 0 wins
        key: 'groupCompletedA',
        stage: 'group_stage' as const,
        status: 'completed' as const,
        team_a: teamAId,
        team_b: teamCId,
        winner: teamAId,
        ended: new Date(now - 2 * day),
        viewers: 0,
      },
      {
        key: 'groupCompletedB',
        stage: 'group_stage' as const,
        status: 'completed' as const,
        team_a: teamBId,
        team_b: teamCId,
        winner: teamBId,
        ended: new Date(now - 2 * day + hour),
        viewers: 0,
      },
      {
        key: 'groupLive',
        stage: 'group_stage' as const,
        status: 'live' as const,
        team_a: teamAId,
        team_b: teamBId,
        winner: null,
        ended: null,
        viewers: 777,
      },
      {
        key: 'playoffsScheduled',
        stage: 'playoffs' as const,
        status: 'scheduled' as const,
        team_a: teamAId,
        team_b: teamBId,
        winner: null,
        ended: null,
        viewers: 0,
      },
    ];

    for (const fixture of fixtures) {
      const match = await prisma.match.create({
        data: {
          tournament_id: tournamentId,
          stage: fixture.stage,
          team_a_id: fixture.team_a,
          team_b_id: fixture.team_b,
          status: fixture.status,
          winner_team_id: fixture.winner,
          viewer_count: fixture.viewers,
          scheduled_at:
            fixture.ended === null
              ? new Date(now + 3 * day)
              : new Date(fixture.ended.getTime() - hour),
          ended_at: fixture.ended,
        },
      });
      matchIds.push(match.id);
    }
  });

  afterAll(async () => {
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId, teamCId] } },
    });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    await app.close();
  });

  const unknownId = '00000000-0000-4000-8000-000000000000';

  it('returns 404 for unknown tournament on all sub endpoints', async () => {
    for (const path of [
      `/api/v1/tournaments/${unknownId}/schedule`,
      `/api/v1/tournaments/${unknownId}/standings`,
      `/api/v1/tournaments/${unknownId}/results`,
      `/api/v1/tournaments/${unknownId}/stages`,
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    }
  });

  it('groups the schedule by stage in progression order', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${tournamentId}/schedule`)
      .expect(200);

    const body = response.body as {
      data: Array<{ stage: string; matches: unknown[] }>;
      meta: { total: number; totalPages: number };
    };
    expect(body.data.map((group) => group.stage)).toEqual([
      'group_stage',
      'playoffs',
    ]);
    expect(body.meta.total).toBe(2);
    expect(body.data[0]?.matches).toHaveLength(3);
    expect(body.data[1]?.matches).toHaveLength(1);
  });

  it('filters the schedule by stage', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${tournamentId}/schedule?stage=playoffs`)
      .expect(200);

    const body = response.body as {
      data: Array<{ stage: string; matches: unknown[] }>;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.stage).toBe('playoffs');
  });

  it('returns 400 for an invalid stage filter', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${tournamentId}/schedule?stage=bogus`)
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('computes standings with shared ranks for ties', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${tournamentId}/standings`)
      .expect(200);

    const body = response.body as {
      data: {
        tournament_id: string;
        standings: Array<{
          rank: number;
          team: { name: string };
          played: number;
          wins: number;
          losses: number;
          win_rate: number | null;
        }>;
      };
    };
    expect(body.data.tournament_id).toBe(tournamentId);
    const projected = body.data.standings.map((entry) => ({
      rank: entry.rank,
      name: entry.team.name,
      played: entry.played,
      wins: entry.wins,
      losses: entry.losses,
      win_rate: entry.win_rate,
    }));
    expect(projected).toEqual([
      { rank: 1, name: 'E2E TD A', played: 1, wins: 1, losses: 0, win_rate: 1 },
      { rank: 1, name: 'E2E TD B', played: 1, wins: 1, losses: 0, win_rate: 1 },
      { rank: 3, name: 'E2E TD C', played: 2, wins: 0, losses: 2, win_rate: 0 },
    ]);
  });

  it('lists completed results newest first', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${tournamentId}/results`)
      .expect(200);

    const body = response.body as {
      data: Array<{ id: string; status: string }>;
      meta: { total: number };
    };
    expect(body.meta.total).toBe(2);
    expect(body.data.every((m) => m.status === 'completed')).toBe(true);
    const ordered = body.data.map((m) => m.id);
    expect(ordered[0]).toBe(matchIds[1]); // B win ended later
    expect(ordered[1]).toBe(matchIds[0]);
  });

  it('rolls up stage counts', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${tournamentId}/stages`)
      .expect(200);

    const body = response.body as {
      data: Array<{
        stage: string;
        match_count: number;
        completed_count: number;
        live_count: number;
      }>;
    };
    expect(body.data).toEqual([
      {
        stage: 'group_stage',
        match_count: 3,
        completed_count: 2,
        live_count: 1,
      },
      { stage: 'playoffs', match_count: 1, completed_count: 0, live_count: 0 },
    ]);
  });
});
