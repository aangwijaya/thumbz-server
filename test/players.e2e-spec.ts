import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Players (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;

  let tournamentId: string;
  let team1Id: string;
  let team2Id: string;
  let player1Id: string; // jungle, team1, with stats
  let player2Id: string; // gold, team2, without stats
  let player3Id: string; // mid, no team, no stats
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
        slug: 'e2e-players-tournament',
        name: 'E2E Players Cup',
        status: 'ongoing',
        region: 'e2e-players-region',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    tournamentId = tournament.id;

    const team1 = await prisma.team.create({
      data: {
        slug: 'e2e-players-onic',
        name: 'E2E Players ONIC',
        region: 'e2e-players-region',
      },
    });
    team1Id = team1.id;
    const team2 = await prisma.team.create({
      data: {
        slug: 'e2e-players-rrq',
        name: 'E2E Players RRQ',
        region: 'e2e-players-region',
      },
    });
    team2Id = team2.id;

    const player1 = await prisma.player.create({
      data: {
        slug: 'e2e-pl-kairi',
        nickname: 'Kairi',
        role: 'jungle',
        country: 'Philippines',
        team_id: team1Id,
      },
    });
    player1Id = player1.id;
    const player2 = await prisma.player.create({
      data: {
        slug: 'e2e-pl-goldy',
        nickname: 'Goldy',
        role: 'gold',
        country: 'Indonesia',
        team_id: team2Id,
      },
    });
    player2Id = player2.id;
    const player3 = await prisma.player.create({
      data: {
        slug: 'e2e-pl-loner',
        nickname: 'Loner',
        role: 'mid',
      },
    });
    player3Id = player3.id;

    // completed matches: player1 plays all three (2 wins, 1 loss)
    const results = [
      {
        kills: 5,
        deaths: 1,
        assists: 7,
        gold: 8000,
        mvp: false,
        hero: 'Ling',
        winner: team1Id,
        ended: now - 3 * day,
      },
      {
        kills: 6,
        deaths: 2,
        assists: 8,
        gold: 9000,
        mvp: true,
        hero: 'Ling',
        winner: team1Id,
        ended: now - 2 * day,
      },
      {
        kills: 2,
        deaths: 4,
        assists: 3,
        gold: 6000,
        mvp: false,
        hero: 'Kagura',
        winner: team2Id,
        ended: now - day,
      },
    ];
    for (const result of results) {
      const match = await prisma.match.create({
        data: {
          tournament_id: tournamentId,
          team_a_id: team1Id,
          team_b_id: team2Id,
          status: 'completed',
          winner_team_id: result.winner,
          scheduled_at: new Date(result.ended - hour),
          ended_at: new Date(result.ended),
        },
      });
      matchIds.push(match.id);
      await prisma.playerMatchStatistic.create({
        data: {
          match_id: match.id,
          player_id: player1Id,
          team_id: team1Id,
          kills: result.kills,
          deaths: result.deaths,
          assists: result.assists,
          gold: result.gold,
          mvp: result.mvp,
          hero_picked: result.hero,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.match.deleteMany({
      where: { id: { in: matchIds } },
    });
    await prisma.player.deleteMany({
      where: { id: { in: [player1Id, player2Id, player3Id] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [team1Id, team2Id] } },
    });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    await app.close();
  });

  it('lists players with nested team and meta', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/players?team_id=${team1Id}`)
      .expect(200);

    const body = response.body as {
      data: Array<{ nickname: string; team: { name: string } | null }>;
      meta: Record<string, unknown>;
    };
    expect(body.meta).toEqual(
      expect.objectContaining({ page: 1, pageSize: 20, total: 1 }),
    );
    expect(body.data[0].nickname).toBe('Kairi');
    expect(body.data[0].team?.name).toBe('E2E Players ONIC');
  });

  it('filters by role', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/players?team_id=${team2Id}&role=gold`)
      .expect(200);
    const body = response.body as { data: Array<{ id: string }> };
    expect(body.data.map((p) => p.id)).toEqual([player2Id]);
  });

  it('sorts by nickname', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/players?team_id=${team1Id}&sort=nickname&order=desc`)
      .expect(200);
    const body = response.body as { data: Array<{ nickname: string }> };
    expect(body.data[0].nickname).toBe('Kairi');
  });

  it('returns player detail with stats and tournament history', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/players/${player1Id}`)
      .expect(200);

    const body = response.body as {
      data: {
        slug: string;
        role: string;
        team: { name: string } | null;
        stats: {
          matches_played: number;
          avg_kills: number | null;
          avg_deaths: number | null;
          avg_assists: number | null;
          mvp_count: number;
          win_rate: number | null;
        };
        tournament_history: Array<{
          tournament: { id: string; name: string };
          placement: string | null;
          matches_played: number;
        }>;
      };
    };
    expect(body.data.slug).toBe('e2e-pl-kairi');
    expect(body.data.role).toBe('jungle');
    expect(body.data.team?.name).toBe('E2E Players ONIC');
    expect(body.data.stats).toEqual({
      matches_played: 3,
      avg_kills: 4.3,
      avg_deaths: 2.3,
      avg_assists: 6,
      mvp_count: 1,
      win_rate: 0.667,
    });
    expect(body.data.tournament_history).toEqual([
      {
        tournament: {
          id: tournamentId,
          slug: 'e2e-players-tournament',
          name: 'E2E Players Cup',
          status: 'ongoing',
          region: 'e2e-players-region',
          start_date: '2026-08-01',
          end_date: '2026-10-30',
          prize_pool: null,
          logo_url: null,
          featured: false,
        },
        placement: null,
        matches_played: 3,
      },
    ]);
  });

  it('returns empty aggregates for a player without statistics', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/players/${player3Id}`)
      .expect(200);

    const body = response.body as {
      data: {
        stats: {
          matches_played: number;
          avg_kills: number | null;
          mvp_count: number;
          win_rate: number | null;
        };
        tournament_history: unknown[];
        team: unknown;
      };
    };
    expect(body.data.stats).toEqual({
      matches_played: 0,
      avg_kills: null,
      avg_deaths: null,
      avg_assists: null,
      mvp_count: 0,
      win_rate: null,
    });
    expect(body.data.tournament_history).toEqual([]);
    expect(body.data.team).toBeNull();
  });

  it('lists the player matches via statistics', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/players/${player1Id}/matches?status=completed`)
      .expect(200);

    const body = response.body as {
      data: Array<{ id: string; status: string }>;
    };
    expect(body.data.map((m) => m.id).sort()).toEqual([...matchIds].sort());
    expect(body.data.every((m) => m.status === 'completed')).toBe(true);
  });

  it('returns player statistics with per_hero aggregates', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/players/${player1Id}/statistics`)
      .expect(200);

    const body = response.body as {
      data: {
        player_id: string;
        matches_played: number;
        avg_kills: number | null;
        avg_gold: number | null;
        mvp_count: number;
        win_rate: number | null;
        per_hero: Array<{
          hero: string;
          games: number;
          wins: number;
          avg_kills: number;
        }>;
      };
    };
    expect(body.data.player_id).toBe(player1Id);
    expect(body.data.matches_played).toBe(3);
    expect(body.data.avg_gold).toBe(7666.7);
    expect(body.data.mvp_count).toBe(1);
    expect(body.data.win_rate).toBe(0.667);
    expect(body.data.per_hero).toEqual([
      { hero: 'Ling', games: 2, wins: 2, avg_kills: 5.5 },
      { hero: 'Kagura', games: 1, wins: 0, avg_kills: 2 },
    ]);
  });

  it('returns 404 for an unknown player', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    for (const path of [
      `/api/v1/players/${unknown}`,
      `/api/v1/players/${unknown}/matches`,
      `/api/v1/players/${unknown}/statistics`,
    ]) {
      const response = await request(app.getHttpServer()).get(path).expect(404);
      expect(response.body).toEqual({
        error: { code: 'NOT_FOUND', message: 'Not found', details: null },
      });
    }
  });

  it('returns 400 for a malformed player id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/players/not-a-uuid')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for an unknown role filter', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/players?role=bogus')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
