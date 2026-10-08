import { NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { AdminMatchesService } from './admin-matches.service';
import { MatchesService } from '../matches/matches.service';
import { PrismaService } from '../../prisma/prisma.service';
import { testEvents } from '../../infra/events/testing';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('AdminMatchesService live + statistics (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let adminMatches: AdminMatchesService;

  let teamAId: string;
  let teamBId: string;
  let player1Id: string;
  let player2Id: string;
  let matchId: string;
  const matchIds: string[] = [];

  beforeAll(async () => {
    prisma = new PrismaService();
    adminMatches = new AdminMatchesService(
      prisma,
      new MatchesService(prisma),
      testEvents(),
    );

    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-adminls-a', 'e2e-adminls-b'] } },
      select: { id: true },
    });
    const oldTeamIds = oldTeams.map((t) => t.id);
    if (oldTeamIds.length > 0) {
      await prisma.match.deleteMany({
        where: {
          OR: [
            { team_a_id: { in: oldTeamIds } },
            { team_b_id: { in: oldTeamIds } },
          ],
        },
      });
      await prisma.player.deleteMany({
        where: { team_id: { in: oldTeamIds } },
      });
      await prisma.team.deleteMany({ where: { id: { in: oldTeamIds } } });
    }

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-adminls-a',
        name: 'E2E AdminLS A',
        region: 'e2e-admin-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-adminls-b',
        name: 'E2E AdminLS B',
        region: 'e2e-admin-region',
      },
    });
    teamBId = teamB.id;
    const player1 = await prisma.player.create({
      data: {
        slug: 'e2e-adminls-p1',
        nickname: 'E2E AdminLS P1',
        role: 'gold',
        team_id: teamAId,
      },
    });
    player1Id = player1.id;
    const player2 = await prisma.player.create({
      data: {
        slug: 'e2e-adminls-p2',
        nickname: 'E2E AdminLS P2',
        role: 'mid',
        team_id: teamBId,
      },
    });
    player2Id = player2.id;

    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date('2026-09-05T12:00:00Z'),
      },
    });
    matchId = match.id;
    matchIds.push(matchId);
  });

  afterAll(async () => {
    await prisma.match.deleteMany({ where: { id: { in: matchIds } } });
    await prisma.player.deleteMany({
      where: { id: { in: [player1Id, player2Id] } },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.$disconnect();
  });

  describe('live endpoint', () => {
    it('goes live and sets started_at', async () => {
      const { data } = await adminMatches.setLive(matchId, {
        status: 'live',
        viewer_count: 1000,
      });
      expect(data.status).toBe('live');
      expect(data.viewer_count).toBe(1000);
      expect(data.started_at).not.toBeNull();
    });

    it('updates live scores without a transition', async () => {
      const { data } = await adminMatches.setLive(matchId, {
        score_a: 1,
        score_b: 0,
      });
      expect(data.status).toBe('live');
      expect(data.score_a).toBe(1);
      expect(data.score_b).toBe(0);
    });

    it('rejects viewer_count when not live', async () => {
      const other = await prisma.match.create({
        data: {
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'scheduled',
          scheduled_at: new Date('2026-09-06T12:00:00Z'),
        },
      });
      matchIds.push(other.id);

      await expect(
        adminMatches.setLive(other.id, { viewer_count: 10 }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('completes the match with scores and sets ended_at', async () => {
      const { data } = await adminMatches.setLive(matchId, {
        status: 'completed',
        score_a: 2,
        score_b: 1,
        winner_team_id: teamAId,
      });
      expect(data.status).toBe('completed');
      expect(data.winner_team_id).toBe(teamAId);
      expect(data.ended_at).not.toBeNull();
    });

    it('rejects completing without scores', async () => {
      const other = await prisma.match.create({
        data: {
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'live',
          started_at: new Date('2026-09-06T13:00:00Z'),
          scheduled_at: new Date('2026-09-06T12:00:00Z'),
        },
      });
      matchIds.push(other.id);

      await expect(
        adminMatches.setLive(other.id, { status: 'completed' }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejects invalid transitions', async () => {
      await expect(
        adminMatches.setLive(matchId, { status: 'live' }),
      ).rejects.toBeInstanceOf(BusinessRuleException); // completed -> live
    });

    it('throws 404 for an unknown match', async () => {
      await expect(
        adminMatches.setLive('00000000-0000-4000-8000-000000000000', {
          status: 'live',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('statistics endpoint', () => {
    it('upserts team and player statistics atomically', async () => {
      const target = await prisma.match.create({
        data: {
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'completed',
          score_a: 2,
          score_b: 1,
          winner_team_id: teamAId,
          scheduled_at: new Date('2026-09-07T12:00:00Z'),
          ended_at: new Date('2026-09-07T13:00:00Z'),
        },
      });
      matchIds.push(target.id);

      const { data } = await adminMatches.upsertStatistics(target.id, {
        teams: [
          {
            team_id: teamAId,
            kills: 12,
            deaths: 8,
            assists: 24,
            gold: 45000,
            towers_destroyed: 7,
            game_duration_seconds: 1180,
          },
          {
            team_id: teamBId,
            kills: 9,
            deaths: 12,
            assists: 18,
            gold: 40000,
          },
        ],
        players: [
          {
            player_id: player1Id,
            team_id: teamAId,
            kills: 6,
            deaths: 1,
            assists: 7,
            gold: 9800,
            hero_picked: 'Ling',
            mvp: true,
          },
          {
            player_id: player2Id,
            team_id: teamBId,
            kills: 5,
            deaths: 2,
            assists: 6,
            gold: 8400,
            hero_picked: 'Kagura',
          },
        ],
      });

      expect(data.match_id).toBe(target.id);
      expect(data.teams).toHaveLength(2);
      expect(data.players).toHaveLength(2);
      const teamA = data.teams.find((t) => t.team_id === teamAId);
      expect(teamA).toMatchObject({
        kills: 12,
        gold: 45000,
        towers_destroyed: 7,
        game_duration_seconds: 1180,
      });
      expect(teamA?.team).toMatchObject({ name: 'E2E AdminLS A' });
      const p1 = data.players.find((p) => p.player_id === player1Id);
      expect(p1).toMatchObject({
        hero_picked: 'Ling',
        mvp: true,
        kills: 6,
      });
    });

    it('replaces per-key on resubmission without duplicating rows', async () => {
      const target = await prisma.match.create({
        data: {
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'scheduled',
          scheduled_at: new Date('2026-09-08T12:00:00Z'),
        },
      });
      matchIds.push(target.id);

      await adminMatches.upsertStatistics(target.id, {
        teams: [{ team_id: teamAId, kills: 1, gold: 100 }],
        players: [
          { player_id: player1Id, team_id: teamAId, kills: 2, gold: 200 },
        ],
      });
      await adminMatches.upsertStatistics(target.id, {
        teams: [{ team_id: teamAId, kills: 3, gold: 300 }],
        players: [
          { player_id: player1Id, team_id: teamAId, kills: 4, gold: 400 },
        ],
      });

      const teamRows = await prisma.matchTeamStatistic.findMany({
        where: { match_id: target.id },
      });
      const playerRows = await prisma.playerMatchStatistic.findMany({
        where: { match_id: target.id },
      });
      expect(teamRows).toHaveLength(1);
      expect(teamRows[0]?.kills).toBe(3);
      expect(teamRows[0]?.gold).toBe(300);
      expect(playerRows).toHaveLength(1);
      expect(playerRows[0]?.kills).toBe(4);
      expect(playerRows[0]?.gold).toBe(400);
    });

    it('rejects a team that is not part of the match', async () => {
      const target = await prisma.match.create({
        data: {
          team_a_id: teamAId,
          team_b_id: teamBId,
          status: 'scheduled',
          scheduled_at: new Date('2026-09-09T12:00:00Z'),
        },
      });
      matchIds.push(target.id);

      await expect(
        adminMatches.upsertStatistics(target.id, {
          teams: [
            {
              team_id: '00000000-0000-4000-8000-000000000000',
              kills: 1,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);

      await expect(
        adminMatches.upsertStatistics(target.id, {
          players: [
            {
              player_id: player1Id,
              team_id: '00000000-0000-4000-8000-000000000000',
            },
          ],
        }),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejects unknown players with 404', async () => {
      await expect(
        adminMatches.upsertStatistics(matchId, {
          players: [
            {
              player_id: '00000000-0000-4000-8000-000000000000',
              team_id: teamAId,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws 404 for an unknown match', async () => {
      await expect(
        adminMatches.upsertStatistics('00000000-0000-4000-8000-000000000000', {
          teams: [{ team_id: teamAId }],
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('live-stats endpoint', () => {
    it('appends snapshots ordered asc', async () => {
      const { data } = await adminMatches.upsertLiveStats(matchId, [
        {
          player_id: player1Id,
          team_id: teamAId,
          kills: 2,
          gold: 5000,
          damage: 10000,
          damage_taken: 3000,
          level: 6,
          recorded_at: '2026-09-05T12:05:00Z',
        },
        {
          player_id: player1Id,
          team_id: teamAId,
          kills: 3,
          gold: 6000,
          damage: 14000,
          damage_taken: 4000,
          level: 7,
          recorded_at: '2026-09-05T12:10:00Z',
        },
      ]);

      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({ kills: 2, level: 6, gold: 5000 });
      expect(data[1]).toMatchObject({ kills: 3, level: 7 });
    });

    it('ignores duplicate snapshots (same match, player, timestamp)', async () => {
      await adminMatches.upsertLiveStats(matchId, [
        {
          player_id: player1Id,
          team_id: teamAId,
          kills: 999,
          recorded_at: '2026-09-05T12:05:00Z',
        },
      ]);

      const rows = await prisma.playerMatchSnapshot.findMany({
        where: {
          match_id: matchId,
          player_id: player1Id,
          recorded_at: new Date('2026-09-05T12:05:00Z'),
        },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]?.kills).toBe(2); // first write wins
    });

    it('rejects a team that is not part of the match', async () => {
      await expect(
        adminMatches.upsertLiveStats(matchId, [
          {
            player_id: player1Id,
            team_id: '00000000-0000-4000-8000-000000000000',
          },
        ]),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejects unknown players with 404', async () => {
      await expect(
        adminMatches.upsertLiveStats(matchId, [
          {
            player_id: '00000000-0000-4000-8000-000000000000',
            team_id: teamAId,
          },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('equipment endpoint', () => {
    it('appends purchases ordered asc', async () => {
      const { data } = await adminMatches.upsertEquipment(matchId, [
        {
          player_id: player1Id,
          team_id: teamAId,
          item_id: 'fury-hammer',
          item_name: 'Fury Hammer',
          phase: 'phase2',
          purchased_at: '2026-09-05T12:03:00Z',
        },
        {
          player_id: player1Id,
          team_id: teamAId,
          item_id: 'war-axe',
          item_name: 'War Axe',
          phase: 'phase3',
          slot: 1,
          purchased_at: '2026-09-05T12:09:00Z',
        },
      ]);

      expect(data).toHaveLength(2);
      expect(data[0]).toMatchObject({
        item_name: 'Fury Hammer',
        phase: 'phase2',
      });
      expect(data[1]).toMatchObject({
        item_name: 'War Axe',
        phase: 'phase3',
        slot: 1,
      });
    });

    it('ignores duplicate purchases (same match, player, item, timestamp)', async () => {
      await adminMatches.upsertEquipment(matchId, [
        {
          player_id: player1Id,
          team_id: teamAId,
          item_id: 'fury-hammer',
          item_name: 'Fury Hammer',
          phase: 'phase2',
          purchased_at: '2026-09-05T12:03:00Z',
        },
      ]);

      const rows = await prisma.matchItemEvent.findMany({
        where: {
          match_id: matchId,
          player_id: player1Id,
          item_name: 'Fury Hammer',
          purchased_at: new Date('2026-09-05T12:03:00Z'),
        },
      });
      expect(rows).toHaveLength(1);
    });

    it('rejects a team that is not part of the match', async () => {
      await expect(
        adminMatches.upsertEquipment(matchId, [
          {
            player_id: player1Id,
            team_id: '00000000-0000-4000-8000-000000000000',
            item_id: 'x',
            item_name: 'X',
            phase: 'phase2',
          },
        ]),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejects unknown players with 404', async () => {
      await expect(
        adminMatches.upsertEquipment(matchId, [
          {
            player_id: '00000000-0000-4000-8000-000000000000',
            team_id: teamAId,
            item_id: 'x',
            item_name: 'X',
            phase: 'phase2',
          },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('events endpoint', () => {
    it('appends events ordered asc', async () => {
      const { data } = await adminMatches.upsertEvents(matchId, [
        {
          team_id: teamAId,
          player_id: player1Id,
          event_type: 'first_blood',
          title: 'First blood for E2E AdminLS P1',
          occurred_at: '2026-09-05T12:04:00Z',
        },
        {
          team_id: teamAId,
          event_type: 'lord',
          title: 'E2E AdminLS A secured the Lord',
          occurred_at: '2026-09-05T12:20:00Z',
        },
      ]);

      const first = data.find((e) => e.event_type === 'first_blood');
      expect(first).toMatchObject({
        team_id: teamAId,
        player_id: player1Id,
        title: 'First blood for E2E AdminLS P1',
      });
      const lord = data.find((e) => e.event_type === 'lord');
      expect(lord).toMatchObject({ player_id: null });
      expect(new Date(String(first?.occurred_at)).getTime()).toBeLessThan(
        new Date(String(lord?.occurred_at)).getTime(),
      );
    });

    it('rejects a team that is not part of the match', async () => {
      await expect(
        adminMatches.upsertEvents(matchId, [
          {
            team_id: '00000000-0000-4000-8000-000000000000',
            event_type: 'tower',
            title: 'Tower destroyed',
          },
        ]),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('rejects unknown players with 404', async () => {
      await expect(
        adminMatches.upsertEvents(matchId, [
          {
            player_id: '00000000-0000-4000-8000-000000000000',
            team_id: teamAId,
            event_type: 'kill',
            title: 'Kill',
          },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('broadcasts endpoint', () => {
    it('replaces the variant set and orders by viewer_count desc', async () => {
      const { data } = await adminMatches.upsertBroadcasts(matchId, [
        {
          language: 'en',
          stream_url: 'https://e2e.example.com/b-en.m3u8',
          viewer_count: 900,
        },
        { language: 'id', stream_url: 'https://e2e.example.com/b-id.m3u8' },
      ]);
      expect(data).toHaveLength(2);
      expect(data[0]).toEqual({
        language: 'en',
        stream_url: 'https://e2e.example.com/b-en.m3u8',
        viewer_count: 900,
      });
      expect(data[1]).toEqual({
        language: 'id',
        stream_url: 'https://e2e.example.com/b-id.m3u8',
        viewer_count: 0,
      });
    });

    it('is idempotent for an identical submission', async () => {
      await adminMatches.upsertBroadcasts(matchId, [
        {
          language: 'en',
          stream_url: 'https://e2e.example.com/b-en.m3u8',
          viewer_count: 900,
        },
      ]);
      const { data } = await adminMatches.upsertBroadcasts(matchId, [
        {
          language: 'en',
          stream_url: 'https://e2e.example.com/b-en.m3u8',
          viewer_count: 900,
        },
      ]);
      expect(data).toHaveLength(1);
      expect(data[0]).toEqual({
        language: 'en',
        stream_url: 'https://e2e.example.com/b-en.m3u8',
        viewer_count: 900,
      });
    });

    it('clears all variants with an empty list', async () => {
      const { data } = await adminMatches.upsertBroadcasts(matchId, []);
      expect(data).toEqual([]);
    });

    it('rejects duplicate languages for the same match', async () => {
      await expect(
        adminMatches.upsertBroadcasts(matchId, [
          { language: 'en', stream_url: 'https://e2e.example.com/x.m3u8' },
          { language: 'en', stream_url: 'https://e2e.example.com/y.m3u8' },
        ]),
      ).rejects.toBeInstanceOf(BusinessRuleException);
    });

    it('throws 404 for an unknown match', async () => {
      await expect(
        adminMatches.upsertBroadcasts('00000000-0000-4000-8000-000000000000', [
          { language: 'en', stream_url: 'https://e2e.example.com/z.m3u8' },
        ]),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
