import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { AdminService } from './admin.service';
import { PrismaService } from '../../prisma/prisma.service';
import { testEvents } from '../../infra/events/testing';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('AdminService economy (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let admin: AdminService;

  let teamAId: string;
  let teamBId: string;
  let matchId: string;
  const otherMatchId = randomUUID();

  beforeAll(async () => {
    prisma = new PrismaService();
    admin = new AdminService(prisma, testEvents());

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-econ-t1',
        name: 'E2E Econ T1',
        region: 'e2e-econ-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-econ-t2',
        name: 'E2E Econ T2',
        region: 'e2e-econ-region',
      },
    });
    teamBId = teamB.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'live',
        scheduled_at: new Date('2026-09-05T10:00:00Z'),
      },
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.$disconnect();
  });

  it('appends gold snapshots and returns them ordered asc', async () => {
    const { data } = await admin.upsertEconomy(matchId, [
      { team_id: teamAId, gold: 20000, recorded_at: '2026-09-05T10:05:00Z' },
      { team_id: teamBId, gold: 19500, recorded_at: '2026-09-05T10:10:00Z' },
    ]);

    expect(data).toHaveLength(2);
    expect(data.map((s) => s.gold)).toEqual([20000, 19500]);
    expect(data[0]?.team_id).toBe(teamAId);
  });

  it('ignores duplicate snapshots (same match, team, timestamp)', async () => {
    await admin.upsertEconomy(matchId, [
      { team_id: teamAId, gold: 99999, recorded_at: '2026-09-05T10:05:00Z' },
    ]);

    const rows = await prisma.matchGoldSnapshot.findMany({
      where: {
        match_id: matchId,
        team_id: teamAId,
        recorded_at: new Date('2026-09-05T10:05:00Z'),
      },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.gold).toBe(20000); // first write wins
  });

  it('defaults recorded_at to now when omitted', async () => {
    const { data } = await admin.upsertEconomy(matchId, [
      { team_id: teamAId, gold: 21000 },
    ]);
    expect(data[0]?.gold).toBe(21000);
    expect(data[0]?.recorded_at).toBeInstanceOf(Date);
  });

  it('rejects a team that is not part of the match', async () => {
    await expect(
      admin.upsertEconomy(matchId, [{ team_id: otherMatchId, gold: 1000 }]),
    ).rejects.toBeInstanceOf(BusinessRuleException);
  });

  it('throws 404 for an unknown match', async () => {
    await expect(
      admin.upsertEconomy('00000000-0000-4000-8000-000000000000', [
        { team_id: teamAId, gold: 1000 },
      ]),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
