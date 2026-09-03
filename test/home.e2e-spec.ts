import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Home (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const now = Date.now();
  const hour = 3_600_000;
  const day = 24 * hour;

  let tournamentId: string;
  let team1Id: string;
  let team2Id: string;
  let teamOldId: string;
  let team3Id: string;
  let featuredLiveId: string;
  let live2Id: string;
  const idsToClean: string[] = [];

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
        slug: 'e2e-home-tour',
        name: 'E2E Home Cup',
        status: 'ongoing',
        region: 'e2e-home-region',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
        featured: true,
      },
    });
    tournamentId = tournament.id;

    const team1 = await prisma.team.create({
      data: {
        slug: 'e2e-home-t1',
        name: 'E2E Home T1',
        region: 'e2e-home-region',
      },
    });
    team1Id = team1.id;
    const team2 = await prisma.team.create({
      data: {
        slug: 'e2e-home-t2',
        name: 'E2E Home T2',
        region: 'e2e-home-region',
      },
    });
    team2Id = team2.id;
    const teamOld = await prisma.team.create({
      data: {
        slug: 'e2e-home-told',
        name: 'E2E Home TOld',
        region: 'e2e-home-region',
      },
    });
    teamOldId = teamOld.id;
    const team3 = await prisma.team.create({
      data: {
        slug: 'e2e-home-t3',
        name: 'E2E Home T3',
        region: 'e2e-home-region',
      },
    });
    team3Id = team3.id;

    const featured = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: team1Id,
        team_b_id: team2Id,
        status: 'live',
        featured: true,
        viewer_count: 1000,
        scheduled_at: new Date(now - hour),
        started_at: new Date(now - 30 * 60_000),
      },
    });
    featuredLiveId = featured.id;
    idsToClean.push(featuredLiveId);

    const live2 = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: team2Id,
        team_b_id: team1Id,
        status: 'live',
        viewer_count: 500,
        scheduled_at: new Date(now - 2 * hour),
        started_at: new Date(now - 60 * 60_000),
      },
    });
    live2Id = live2.id;
    idsToClean.push(live2Id);

    // popular teams: "most completed matches played in the last 90 days".
    // The seeded MPL ID league now saturates the top 8 (leaders ~18 played),
    // so fixture teams must exceed that: team1 plays 22, team2 19 (each above
    // any seeded team), with team1 strictly ahead of team2 via extra matches
    // against a third team. team3 stays far below the threshold.
    for (let i = 0; i < 16; i++) {
      const m = await prisma.match.create({
        data: {
          tournament_id: tournamentId,
          team_a_id: team1Id,
          team_b_id: team2Id,
          status: 'completed',
          winner_team_id: team1Id,
          scheduled_at: new Date(now - (i + 1) * day),
          ended_at: new Date(now - (i + 1) * day + hour),
        },
      });
      idsToClean.push(m.id);
    }
    for (let i = 0; i < 2; i++) {
      const m = await prisma.match.create({
        data: {
          tournament_id: tournamentId,
          team_a_id: team1Id,
          team_b_id: team2Id,
          status: 'completed',
          winner_team_id: team2Id,
          scheduled_at: new Date(now - (i + 20) * day),
          ended_at: new Date(now - (i + 20) * day + hour),
        },
      });
      idsToClean.push(m.id);
    }
    for (let i = 0; i < 4; i++) {
      const m = await prisma.match.create({
        data: {
          tournament_id: tournamentId,
          team_a_id: team1Id,
          team_b_id: team3Id,
          status: 'completed',
          winner_team_id: team1Id,
          scheduled_at: new Date(now - (i + 24) * day),
          ended_at: new Date(now - (i + 24) * day + hour),
        },
      });
      idsToClean.push(m.id);
    }
    const t2v3 = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: team2Id,
        team_b_id: team3Id,
        status: 'completed',
        winner_team_id: team2Id,
        scheduled_at: new Date(now - 30 * day),
        ended_at: new Date(now - 30 * day + hour),
      },
    });
    idsToClean.push(t2v3.id);

    // teamOld played 6 completed matches but all older than 90 days
    for (let i = 0; i < 6; i++) {
      const m = await prisma.match.create({
        data: {
          team_a_id: teamOldId,
          team_b_id: team2Id,
          status: 'completed',
          winner_team_id: teamOldId,
          scheduled_at: new Date(now - (100 + i) * day),
          ended_at: new Date(now - (100 + i) * day + hour),
        },
      });
      idsToClean.push(m.id);
    }

    const upcoming1 = await prisma.match.create({
      data: {
        tournament_id: tournamentId,
        team_a_id: team1Id,
        team_b_id: team2Id,
        status: 'scheduled',
        scheduled_at: new Date(now + day),
      },
    });
    idsToClean.push(upcoming1.id);
    const upcoming2 = await prisma.match.create({
      data: {
        team_a_id: team2Id,
        team_b_id: team1Id,
        status: 'scheduled',
        scheduled_at: new Date(now + 2 * day),
      },
    });
    idsToClean.push(upcoming2.id);

    const v1 = await prisma.video.create({
      data: {
        title: 'E2E Home Replay One',
        type: 'replay',
        url: 'https://example.com/home-1',
        published_at: new Date(now - hour),
      },
    });
    idsToClean.push(v1.id);
    const v2 = await prisma.video.create({
      data: {
        title: 'E2E Home Replay Two',
        type: 'highlight',
        url: 'https://example.com/home-2',
        published_at: new Date(now - 2 * hour),
      },
    });
    idsToClean.push(v2.id);
  });

  afterAll(async () => {
    await prisma.video.deleteMany({ where: { id: { in: idsToClean } } });
    await prisma.match.deleteMany({ where: { id: { in: idsToClean } } });
    await prisma.team.deleteMany({
      where: { id: { in: [team1Id, team2Id, teamOldId, team3Id] } },
    });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    await app.close();
  });

  it('aggregates all sections for anonymous users', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/home')
      .expect(200);

    const body = response.body as {
      data: {
        featured_live_match: {
          id: string;
          status: string;
          featured: boolean;
        } | null;
        live_now: Array<{ id: string }>;
        upcoming: Array<{ id: string }>;
        featured_tournaments: Array<{ id: string }>;
        popular_teams: Array<{ id: string }>;
        latest_videos: Array<{ id: string }>;
        continue_watching: unknown[];
      };
    };
    // other specs may also create featured live matches concurrently, so the
    // featured pick is not necessarily ours - it must simply be live+featured
    expect(body.data.featured_live_match?.status).toBe('live');
    expect(body.data.featured_live_match?.featured).toBe(true);

    const liveIds = body.data.live_now.map((m) => m.id);
    expect(liveIds).toContain(featuredLiveId);
    expect(liveIds).toContain(live2Id);
    // ordered by viewer_count desc
    expect(liveIds.indexOf(featuredLiveId)).toBeLessThan(
      liveIds.indexOf(live2Id),
    );

    const upcomingIds = body.data.upcoming.map((m) => m.id);
    expect(upcomingIds.length).toBeGreaterThanOrEqual(2);
    expect(body.data.featured_tournaments.map((t) => t.id)).toContain(
      tournamentId,
    );

    const popularIds = body.data.popular_teams.map((t) => t.id);
    expect(popularIds.length).toBeLessThanOrEqual(8);
    // team1 (5) ranks before team2 (2)
    expect(popularIds.indexOf(team1Id)).toBeGreaterThanOrEqual(0);
    expect(popularIds.indexOf(team1Id)).toBeLessThan(
      popularIds.indexOf(team2Id),
    );
    // teamOld only has matches older than 90 days -> excluded
    expect(popularIds).not.toContain(teamOldId);

    const videoIds = body.data.latest_videos.map((v) => v.id);
    expect(videoIds.length).toBeLessThanOrEqual(12);

    expect(body.data.continue_watching).toEqual([]);
  });

  it('stays anonymous with an invalid token', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/home')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(200);
    const body = response.body as { data: { continue_watching: unknown[] } };
    expect(body.data.continue_watching).toEqual([]);
  });
});
