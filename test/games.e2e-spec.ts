import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import {
  bearer,
  signTestToken,
  TEST_ADMIN_ID,
  withTestAuth,
} from './utils/auth';

interface Detail {
  data: {
    game_number: number | null;
    score_a: number | null;
    score_b: number | null;
    games: Array<{
      game_number: number;
      status: string;
      winner_team_id: string | null;
      duration_seconds: number | null;
    }>;
  };
}

interface SnapshotRow {
  player_id: string;
  game_number: number;
  hero: string | null;
  player: { id: string; nickname: string; role: string };
}

/** Games of a series and per-game live data (contract §19). */
describe('Games (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let admin: string;
  let matchId: string;
  const run = randomUUID().slice(0, 8);
  const teamIds: string[] = [];
  const playerIds: string[] = [];

  const http = () => request(app.getHttpServer());
  const game = (n: number, body: object) =>
    http()
      .put(`/api/v1/admin/matches/${matchId}/games/${n}`)
      .set(bearer(admin))
      .send(body);

  beforeAll(async () => {
    const builder = await withTestAuth(
      Test.createTestingModule({ imports: [AppModule] }),
    );
    app = (await builder.compile()).createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    admin = await signTestToken(TEST_ADMIN_ID);

    for (const side of ['a', 'b']) {
      const team = await prisma.team.create({
        data: {
          slug: `e2e-g-${side}-${run}`,
          name: `E2E G ${side}`,
          region: 'e2e',
        },
      });
      teamIds.push(team.id);
      const player = await prisma.player.create({
        data: {
          slug: `e2e-g-p${side}-${run}`,
          nickname: `Pilot ${side.toUpperCase()}`,
          role: 'jungle',
          team_id: team.id,
        },
      });
      playerIds.push(player.id);
    }
    const match = await prisma.match.create({
      data: {
        team_a_id: teamIds[0],
        team_b_id: teamIds[1],
        status: 'live',
        best_of: 3,
        scheduled_at: new Date(),
      },
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.match.deleteMany({ where: { id: matchId } });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await app.close();
  });

  it('runs a series game by game and derives the score from completed games', async () => {
    const started = await game(1, { status: 'live' }).expect(200);
    expect((started.body as Detail).data.game_number).toBe(1);

    await game(2, { status: 'live' }).expect(422); // game 1 is still live
    await game(1, { status: 'completed' }).expect(422); // no winner
    await game(1, { status: 'completed', winner_team_id: randomUUID() }).expect(
      422,
    );
    await game(4, { status: 'live' }).expect(422); // beyond best_of 3

    const done = await game(1, {
      status: 'completed',
      winner_team_id: teamIds[1],
      started_at: '2026-10-01T10:00:00Z',
      ended_at: '2026-10-01T10:18:30Z',
    }).expect(200);
    const detail = (done.body as Detail).data;
    expect([detail.score_a, detail.score_b]).toEqual([0, 1]);
    expect(detail.games).toEqual([
      expect.objectContaining({
        game_number: 1,
        status: 'completed',
        winner_team_id: teamIds[1],
        duration_seconds: 1110,
      }),
    ]);

    await game(2, { status: 'live' }).expect(200);
    const read = await http().get(`/api/v1/matches/${matchId}`).expect(200);
    expect((read.body as Detail).data.games.map((g) => g.status)).toEqual([
      'completed',
      'live',
    ]);
  });

  it('scopes live data to a game, defaulting to the one being played', async () => {
    // Game 1 data explicitly, game 2 data by default (current game).
    await http()
      .put(`/api/v1/admin/matches/${matchId}/live-stats`)
      .set(bearer(admin))
      .send({
        snapshots: [
          {
            player_id: playerIds[0],
            team_id: teamIds[0],
            kills: 3,
            hero: 'Ling',
            game_number: 1,
            recorded_at: '2026-10-01T10:10:00Z',
          },
          {
            player_id: playerIds[0],
            team_id: teamIds[0],
            kills: 1,
            hero: 'Fanny',
            recorded_at: '2026-10-01T10:30:00Z',
          },
        ],
      })
      .expect(200);

    const current = await http()
      .get(`/api/v1/matches/${matchId}/live-stats`)
      .expect(200);
    const rows = (current.body as { data: SnapshotRow[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      game_number: 2,
      hero: 'Fanny',
      player: { id: playerIds[0], nickname: 'Pilot A', role: 'jungle' },
    });

    const first = await http()
      .get(`/api/v1/matches/${matchId}/live-stats?game_number=1`)
      .expect(200);
    expect((first.body as { data: SnapshotRow[] }).data).toEqual([
      expect.objectContaining({ game_number: 1, hero: 'Ling' }),
    ]);
  });

  it('accepts only known event types and requires a team for objectives', async () => {
    const put = (events: object[]) =>
      http()
        .put(`/api/v1/admin/matches/${matchId}/events`)
        .set(bearer(admin))
        .send({ events });
    await put([{ event_type: 'savage', title: 'x' }]).expect(400);
    await put([{ event_type: 'lord', title: 'Lord down' }]).expect(400);
    await put([
      { event_type: 'lord', title: 'Lord down', team_id: teamIds[0] },
      { event_type: 'other', title: 'Pause for a tech issue' },
    ]).expect(200);

    const events = await http()
      .get(`/api/v1/matches/${matchId}/events`)
      .expect(200);
    expect(
      (
        events.body as {
          data: Array<{ event_type: string; game_number: number }>;
        }
      ).data.map((e) => [e.event_type, e.game_number]),
    ).toEqual([
      ['lord', 2],
      ['other', 2],
    ]);
  });
});
