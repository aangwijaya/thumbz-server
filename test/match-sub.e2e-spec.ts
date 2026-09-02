import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Match detail endpoints (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;

  let tournamentId: string;
  let team1Id: string;
  let team2Id: string;
  let team3Id: string;
  let mainMatchId: string;
  const historyIds: string[] = [];
  let scheduledId: string;
  let r1Id: string; // same tournament, team1 vs team3
  let r3Id: string; // no tournament, team1 vs team2 (pairing group)

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
        slug: 'e2e-msub-tour',
        name: 'E2E Match Sub Cup',
        status: 'ongoing',
        region: 'e2e-msub-region',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    tournamentId = tournament.id;

    const team1 = await prisma.team.create({
      data: {
        slug: 'e2e-msub-t1',
        name: 'E2E MS T1',
        region: 'e2e-msub-region',
      },
    });
    team1Id = team1.id;
    const team2 = await prisma.team.create({
      data: {
        slug: 'e2e-msub-t2',
        name: 'E2E MS T2',
        region: 'e2e-msub-region',
      },
    });
    team2Id = team2.id;
    const team3 = await prisma.team.create({
      data: {
        slug: 'e2e-msub-t3',
        name: 'E2E MS T3',
        region: 'e2e-msub-region',
      },
    });
    team3Id = team3.id;

    const player1 = await prisma.player.create({
      data: {
        slug: 'e2e-mspl-1',
        nickname: 'Alpha',
        role: 'gold',
        team_id: team1Id,
      },
    });
    const player2 = await prisma.player.create({
      data: {
        slug: 'e2e-mspl-2',
        nickname: 'Beta',
        role: 'jungle',
        team_id: team1Id,
      },
    });
    const player3 = await prisma.player.create({
      data: {
        slug: 'e2e-mspl-3',
        nickname: 'Gamma',
        role: 'mid',
        team_id: team2Id,
      },
    });

    const main = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: team1Id,
        team_b_id: team2Id,
        status: 'completed',
        winner_team_id: team1Id,
        score_a: 2,
        score_b: 1,
        scheduled_at: new Date(now - 5 * day),
        ended_at: new Date(now - 5 * day + hour),
      },
    });
    mainMatchId = main.id;

    await prisma.matchTeamStatistic.createMany({
      data: [
        {
          match_id: mainMatchId,
          team_id: team1Id,
          kills: 12,
          deaths: 8,
          assists: 24,
          gold: 45000,
          towers_destroyed: 7,
          game_duration_seconds: 1180,
        },
        {
          match_id: mainMatchId,
          team_id: team2Id,
          kills: 9,
          deaths: 12,
          assists: 18,
          gold: 40000,
          towers_destroyed: 3,
          game_duration_seconds: 1180,
        },
      ],
    });
    await prisma.playerMatchStatistic.createMany({
      data: [
        {
          match_id: mainMatchId,
          player_id: player1.id,
          team_id: team1Id,
          kills: 6,
          deaths: 1,
          assists: 7,
          gold: 9800,
          hero_picked: 'Ling',
          mvp: true,
        },
        {
          match_id: mainMatchId,
          player_id: player2.id,
          team_id: team1Id,
          kills: 3,
          deaths: 4,
          assists: 8,
          gold: 8200,
        },
        {
          match_id: mainMatchId,
          player_id: player3.id,
          team_id: team2Id,
          kills: 5,
          deaths: 2,
          assists: 6,
          gold: 8400,
          hero_picked: 'Kagura',
        },
      ],
    });

    // head-to-head history: 4 completed meetings (both sides), oldest first
    const pastMeetings = [
      { winner: team1Id, ended: now - 9 * day },
      { winner: team2Id, ended: now - 8 * day }, // reversed side: team2 as team_a
      { winner: team1Id, ended: now - 7 * day },
      { winner: team2Id, ended: now - 6 * day },
    ];
    for (const [index, meeting] of pastMeetings.entries()) {
      const reversed = index % 2 === 1;
      const created = await prisma.match.create({
        data: {
          tournament_id: tournamentId,
          team_a_id: reversed ? team2Id : team1Id,
          team_b_id: reversed ? team1Id : team2Id,
          status: 'completed',
          winner_team_id: meeting.winner,
          scheduled_at: new Date(meeting.ended - hour),
          ended_at: new Date(meeting.ended),
        },
      });
      historyIds.push(created.id);
    }

    const scheduled = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: team1Id,
        team_b_id: team2Id,
        status: 'scheduled',
        scheduled_at: new Date(now + 3 * day),
      },
    });
    scheduledId = scheduled.id;

    const r1 = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: team1Id,
        team_b_id: team3Id,
        status: 'completed',
        winner_team_id: team1Id,
        scheduled_at: new Date(now - 10 * day),
        ended_at: new Date(now - 10 * day + hour),
      },
    });
    r1Id = r1.id;

    const r3 = await prisma.match.create({
      data: {
        team_a_id: team1Id,
        team_b_id: team2Id,
        status: 'completed',
        winner_team_id: team1Id,
        scheduled_at: new Date(now - 12 * day),
        ended_at: new Date(now - 12 * day + hour),
      },
    });
    r3Id = r3.id;
  });

  afterAll(async () => {
    await prisma.match.deleteMany({
      where: {
        id: {
          in: [mainMatchId, scheduledId, r1Id, r3Id, ...historyIds],
        },
      },
    });
    await prisma.player.deleteMany({
      where: { slug: { startsWith: 'e2e-mspl-' } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [team1Id, team2Id, team3Id] } },
    });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    await app.close();
  });

  const unknownId = '00000000-0000-4000-8000-000000000000';

  it('returns 404 for unknown matches on all sub endpoints', async () => {
    for (const path of [
      `/api/v1/matches/${unknownId}/statistics`,
      `/api/v1/matches/${unknownId}/roster`,
      `/api/v1/matches/${unknownId}/history`,
      `/api/v1/matches/${unknownId}/related`,
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      const body = response.body as { error: { code: string } };
      expect(body.error.code).toBe('NOT_FOUND');
    }
  });

  it('returns match statistics with team and player rows', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${mainMatchId}/statistics`)
      .expect(200);

    const body = response.body as {
      data: {
        match_id: string;
        teams: Array<{
          team_id: string;
          team: { name: string; id: string };
          kills: number;
          gold: number;
          towers_destroyed: number;
          game_duration_seconds: number;
          details: Record<string, unknown>;
        }>;
        players: Array<{
          player_id: string;
          player: { nickname: string };
          team_id: string;
          kills: number;
          hero_picked: string | null;
          mvp: boolean;
          details: Record<string, unknown>;
        }>;
      };
    };
    expect(body.data.match_id).toBe(mainMatchId);
    expect(body.data.teams).toHaveLength(2);
    const t1 = body.data.teams.find((t) => t.team_id === team1Id);
    expect(t1).toMatchObject({
      kills: 12,
      deaths: 8,
      assists: 24,
      gold: 45000,
      towers_destroyed: 7,
      game_duration_seconds: 1180,
    });
    expect(t1?.team).toMatchObject({ id: team1Id, name: 'E2E MS T1' });
    expect(body.data.players).toHaveLength(3);
    const alpha = body.data.players.find((p) => p.player.nickname === 'Alpha');
    expect(alpha).toMatchObject({
      kills: 6,
      deaths: 1,
      assists: 7,
      gold: 9800,
      hero_picked: 'Ling',
      mvp: true,
    });
    expect(alpha?.team_id).toBe(team1Id);
  });

  it('returns empty statistics arrays when the match has no stats', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${scheduledId}/statistics`)
      .expect(200);
    const body = response.body as {
      data: { teams: unknown[]; players: unknown[] };
    };
    expect(body.data.teams).toEqual([]);
    expect(body.data.players).toEqual([]);
  });

  it('returns the match roster ordered by nickname', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${mainMatchId}/roster`)
      .expect(200);

    const body = response.body as {
      data: Array<{ nickname: string; team: { name: string } | null }>;
    };
    expect(body.data.map((p) => p.nickname)).toEqual([
      'Alpha',
      'Beta',
      'Gamma',
    ]);
    expect(body.data[0]?.team?.name).toBe('E2E MS T1');
    expect(body.data[2]?.team?.name).toBe('E2E MS T2');
  });

  it('returns empty roster when the match has no statistics', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${scheduledId}/roster`)
      .expect(200);
    const body = response.body as { data: unknown[] };
    expect(body.data).toEqual([]);
  });

  it('returns head-to-head history excluding itself and non-completed', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${mainMatchId}/history`)
      .expect(200);

    const body = response.body as { data: Array<{ id: string }> };
    const ids = body.data.map((m) => m.id);
    expect(ids).not.toContain(mainMatchId);
    expect(ids).not.toContain(scheduledId);
    expect(ids).not.toContain(r1Id); // different pairing (team1 vs team3)
    expect(ids).toHaveLength(5);

    // newest ended first: historyIds are oldest -> newest, so reversed
    // ordering starts with the newest meeting, then the pairing-only match r3
    const expectedDesc = [...historyIds].reverse();
    expect(ids.slice(0, 4)).toEqual(expectedDesc);
    expect(ids[4]).toBe(r3Id);
  });

  it('returns related matches: tournament first, preferred statuses, then pairings', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/matches/${mainMatchId}/related`)
      .expect(200);

    const body = response.body as { data: Array<{ id: string }> };
    const ids = body.data.map((m) => m.id);
    expect(ids).not.toContain(mainMatchId);
    expect(ids).toHaveLength(7);

    // same-tournament completed matches, newest ended first: h4,h3,h2,h1
    const tourCompletedDesc = [...historyIds].reverse();
    expect(ids.slice(0, 4)).toEqual(tourCompletedDesc);
    // r1 is completed but the oldest same-tournament match
    expect(ids[4]).toBe(r1Id);
    // the scheduled same-tournament match comes after all completed ones
    expect(ids[5]).toBe(scheduledId);
    // the pairing-only match (no tournament) is the last group
    expect(ids[6]).toBe(r3Id);
  });
});
