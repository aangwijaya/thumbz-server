import { NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { AdminMatchesService } from './admin-matches.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('AdminMatchesService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let adminMatches: AdminMatchesService;

  let teamAId: string;
  let teamBId: string;
  let tournamentId: string;

  const scheduledAt = '2026-09-05T12:00:00Z';

  beforeAll(async () => {
    prisma = new PrismaService();
    adminMatches = new AdminMatchesService(prisma);

    // clean leftovers from interrupted runs
    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-adminm-a', 'e2e-adminm-b'] } },
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
      await prisma.team.deleteMany({ where: { id: { in: oldTeamIds } } });
    }
    await prisma.tournament.deleteMany({
      where: { slug: 'e2e-adminm-tour' },
    });

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-adminm-a',
        name: 'E2E AdminM A',
        region: 'e2e-admin-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-adminm-b',
        name: 'E2E AdminM B',
        region: 'e2e-admin-region',
      },
    });
    teamBId = teamB.id;
    const tournament = await prisma.tournament.create({
      data: {
        slug: 'e2e-adminm-tour',
        name: 'E2E AdminM Tour',
        status: 'ongoing',
        region: 'e2e-admin-region',
        start_date: new Date('2026-08-01'),
        end_date: new Date('2026-10-30'),
      },
    });
    tournamentId = tournament.id;
  });

  afterAll(async () => {
    await prisma.match.deleteMany({
      where: {
        OR: [
          { team_a_id: { in: [teamAId, teamBId] } },
          { team_b_id: { in: [teamAId, teamBId] } },
        ],
      },
    });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.tournament.delete({ where: { id: tournamentId } });
    await prisma.$disconnect();
  });

  const base = () => ({
    team_a_id: teamAId,
    team_b_id: teamBId,
    scheduled_at: scheduledAt,
  });

  it('creates a scheduled match with defaults', async () => {
    const { data } = await adminMatches.create({
      ...base(),
      tournament_id: tournamentId,
      stage: 'group_stage',
    });
    expect(data.status).toBe('scheduled');
    expect(data.best_of).toBe(1);
    expect(data.stage).toBe('group_stage');
    expect(data.tournament_id).toBe(tournamentId);
    expect(data.team_a.id).toBe(teamAId);

    // cleanup for later isolated tests
    await prisma.match.delete({ where: { id: data.id } });
  });

  it('rejects creating a match with the same team on both sides', async () => {
    await expect(
      adminMatches.create({
        ...base(),
        team_b_id: teamAId,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('rejects creating a match directly as live', async () => {
    await expect(
      adminMatches.create({ ...base(), status: 'live' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('rejects creating a completed match without winner data', async () => {
    await expect(
      adminMatches.create({
        ...base(),
        status: 'completed',
        score_a: 2,
        score_b: 1,
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('creates a completed match with consistent scores', async () => {
    const { data } = await adminMatches.create({
      ...base(),
      status: 'completed',
      score_a: 2,
      score_b: 1,
      winner_team_id: teamAId,
      ended_at: '2026-09-05T13:30:00Z',
    });
    expect(data.status).toBe('completed');
    expect(data.winner_team_id).toBe(teamAId);
  });

  it('rejects unknown teams and tournaments with 404', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    await expect(
      adminMatches.create({ ...base(), team_b_id: unknown }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      adminMatches.create({ ...base(), tournament_id: unknown }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('allows scheduled -> live -> completed transitions', async () => {
    const created = await prisma.match.create({
      data: { ...base(), status: 'scheduled' },
    });

    const live = await adminMatches.update(created.id, { status: 'live' });
    expect(live.data.status).toBe('live');

    const completed = await adminMatches.update(created.id, {
      status: 'completed',
      score_a: 2,
      score_b: 1,
      winner_team_id: teamAId,
    });
    expect(completed.data.status).toBe('completed');
    expect(completed.data.winner_team_id).toBe(teamAId);
  });

  it('rejects transitioning back from completed', async () => {
    const created = await prisma.match.create({
      data: {
        ...base(),
        status: 'completed',
        score_a: 2,
        score_b: 1,
        winner_team_id: teamAId,
      },
    });

    await expect(
      adminMatches.update(created.id, { status: 'live' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
    await expect(
      adminMatches.update(created.id, { status: 'scheduled' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('rejects completing without effective scores', async () => {
    const created = await prisma.match.create({
      data: { ...base(), status: 'live' },
    });

    await expect(
      adminMatches.update(created.id, { status: 'completed' }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('rejects an inconsistent winner on completion', async () => {
    const created = await prisma.match.create({
      data: { ...base(), status: 'live' },
    });

    await expect(
      adminMatches.update(created.id, {
        status: 'completed',
        score_a: 1,
        score_b: 2,
        winner_team_id: teamAId, // teamA lost
      }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('rejects a patch that makes both teams the same', async () => {
    const created = await prisma.match.create({
      data: { ...base(), status: 'scheduled' },
    });

    await expect(
      adminMatches.update(created.id, { team_b_id: teamAId }),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('cascades statistics rows on delete', async () => {
    const created = await prisma.match.create({
      data: {
        ...base(),
        status: 'completed',
        score_a: 2,
        score_b: 1,
        winner_team_id: teamAId,
      },
    });
    await prisma.matchTeamStatistic.create({
      data: { match_id: created.id, team_id: teamAId, kills: 10 },
    });

    await adminMatches.remove(created.id);

    const stats = await prisma.matchTeamStatistic.count({
      where: { match_id: created.id },
    });
    expect(stats).toBe(0);
  });

  it('throws 404 for missing matches on update and delete', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    await expect(
      adminMatches.update(unknown, { status: 'cancelled' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(adminMatches.remove(unknown)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
