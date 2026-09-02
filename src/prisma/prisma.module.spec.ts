import { Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaModule } from './prisma.module';
import { PrismaService } from './prisma.service';

process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

@Injectable()
class Consumer {
  constructor(readonly prisma: PrismaService) {}
}

describe('PrismaModule', () => {
  it('provides PrismaService with connect/disconnect lifecycle hooks', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
    }).compile();

    const service = moduleRef.get(PrismaService);
    expect(service).toBeDefined();
    expect(typeof service.$connect).toBe('function');
    expect(typeof service.$disconnect).toBe('function');
  });

  it('exports PrismaService for injection into other providers', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule],
      providers: [Consumer],
    }).compile();

    const consumer = moduleRef.get(Consumer);
    expect(consumer.prisma).toBe(moduleRef.get(PrismaService));
  });
});
