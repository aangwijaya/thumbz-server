import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

/**
 * A new user's first requests arrive in parallel, possibly on different API
 * instances: lazy profile creation must not race into a unique violation.
 */
describe('UsersService.ensureProfile under concurrency (local Postgres)', () => {
  const clients = Array.from({ length: 4 }, () => new PrismaService());
  const services = clients.map((client) => new UsersService(client));

  afterAll(async () => {
    await Promise.all(clients.map((client) => client.$disconnect()));
  });

  it('creates the profile once when many callers race', async () => {
    const subs = Array.from({ length: 5 }, () => randomUUID());
    try {
      for (const sub of subs) {
        await expect(
          Promise.all(
            services.flatMap((users) => [
              users.ensureProfile(sub),
              users.ensureProfile(sub),
            ]),
          ),
        ).resolves.toBeDefined();
      }
      expect(
        await clients[0].profile.count({ where: { id: { in: subs } } }),
      ).toBe(subs.length);
    } finally {
      await clients[0].profile.deleteMany({ where: { id: { in: subs } } });
    }
  });
});
