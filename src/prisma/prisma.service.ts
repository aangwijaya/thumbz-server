import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assertLocalTestDatabase } from './test-database-guard';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super();
    // Last line of defense: whatever loaded the env, tests never get a
    // client for a shared/cloud database.
    if (process.env.NODE_ENV === 'test') {
      assertLocalTestDatabase(process.env.DATABASE_URL);
    }
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
