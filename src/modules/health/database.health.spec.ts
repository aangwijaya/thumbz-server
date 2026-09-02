import { HealthCheckError } from '@nestjs/terminus';
import { PrismaService } from '../../prisma/prisma.service';
import { DatabaseHealthIndicator } from './database.health';

function stubPrisma(ping: jest.Mock): PrismaService {
  return { $queryRaw: ping } as unknown as PrismaService;
}

describe('DatabaseHealthIndicator', () => {
  it('reports up when the database answers the ping', async () => {
    const prisma = stubPrisma(jest.fn().mockResolvedValue([{ '?column?': 1 }]));
    const indicator = new DatabaseHealthIndicator(prisma);

    const result = await indicator.pingCheck('database');

    expect(result).toEqual({ database: { status: 'up' } });
  });

  it('throws HealthCheckError when the ping fails', async () => {
    const prisma = stubPrisma(jest.fn().mockRejectedValue(new Error('down')));
    const indicator = new DatabaseHealthIndicator(prisma);

    await expect(indicator.pingCheck('database')).rejects.toBeInstanceOf(
      HealthCheckError,
    );
  });
});
