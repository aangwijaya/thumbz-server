import { HealthIndicatorService } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';
import { DatabaseHealthIndicator } from './database.health';

function stubPrisma(ping: jest.Mock): PrismaService {
  return { $queryRaw: ping } as unknown as PrismaService;
}

describe('DatabaseHealthIndicator', () => {
  const indicators = new HealthIndicatorService();

  it('reports up when the database answers the ping', async () => {
    const prisma = stubPrisma(jest.fn().mockResolvedValue([{ '?column?': 1 }]));
    const indicator = new DatabaseHealthIndicator(prisma, indicators);

    await expect(indicator.pingCheck('database')).resolves.toEqual({
      database: { status: 'up' },
    });
  });

  it('reports down when the ping fails', async () => {
    const prisma = stubPrisma(jest.fn().mockRejectedValue(new Error('down')));
    const indicator = new DatabaseHealthIndicator(prisma, indicators);

    await expect(indicator.pingCheck('database')).resolves.toEqual({
      database: { status: 'down' },
    });
  });
});
