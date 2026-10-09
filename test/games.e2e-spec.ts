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
  it('stores statistics, builds and icons per game', async () => {
    const icon = (path: string) => `https://img.example.com/${path}.png`;
    const statistics = (gameNumber: number | undefined, kills: number) =>
      http()
        .put(`/api/v1/admin/matches/${matchId}/statistics`)
        .set(bearer(admin))
        .send({
          ...(gameNumber === undefined ? {} : { game_number: gameNumber }),
          teams: [
            { team_id: teamIds[0], kills, details: { lords: 1, turtles: 2 } },
          ],
          players: [
            {
              player_id: playerIds[0],
              team_id: teamIds[0],
              kills,
              hero_picked: 'Ling',
              hero_icon_url: icon('hero/ling'),
              tower_damage: 4200,
              emblem: { id: '20005', name: 'Assassin', icon_url: icon('e') },
              talents: [{ id: '1', name: 'Rupture', icon_url: icon('t') }],
              items: [
                { id: '2', name: 'Blade of Despair', icon_url: icon('i') },
              ],
            },
          ],
        });

    await statistics(1, 7).expect(200);
    // No game_number: the game being played (2).
    const current = await statistics(undefined, 2).expect(200);
    expect((current.body as { data: { game_number: number } }).data).toEqual(
      expect.objectContaining({ game_number: 2 }),
    );
    await statistics(1, 9).expect(200); // re-submission replaces game 1

    const read = (query = '') =>
      http().get(`/api/v1/matches/${matchId}/statistics${query}`).expect(200);
    type Stats = {
      data: {
        game_number: number;
        teams: Array<{ kills: number; details: Record<string, unknown> }>;
        players: Array<Record<string, unknown>>;
      };
    };
    const first = ((await read('?game_number=1')).body as Stats).data;
    expect(first.game_number).toBe(1);
    expect(first.teams).toEqual([
      expect.objectContaining({ kills: 9, details: { lords: 1, turtles: 2 } }),
    ]);
    expect(first.players).toEqual([
      expect.objectContaining({
        kills: 9,
        hero_picked: 'Ling',
        hero_icon_url: icon('hero/ling'),
        tower_damage: 4200,
        emblem: { id: '20005', name: 'Assassin', icon_url: icon('e') },
        talents: [{ id: '1', name: 'Rupture', icon_url: icon('t') }],
        items: [{ id: '2', name: 'Blade of Despair', icon_url: icon('i') }],
      }),
    ]);
    const byDefault = ((await read()).body as Stats).data;
    expect(byDefault.game_number).toBe(2);
    expect(byDefault.players[0]).toMatchObject({ kills: 2 });

    // Icons must be https.
    await http()
      .put(`/api/v1/admin/matches/${matchId}/statistics`)
      .set(bearer(admin))
      .send({
        players: [
          {
            player_id: playerIds[0],
            team_id: teamIds[0],
            hero_icon_url: 'javascript:alert(1)',
          },
        ],
      })
      .expect(400);

    // The roster lists a player once, whatever the number of games.
    const roster = await http()
      .get(`/api/v1/matches/${matchId}/roster`)
      .expect(200);
    expect((roster.body as { data: Array<{ id: string }> }).data).toEqual([
      expect.objectContaining({ id: playerIds[0] }),
    ]);
  });

  it('keeps the item sequence with tiers and icons', async () => {
    await http()
      .put(`/api/v1/admin/matches/${matchId}/equipment`)
      .set(bearer(admin))
      .send({
        purchases: [
          {
            player_id: playerIds[0],
            team_id: teamIds[0],
            item_id: '2',
            item_name: 'Blade of Despair',
            phase: 'phase3',
            tier: 3,
            icon_url: 'https://img.example.com/i.png',
            game_number: 1,
            purchased_at: '2026-10-01T10:14:00Z',
          },
          {
            player_id: playerIds[0],
            team_id: teamIds[0],
            item_id: '9',
            item_name: 'Knife',
            phase: 'phase2',
            tier: 1,
            game_number: 1,
            purchased_at: '2026-10-01T10:01:00Z',
          },
        ],
      })
      .expect(200);
    const rows = await http()
      .get(`/api/v1/matches/${matchId}/equipment?game_number=1`)
      .expect(200);
    expect(
      (
        rows.body as {
          data: Array<{ item_id: string; tier: number; icon_url: string }>;
        }
      ).data.map((row) => [row.item_id, row.tier, row.icon_url]),
    ).toEqual([
      ['9', 1, null],
      ['2', 3, 'https://img.example.com/i.png'],
    ]);
  });

  it('counts a series once in player aggregates, averaging per game', async () => {
    await game(2, { status: 'completed', winner_team_id: teamIds[0] });
    await game(3, { status: 'live' }).expect(200);
    await game(3, {
      status: 'completed',
      winner_team_id: teamIds[0],
    }).expect(200);
    await prisma.match.update({
      where: { id: matchId },
      data: { status: 'completed', winner_team_id: teamIds[0] },
    });

    const stats = await http()
      .get(`/api/v1/players/${playerIds[0]}/statistics`)
      .expect(200);
    const data = (
      stats.body as {
        data: {
          matches_played: number;
          win_rate: number;
          avg_kills: number;
          per_hero: Array<{ hero: string; games: number; wins: number }>;
        };
      }
    ).data;
    // Games 1 (9 kills, lost) and 2 (2 kills, won); one series, won.
    expect(data.matches_played).toBe(1);
    expect(data.win_rate).toBe(1);
    expect(data.avg_kills).toBe(5.5);
    expect(data.per_hero).toEqual([
      expect.objectContaining({ hero: 'Ling', games: 2, wins: 1 }),
    ]);
  });
});
