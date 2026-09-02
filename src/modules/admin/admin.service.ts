import { Injectable, NotFoundException } from '@nestjs/common';
import { BusinessRuleException } from '../../common/errors/business-rule.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { GoldSnapshotDto } from './dto/upsert-economy.dto';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertEconomy(
    matchId: string,
    snapshots: GoldSnapshotDto[],
  ): Promise<{
    data: Array<{ team_id: string; gold: number; recorded_at: Date }>;
  }> {
    const match = await this.prisma.match.findUnique({
      where: { id: matchId },
      select: { team_a_id: true, team_b_id: true },
    });
    if (match === null) {
      throw new NotFoundException();
    }

    const validTeamIds = [match.team_a_id, match.team_b_id];
    const invalid = snapshots.some((s) => !validTeamIds.includes(s.team_id));
    if (invalid) {
      throw new BusinessRuleException('team_id must be one of the match teams');
    }

    const now = new Date();
    const prepared = snapshots.map((snapshot) => ({
      match_id: matchId,
      team_id: snapshot.team_id,
      gold: snapshot.gold,
      recorded_at:
        snapshot.recorded_at !== undefined
          ? new Date(snapshot.recorded_at)
          : now,
    }));

    await this.prisma.matchGoldSnapshot.createMany({
      data: prepared,
      skipDuplicates: true,
    });

    // fetch the exact rows that were written (duplicates resolve to the
    // existing rows) - recorded_at ordering alone is not a reliable selector
    const rows = await this.prisma.matchGoldSnapshot.findMany({
      where: {
        match_id: matchId,
        OR: prepared.map((row) => ({
          team_id: row.team_id,
          recorded_at: row.recorded_at,
        })),
      },
      orderBy: { recorded_at: 'asc' },
      select: { team_id: true, gold: true, recorded_at: true },
    });

    return {
      data: rows.map((row) => ({
        team_id: row.team_id,
        gold: row.gold,
        recorded_at: row.recorded_at,
      })),
    };
  }
}
