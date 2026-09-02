import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { FavoritesService } from './favorites.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('FavoritesService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let favorites: FavoritesService;
  const userId = randomUUID();

  let teamAId: string;
  let teamBId: string;
  let playerId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    favorites = new FavoritesService(prisma);

    await prisma.profile.create({ data: { id: userId, role: 'user' } });
    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-fav-onic',
        name: 'E2E Fav ONIC',
        region: 'e2e-fav-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-fav-rrq',
        name: 'E2E Fav RRQ',
        region: 'e2e-fav-region',
      },
    });
    teamBId = teamB.id;
    const player = await prisma.player.create({
      data: {
        slug: 'e2e-fav-kairi',
        nickname: 'E2E Fav Kairi',
        role: 'jungle',
        team_id: teamAId,
      },
    });
    playerId = player.id;
  });

  afterAll(async () => {
    await prisma.favorite.deleteMany({ where: { user_id: userId } });
    await prisma.player.deleteMany({ where: { id: playerId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.profile.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it('adds a favorite and embeds the entity', async () => {
    const { data } = await favorites.add(userId, 'team', teamAId);
    expect(data.entity_type).toBe('team');
    expect(data.entity_id).toBe(teamAId);
    expect(data.entity).toMatchObject({
      id: teamAId,
      name: 'E2E Fav ONIC',
      slug: 'e2e-fav-onic',
    });
  });

  it('is idempotent when adding twice', async () => {
    await favorites.add(userId, 'team', teamAId);
    const rows = await prisma.favorite.count({
      where: { user_id: userId, entity_type: 'team', entity_id: teamAId },
    });
    expect(rows).toBe(1);
  });

  it('throws 404 when the entity does not exist', async () => {
    const missing = '00000000-0000-4000-8000-000000000000';
    await expect(favorites.add(userId, 'team', missing)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      favorites.add(userId, 'player', missing),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lists favorites newest first with embedded entities', async () => {
    await prisma.favorite.deleteMany({ where: { user_id: userId } });
    await favorites.add(userId, 'team', teamAId);
    await favorites.add(userId, 'player', playerId);
    await favorites.add(userId, 'team', teamBId);

    const { data } = await favorites.list(userId);
    expect(data).toHaveLength(3);
    expect(data[0]?.entity_id).toBe(teamBId); // added last
    expect(data[2]?.entity_id).toBe(teamAId); // added first

    const playerFavorite = data.find((f) => f.entity_type === 'player');
    expect(playerFavorite?.entity).toMatchObject({
      id: playerId,
      nickname: 'E2E Fav Kairi',
    });
    expect(
      data.every((f) => f.entity !== null && f.entity_type !== undefined),
    ).toBe(true);
  });

  it('returns a null entity for a dangling favorite', async () => {
    // remove teamA row after adding favorite to it, then delete the team
    await favorites.add(userId, 'team', teamAId);
    await prisma.team.delete({ where: { id: teamAId } });

    const { data } = await favorites.list(userId);
    const dangling = data.find(
      (f) => f.entity_type === 'team' && f.entity_id === teamAId,
    );
    expect(dangling?.entity).toBeNull();
  });

  it('removes favorites idempotently', async () => {
    await favorites.remove(userId, 'team', teamAId);
    await favorites.remove(userId, 'team', teamAId); // no error

    const rows = await prisma.favorite.count({
      where: { user_id: userId, entity_type: 'team', entity_id: teamAId },
    });
    expect(rows).toBe(0);
  });
});
