import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';
import { LiveSimulatorService } from './../src/modules/simulator/live-simulator.service';
import { SimulatorModule } from './../src/modules/simulator/simulator.module';
import type {
  GameScript,
  RecordedPlayer,
} from './../src/modules/simulator/replay';

interface Detail {
  data: {
    status: string;
    score_a: number;
    score_b: number;
    game_number: number | null;
    games: Array<{
      game_number: number;
      status: string;
      winner_team_id: string | null;
      duration_seconds: number | null;
    }>;
  };
}

const DURATION = 600;
const BREAK_SECONDS = 120;

/** The demo engine replays recorded games live, then loops the series. */
describe('Live replay (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let engine: LiveSimulatorService;
  let matchId: string;
  let scheduledId: string;
  const run = randomUUID().slice(0, 8);
  const teamIds: string[] = [];
  const playerIds: string[] = [];
  const t0 = new Date('2026-10-09T10:00:00Z').getTime();

  const http = () => request(app.getHttpServer());
  const at = (seconds: number) => jest.setSystemTime(t0 + seconds * 1000);
  const detail = async () =>
    (
      (await http().get(`/api/v1/matches/${matchId}`).expect(200))
        .body as Detail
    ).data;

  const script = (): GameScript => {
    const player = (index: number, stats: Partial<RecordedPlayer>) => ({
      player_id: playerIds[index],
      team_id: teamIds[index],
      hero: index === 0 ? 'Ling' : 'Tigreal',
      hero_icon_url: 'https://img.example.com/hero.png',
      kills: 0,
      deaths: 0,
      assists: 0,
      gold: 9_000,
      damage: 70_000,
      damage_taken: 40_000,
      tower_damage: 2_000,
      emblem: { id: '20005', name: 'Assassin', icon_url: null },
      talents: [],
      items: [{ id: '2', name: 'Blade of Despair', icon_url: null }],
      purchases: [],
      ...stats,
    });
    return {
      players: [
        player(0, {
          kills: 5,
          deaths: 1,
          purchases: [
            {
              item_id: '1',
              item_name: 'Knife',
              icon_url: null,
              tier: 1,
              second: 10,
            },
            {
              item_id: '2',
              item_name: 'Blade of Despair',
              icon_url: null,
              tier: 3,
              second: 500,
            },
          ],
        }),
        player(1, { kills: 1, deaths: 5 }),
      ],
      teams: teamIds.map((team_id, index) => ({
        team_id,
        kills: index === 0 ? 5 : 1,
        deaths: index === 0 ? 1 : 5,
        assists: 0,
        gold: 9_000,
        towers: index === 0 ? 6 : 1,
        lords: index === 0 ? 1 : 0,
        turtles: 1,
        details: {},
      })),
    };
  };

  beforeAll(async () => {
    // Only Date is faked: the database and Redis clients keep real timers.
    jest.useFakeTimers({
      now: t0,
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'queueMicrotask',
        'hrtime',
        'performance',
      ],
    });
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule, SimulatorModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    engine = app.get(LiveSimulatorService);

    for (const side of ['a', 'b']) {
      const team = await prisma.team.create({
        data: {
          slug: `e2e-r-${side}-${run}`,
          name: `Replay ${side}`,
          region: 'e2e',
        },
      });
      teamIds.push(team.id);
      const player = await prisma.player.create({
        data: {
          slug: `e2e-r-p${side}-${run}`,
          nickname: `Replayer ${side.toUpperCase()}`,
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
        scheduled_at: new Date(t0),
      },
    });
    matchId = match.id;
    for (const game_number of [1, 2]) {
      await prisma.matchGameRecording.create({
        data: {
          match_id: matchId,
          game_number,
          duration_seconds: DURATION,
          winner_team_id: teamIds[0],
          script: script(),
        },
      });
    }
    const scheduled = await prisma.match.create({
      data: {
        team_a_id: teamIds[0],
        team_b_id: teamIds[1],
        status: 'scheduled',
        best_of: 3,
        scheduled_at: new Date(t0 + 10 * 60_000),
      },
    });
    scheduledId = scheduled.id;
  });

  afterAll(async () => {
    jest.useRealTimers();
    await prisma.match.deleteMany({
      where: { id: { in: [matchId, scheduledId] } },
    });
    await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    await prisma.team.deleteMany({ where: { id: { in: teamIds } } });
    await app.close();
  });

  it('plays a recorded game live: stats, real item seconds, reconstructed events', async () => {
    at(0);
    await engine.replayMatch(matchId);
    expect((await detail()).games).toEqual([
      expect.objectContaining({ game_number: 1, status: 'live' }),
    ]);

    at(300);
    await engine.replayMatch(matchId);
    const stats = (
      await http().get(`/api/v1/matches/${matchId}/live-stats`).expect(200)
    ).body as {
      data: Array<{ player_id: string; gold: number; hero: string }>;
    };
    const latest = stats.data
      .filter((row) => row.player_id === playerIds[0])
      .at(-1);
    expect(latest?.hero).toBe('Ling');
    expect(latest?.gold).toBeGreaterThan(0);
    expect(latest?.gold).toBeLessThan(9_000);

    const items = (
      await http().get(`/api/v1/matches/${matchId}/equipment`).expect(200)
    ).body as {
      data: Array<{ item_name: string; purchased_at: string; tier: number }>;
    };
    expect(items.data).toEqual([
      expect.objectContaining({
        item_name: 'Knife',
        tier: 1,
        purchased_at: new Date(t0 + 10_000).toISOString(),
      }),
    ]);

    // Ticking again at the same second writes nothing twice.
    await engine.replayMatch(matchId);
    const events = (
      await http().get(`/api/v1/matches/${matchId}/events`).expect(200)
    ).body as {
      data: Array<{ event_type: string; occurred_at: string; details: object }>;
    };
    const seen = events.data.map((e) => `${e.event_type}@${e.occurred_at}`);
    expect(new Set(seen).size).toBe(seen.length);
    for (const event of events.data) {
      expect(new Date(event.occurred_at).getTime()).toBeLessThanOrEqual(
        t0 + 300_000,
      );
      expect(event.details).toEqual({ reconstructed: true });
    }
  });

  it('ends the game with the real winner and per-game statistics', async () => {
    at(DURATION + 2);
    await engine.replayMatch(matchId);
    const match = await detail();
    expect(match.status).toBe('live');
    expect([match.score_a, match.score_b]).toEqual([1, 0]);
    expect(match.games[0]).toMatchObject({
      status: 'completed',
      winner_team_id: teamIds[0],
      duration_seconds: DURATION,
    });

    const stats = (
      await http()
        .get(`/api/v1/matches/${matchId}/statistics?game_number=1`)
        .expect(200)
    ).body as { data: { players: Array<Record<string, unknown>> } };
    expect(stats.data.players).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          player_id: playerIds[0],
          kills: 5,
          gold: 9_000,
          mvp: true,
          items: [{ id: '2', name: 'Blade of Despair', icon_url: null }],
        }),
      ]),
    );
    const items = (
      await http()
        .get(`/api/v1/matches/${matchId}/equipment?game_number=1`)
        .expect(200)
    ).body as { data: Array<{ item_name: string }> };
    expect(items.data.map((row) => row.item_name)).toEqual([
      'Knife',
      'Blade of Despair',
    ]);
  });

  it('waits for the draft break, then plays the next game', async () => {
    at(DURATION + 60);
    await engine.replayMatch(matchId);
    expect((await detail()).games).toHaveLength(1);

    at(DURATION + BREAK_SECONDS + 1);
    await engine.replayMatch(matchId);
    expect((await detail()).game_number).toBe(2);
  });

  it('loops the series once a team has taken it, so it stays live', async () => {
    const game2Start = DURATION + BREAK_SECONDS + 1;
    at(game2Start + DURATION + 1);
    await engine.replayMatch(matchId);
    expect([(await detail()).score_a, (await detail()).score_b]).toEqual([
      2, 0,
    ]);

    at(game2Start + DURATION + BREAK_SECONDS + 2);
    await engine.replayMatch(matchId);
    const match = await detail();
    expect(match.status).toBe('live');
    expect([match.score_a, match.score_b]).toEqual([0, 0]);
    expect(match.games).toEqual([
      expect.objectContaining({ game_number: 1, status: 'live' }),
    ]);
    const stats = (
      await http()
        .get(`/api/v1/matches/${matchId}/statistics?game_number=1`)
        .expect(200)
    ).body as { data: { players: unknown[] } };
    expect(stats.data.players).toEqual([]);
  });

  it('keeps upcoming matches upcoming: one about to start moves a day later', async () => {
    at(0);
    await engine.rollCalendar();
    const row = await prisma.match.findUniqueOrThrow({
      where: { id: scheduledId },
    });
    expect(row.status).toBe('scheduled');
    expect(row.scheduled_at.getTime()).toBe(
      t0 + 10 * 60_000 + 24 * 60 * 60_000,
    );
  });
});
