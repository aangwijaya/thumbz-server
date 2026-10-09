import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
} from '@nestjs/terminus';
import { Public } from '../../common/decorators/public.decorator';
import { RedisHealthIndicator } from '../../infra/redis/redis.health';
import { DatabaseHealthIndicator } from './database.health';

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly database: DatabaseHealthIndicator,
    private readonly redis: RedisHealthIndicator,
  ) {}

  /** Contract §1 probe (used by the Railway health check): readiness, minimal body. */
  @Get()
  @HealthCheck()
  async check(): Promise<{ status: string }> {
    const result = await this.readiness();
    return { status: result.status };
  }

  /** Liveness: the process is up and serving. No dependency checks. */
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: every dependency needed to serve traffic answers. */
  @Get('ready')
  @HealthCheck()
  ready(): Promise<HealthCheckResult> {
    return this.readiness();
  }

  private readiness(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.database.pingCheck('database'),
      () => this.redis.pingCheck('redis'),
    ]);
  }
}
