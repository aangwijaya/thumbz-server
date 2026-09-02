import { NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { AdminTournamentsService } from './admin-tournaments.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('AdminTournamentsService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let adminTournaments: AdminTournamentsService;

  const base = {
    slug: 'e2e-admin-tour',
    name: 'E2E Admin Tour',
    status: 'upcoming' as const,
    region: 'e2e-admin-region',
    start_date: '2026-09-01',
    end_date: '2026-09-30',
  };

  beforeAll(() => {
    prisma = new PrismaService();
    adminTournaments = new AdminTournamentsService(prisma);
  });

  afterAll(async () => {
    await prisma.tournament.deleteMany({
      where: { slug: { in: ['e2e-admin-tour', 'e2e-admin-tour-2'] } },
    });
    await prisma.$disconnect();
  });

  it('creates a tournament and returns the summary', async () => {
    const { data } = await adminTournaments.create({
      ...base,
      prize_pool: '100000 USD',
      logo_url: 'https://example.com/logo.png',
      featured: true,
    });

    expect(data.slug).toBe('e2e-admin-tour');
    expect(data.status).toBe('upcoming');
    expect(data.start_date).toBe('2026-09-01');
    expect(data.logo_url).toBe('https://example.com/logo.png');
    expect(data.featured).toBe(true);
  });

  it('rejects a duplicate slug with P2002', async () => {
    await expect(
      adminTournaments.create({ ...base, slug: 'e2e-admin-tour-2' }),
    ).resolves.toBeDefined();
    await expect(
      adminTournaments.create({ ...base, slug: 'e2e-admin-tour-2' }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('updates only the provided fields', async () => {
    const { data } = await adminTournaments.update(
      (
        await prisma.tournament.findUniqueOrThrow({
          where: { slug: 'e2e-admin-tour' },
        })
      ).id,
      { name: 'E2E Admin Tour Renamed', featured: false },
    );

    expect(data.name).toBe('E2E Admin Tour Renamed');
    expect(data.featured).toBe(false);
    expect(data.status).toBe('upcoming'); // untouched
    expect(data.prize_pool).toBe('100000 USD'); // untouched
  });

  it('clears a nullable field when null is provided', async () => {
    const id = (
      await prisma.tournament.findUniqueOrThrow({
        where: { slug: 'e2e-admin-tour' },
      })
    ).id;
    const { data } = await adminTournaments.update(id, { prize_pool: null });
    expect(data.prize_pool).toBeNull();
  });

  it('throws 404 when updating a missing tournament', async () => {
    await expect(
      adminTournaments.update('00000000-0000-4000-8000-000000000000', {
        name: 'X',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('protects tournaments with matches from deletion (422)', async () => {
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: 'e2e-admin-tour' },
    });
    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-admin-ta',
        name: 'E2E Admin TA',
        region: 'e2e-admin-region',
      },
    });
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-admin-tb',
        name: 'E2E Admin TB',
        region: 'e2e-admin-region',
      },
    });
    const match = await prisma.match.create({
      data: {
        tournament_id: tournament.id,
        team_a_id: teamA.id,
        team_b_id: teamB.id,
        status: 'scheduled',
        scheduled_at: new Date('2026-09-05T10:00:00Z'),
      },
    });

    await expect(adminTournaments.remove(tournament.id)).rejects.toBeInstanceOf(
      BusinessRuleException,
    );

    await prisma.match.delete({ where: { id: match.id } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamA.id, teamB.id] } },
    });
  });

  it('deletes a tournament without matches', async () => {
    const tournament = await prisma.tournament.findUniqueOrThrow({
      where: { slug: 'e2e-admin-tour' },
    });
    await adminTournaments.remove(tournament.id);

    const remaining = await prisma.tournament.count({
      where: { slug: 'e2e-admin-tour' },
    });
    expect(remaining).toBe(0);
  });

  it('throws 404 when deleting a missing tournament', async () => {
    await expect(
      adminTournaments.remove('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
