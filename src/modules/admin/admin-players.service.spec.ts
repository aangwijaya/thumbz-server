import { NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { AdminPlayersService } from './admin-players.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('AdminPlayersService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let adminPlayers: AdminPlayersService;

  let teamId: string;
  let opponentId: string;
  let matchId: string;

  const base = {
    slug: 'e2e-admin-player',
    nickname: 'E2E Admin Player',
    role: 'jungle' as const,
  };

  beforeAll(async () => {
    prisma = new PrismaService();
    adminPlayers = new AdminPlayersService(prisma);

    // clean leftovers from interrupted runs (stats rows block player deletes)
    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-adminp-t', 'e2e-adminp-o'] } },
      select: { id: true },
    });
    const oldTeamIds = oldTeams.map((t) => t.id);
    if (oldTeamIds.length > 0) {
      const oldPlayers = await prisma.player.findMany({
        where: { team_id: { in: oldTeamIds } },
        select: { id: true },
      });
      const oldPlayerIds = oldPlayers.map((p) => p.id);
      if (oldPlayerIds.length > 0) {
        await prisma.playerMatchStatistic.deleteMany({
          where: { player_id: { in: oldPlayerIds } },
        });
        await prisma.player.deleteMany({
          where: { id: { in: oldPlayerIds } },
        });
      }
      await prisma.match.deleteMany({
        where: {
          OR: [
            { team_a_id: { in: oldTeamIds } },
            { team_b_id: { in: oldTeamIds } },
          ],
        },
      });
      await prisma.team.deleteMany({ where: { id: { in: oldTeamIds } } });
    }

    const team = await prisma.team.create({
      data: {
        slug: 'e2e-adminp-t',
        name: 'E2E AdminP T',
        region: 'e2e-admin-region',
      },
    });
    teamId = team.id;
    const opponent = await prisma.team.create({
      data: {
        slug: 'e2e-adminp-o',
        name: 'E2E AdminP O',
        region: 'e2e-admin-region',
      },
    });
    opponentId = opponent.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamId,
        team_b_id: opponentId,
        status: 'scheduled',
        scheduled_at: new Date('2026-09-05T10:00:00Z'),
      },
    });
    matchId = match.id;
  });

  afterAll(async () => {
    const players = await prisma.player.findMany({
      where: { slug: { in: ['e2e-admin-player', 'e2e-admin-player-2'] } },
      select: { id: true },
    });
    const playerIds = players.map((p) => p.id);
    if (playerIds.length > 0) {
      await prisma.playerMatchStatistic.deleteMany({
        where: { player_id: { in: playerIds } },
      });
      await prisma.player.deleteMany({ where: { id: { in: playerIds } } });
    }
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamId, opponentId] } },
    });
    await prisma.$disconnect();
  });

  it('creates a player with team and returns the summary', async () => {
    const { data } = await adminPlayers.create({
      ...base,
      team_id: teamId,
      country: 'Philippines',
    });
    expect(data.slug).toBe('e2e-admin-player');
    expect(data.role).toBe('jungle');
    expect(data.team?.id).toBe(teamId);
    expect(data.is_active).toBe(true);
  });

  it('rejects a duplicate slug with P2002', async () => {
    await expect(
      adminPlayers.create({ ...base, slug: 'e2e-admin-player-2' }),
    ).resolves.toBeDefined();
    await expect(
      adminPlayers.create({ ...base, slug: 'e2e-admin-player-2' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('throws 404 when the team does not exist', async () => {
    await expect(
      adminPlayers.create({
        ...base,
        slug: 'e2e-admin-player-3',
        team_id: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only the provided fields and clears team with null', async () => {
    const id = (
      await prisma.player.findUniqueOrThrow({
        where: { slug: 'e2e-admin-player' },
      })
    ).id;

    const { data } = await adminPlayers.update(id, {
      nickname: 'E2E Admin Player Renamed',
      team_id: null,
    });
    expect(data.nickname).toBe('E2E Admin Player Renamed');
    expect(data.team).toBeNull();
    expect(data.role).toBe('jungle'); // untouched

    await adminPlayers.update(id, { team_id: teamId });
  });

  it('throws 404 when updating a missing player', async () => {
    await expect(
      adminPlayers.update('00000000-0000-4000-8000-000000000000', {
        nickname: 'X',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('protects players with match statistics from deletion (422)', async () => {
    const player = await prisma.player.findUniqueOrThrow({
      where: { slug: 'e2e-admin-player' },
    });
    await prisma.playerMatchStatistic.create({
      data: {
        match_id: matchId,
        player_id: player.id,
        team_id: teamId,
        kills: 1,
      },
    });

    await expect(adminPlayers.remove(player.id)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );
  });

  it('deletes a player without statistics', async () => {
    const player = await prisma.player.findUniqueOrThrow({
      where: { slug: 'e2e-admin-player-2' },
    });
    await adminPlayers.remove(player.id);

    const remaining = await prisma.player.count({
      where: { slug: 'e2e-admin-player-2' },
    });
    expect(remaining).toBe(0);
  });

  it('throws 404 when deleting a missing player', async () => {
    await expect(
      adminPlayers.remove('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
