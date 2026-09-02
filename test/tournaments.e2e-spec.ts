import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/app.setup';
import { PrismaService } from './../src/prisma/prisma.service';

describe('Tournaments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const slugs = [
    'e2e-tournament-upcoming',
    'e2e-tournament-completed',
    'e2e-tournament-featured',
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    await prisma.tournament.createMany({
      data: [
        {
          slug: slugs[0],
          name: 'E2E Upcoming Cup',
          status: 'upcoming',
          region: 'e2e-tournament-region',
          start_date: new Date('2026-11-01'),
          end_date: new Date('2026-11-30'),
          prize_pool: '100000 USD',
        },
        {
          slug: slugs[1],
          name: 'E2E Completed Cup',
          status: 'completed',
          region: 'e2e-tournament-region',
          start_date: new Date('2026-01-01'),
          end_date: new Date('2026-02-01'),
          description: 'finished edition',
        },
        {
          slug: slugs[2],
          name: 'E2E Featured Cup',
          status: 'ongoing',
          region: 'e2e-tournament-region',
          start_date: new Date('2026-09-01'),
          end_date: new Date('2026-10-30'),
          featured: true,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.tournament.deleteMany({ where: { slug: { in: slugs } } });
    await app.close();
  });

  it('lists tournaments with the meta envelope', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tournaments?region=e2e-tournament-region')
      .expect(200);

    const body = response.body as {
      data: Array<Record<string, unknown>>;
      meta: Record<string, unknown>;
    };
    expect(body.meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 3,
      totalPages: 1,
    });
    expect(body.data).toHaveLength(3);
    expect(body.data[0]).toHaveProperty('start_date');
    expect(body.data[0]).not.toHaveProperty('description');
  });

  it('returns date-only start_date/end_date strings', async () => {
    const response = await request(app.getHttpServer())
      .get(
        '/api/v1/tournaments?region=e2e-tournament-region&sort=start_date&order=asc',
      )
      .expect(200);

    const body = response.body as {
      data: Array<{ start_date: string; end_date: string }>;
    };
    const first = body.data.find((t) => t.start_date === '2026-01-01');
    expect(first?.end_date).toBe('2026-02-01');
    expect(body.data[0].start_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('filters by status', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tournaments?region=e2e-tournament-region&status=completed')
      .expect(200);

    const body = response.body as { data: Array<{ status: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].status).toBe('completed');
  });

  it('filters by region and featured', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tournaments?region=e2e-tournament-region&featured=true')
      .expect(200);

    const body = response.body as { data: Array<{ slug: string }> };
    expect(body.data.map((t) => t.slug)).toEqual([slugs[2]]);
  });

  it('defaults order to desc for start_date and asc for name', async () => {
    const byDate = await request(app.getHttpServer())
      .get('/api/v1/tournaments?region=e2e-tournament-region')
      .expect(200);
    const dates = (byDate.body as { data: Array<{ start_date: string }> }).data;
    expect(dates[0].start_date).toBe('2026-11-01');

    const byName = await request(app.getHttpServer())
      .get('/api/v1/tournaments?sort=name')
      .expect(200);
    const names = (byName.body as { data: Array<{ name: string }> }).data;
    expect(names[0].name).toBe('E2E Completed Cup');
  });

  it('paginates', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tournaments?region=e2e-tournament-region&page=1&pageSize=2')
      .expect(200);

    const body = response.body as {
      data: unknown[];
      meta: { totalPages: number };
    };
    expect(body.data).toHaveLength(2);
    expect(body.meta.totalPages).toBe(2);
  });

  it('returns tournament detail including description', async () => {
    const id = (
      await prisma.tournament.findUniqueOrThrow({
        where: { slug: slugs[1] },
      })
    ).id;

    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${id}`)
      .expect(200);

    const body = response.body as {
      data: { description: string | null; slug: string };
    };
    expect(body.data.slug).toBe(slugs[1]);
    expect(body.data.description).toBe('finished edition');
  });

  it('returns 404 for an unknown tournament id', async () => {
    const unknown = '00000000-0000-4000-8000-000000000000';
    const response = await request(app.getHttpServer())
      .get(`/api/v1/tournaments/${unknown}`)
      .expect(404);
    expect(response.body).toEqual({
      error: { code: 'NOT_FOUND', message: 'Not found', details: null },
    });
  });

  it('returns 400 VALIDATION_ERROR for a malformed id', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tournaments/not-a-uuid')
      .expect(400);
    const body = response.body as {
      error: { code: string; details: unknown[] };
    };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(Array.isArray(body.error.details)).toBe(true);
  });

  it('returns 400 VALIDATION_ERROR for an unknown status value', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tournaments?status=bogus')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a malformed featured value', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/tournaments?featured=banana')
      .expect(400);
    const body = response.body as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
