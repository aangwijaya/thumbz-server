import { NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { AdminTeamsService } from './admin-teams.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('AdminTeamsService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let adminTeams: AdminTeamsService;

  const base = {
    slug: 'e2e-admin-team',
    name: 'E2E Admin Team',
    region: 'e2e-admin-region',
    color_primary: '#FFD700',
  };

  beforeAll(() => {
    prisma = new PrismaService();
    adminTeams = new AdminTeamsService(prisma);
  });

  afterAll(async () => {
    await prisma.team.deleteMany({
      where: { slug: { in: ['e2e-admin-team', 'e2e-admin-team-2'] } },
    });
    await prisma.$disconnect();
  });

  it('creates a team and returns the summary', async () => {
    const { data } = await adminTeams.create({
      ...base,
      founded_year: 2018,
      is_active: true,
    });
    expect(data.slug).toBe('e2e-admin-team');
    expect(data.color_primary).toBe('#FFD700');
    expect(data.is_active).toBe(true);

    // founded_year is part of TeamDetail, not TeamSummary - check the row
    const row = await prisma.team.findUniqueOrThrow({
      where: { slug: 'e2e-admin-team' },
    });
    expect(row.founded_year).toBe(2018);
  });

  it('rejects a duplicate slug with P2002', async () => {
    await expect(
      adminTeams.create({ ...base, slug: 'e2e-admin-team-2' }),
    ).resolves.toBeDefined();
    await expect(
      adminTeams.create({ ...base, slug: 'e2e-admin-team-2' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('updates only the provided fields', async () => {
    const id = (
      await prisma.team.findUniqueOrThrow({
        where: { slug: 'e2e-admin-team' },
      })
    ).id;
    const { data } = await adminTeams.update(id, {
      name: 'E2E Admin Team Renamed',
      is_active: false,
    });

    expect(data.name).toBe('E2E Admin Team Renamed');
    expect(data.is_active).toBe(false);
    expect(data.color_primary).toBe('#FFD700'); // untouched

    const row = await prisma.team.findUniqueOrThrow({ where: { id } });
    expect(row.founded_year).toBe(2018); // untouched
  });

  it('clears a nullable field when null is provided', async () => {
    const id = (
      await prisma.team.findUniqueOrThrow({
        where: { slug: 'e2e-admin-team' },
      })
    ).id;
    const { data } = await adminTeams.update(id, { color_primary: null });
    expect(data.color_primary).toBeNull();
  });

  it('throws 404 when updating a missing team', async () => {
    await expect(
      adminTeams.update('00000000-0000-4000-8000-000000000000', { name: 'X' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('protects teams with players from deletion (422)', async () => {
    const team = await prisma.team.findUniqueOrThrow({
      where: { slug: 'e2e-admin-team' },
    });
    const player = await prisma.player.create({
      data: {
        slug: 'e2e-adminteams-player',
        nickname: 'E2E Admin Player',
        role: 'gold',
        team_id: team.id,
      },
    });

    await expect(adminTeams.remove(team.id)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );

    await prisma.player.delete({ where: { id: player.id } });
  });

  it('protects teams with matches from deletion (422)', async () => {
    const team = await prisma.team.findUniqueOrThrow({
      where: { slug: 'e2e-admin-team' },
    });
    const opponent = await prisma.team.create({
      data: {
        slug: 'e2e-admin-team-opp',
        name: 'E2E Admin Team Opp',
        region: 'e2e-admin-region',
      },
    });
    const match = await prisma.match.create({
      data: {
        team_a_id: team.id,
        team_b_id: opponent.id,
        status: 'scheduled',
        scheduled_at: new Date('2026-09-05T10:00:00Z'),
      },
    });

    await expect(adminTeams.remove(team.id)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );

    await prisma.match.delete({ where: { id: match.id } });
    await prisma.team.delete({ where: { id: opponent.id } });
  });

  it('deletes a team without dependencies', async () => {
    const team = await prisma.team.findUniqueOrThrow({
      where: { slug: 'e2e-admin-team' },
    });
    await adminTeams.remove(team.id);

    const remaining = await prisma.team.count({
      where: { slug: 'e2e-admin-team' },
    });
    expect(remaining).toBe(0);
  });

  it('throws 404 when deleting a missing team', async () => {
    await expect(
      adminTeams.remove('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
