import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from './users.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

describe('UsersService (integration, local Postgres)', () => {
  let prisma: PrismaService;
  let users: UsersService;
  const sub = randomUUID();

  beforeAll(() => {
    prisma = new PrismaService();
    users = new UsersService(prisma);
  });

  afterAll(async () => {
    await prisma.profile.delete({ where: { id: sub } }).catch(() => undefined);
    await prisma.$disconnect();
  });

  it('creates a profile lazily with role user', async () => {
    await users.ensureProfile(sub);

    const profile = await users.getProfile(sub);
    expect(profile?.id).toBe(sub);
    expect(profile?.role).toBe('user');
    expect(profile?.username).toBeNull();
  });

  it('is idempotent when called twice', async () => {
    await users.ensureProfile(sub);
    await users.ensureProfile(sub);

    const count = await prisma.profile.count({ where: { id: sub } });
    expect(count).toBe(1);
  });

  it('does not overwrite an existing role on a later call', async () => {
    await prisma.profile.update({
      where: { id: sub },
      data: { role: 'admin' },
    });

    await users.ensureProfile(sub);

    const profile = await users.getProfile(sub);
    expect(profile?.role).toBe('admin');
  });
});
