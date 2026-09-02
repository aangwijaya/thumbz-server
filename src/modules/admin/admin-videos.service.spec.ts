import { NotFoundException } from '@nestjs/common';
import { AdminVideosService } from './admin-videos.service';
import { PrismaService } from '../../prisma/prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:44322/postgres';

describe('AdminVideosService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let adminVideos: AdminVideosService;

  let teamAId: string;
  let teamBId: string;
  let matchId: string;

  beforeAll(async () => {
    prisma = new PrismaService();
    adminVideos = new AdminVideosService(prisma);

    const oldTeams = await prisma.team.findMany({
      where: { slug: { in: ['e2e-adminv-a', 'e2e-adminv-b'] } },
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
    await prisma.video.deleteMany({
      where: { url: { startsWith: 'https://e2e.example.com/' } },
    });

    const teamA = await prisma.team.create({
      data: {
        slug: 'e2e-adminv-a',
        name: 'E2E AdminV A',
        region: 'e2e-admin-region',
      },
    });
    teamAId = teamA.id;
    const teamB = await prisma.team.create({
      data: {
        slug: 'e2e-adminv-b',
        name: 'E2E AdminV B',
        region: 'e2e-admin-region',
      },
    });
    teamBId = teamB.id;
    const match = await prisma.match.create({
      data: {
        team_a_id: teamAId,
        team_b_id: teamBId,
        status: 'scheduled',
        scheduled_at: new Date('2026-09-05T10:00:00Z'),
      },
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.video.deleteMany({
      where: { url: { startsWith: 'https://e2e.example.com/' } },
    });
    await prisma.match.delete({ where: { id: matchId } });
    await prisma.team.deleteMany({
      where: { id: { in: [teamAId, teamBId] } },
    });
    await prisma.$disconnect();
  });

  const base = {
    title: 'E2E Admin Video',
    type: 'replay' as const,
    url: 'https://e2e.example.com/video-1',
    duration_seconds: 3600,
  };

  it('creates a video and returns the summary', async () => {
    const { data } = await adminVideos.create({ ...base, match_id: matchId });
    expect(data.title).toBe('E2E Admin Video');
    expect(data.type).toBe('replay');
    expect(data.match_id).toBe(matchId);
    expect(data.duration_seconds).toBe(3600);
  });

  it('throws 404 when the match does not exist', async () => {
    await expect(
      adminVideos.create({
        ...base,
        url: 'https://e2e.example.com/video-2',
        match_id: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updates only the provided fields and clears match with null', async () => {
    const created = await prisma.video.findFirstOrThrow({
      where: { url: 'https://e2e.example.com/video-1' },
    });

    const { data } = await adminVideos.update(created.id, {
      title: 'E2E Admin Video Renamed',
      match_id: null,
    });
    expect(data.title).toBe('E2E Admin Video Renamed');
    expect(data.match_id).toBeNull();
    expect(data.type).toBe('replay'); // untouched
  });

  it('throws 404 when updating a missing video', async () => {
    await expect(
      adminVideos.update('00000000-0000-4000-8000-000000000000', {
        title: 'X',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('deletes a video', async () => {
    const created = await prisma.video.findFirstOrThrow({
      where: { url: 'https://e2e.example.com/video-1' },
    });
    await adminVideos.remove(created.id);

    const remaining = await prisma.video.count({
      where: { url: 'https://e2e.example.com/video-1' },
    });
    expect(remaining).toBe(0);
  });

  it('throws 404 when deleting a missing video', async () => {
    await expect(
      adminVideos.remove('00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
