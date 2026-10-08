import {
  Controller,
  Get,
  Header,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { timingSafeEqual } from 'node:crypto';
import { bearerToken } from '../../common/auth/jwt-verifier.service';
import { Public } from '../../common/decorators/public.decorator';
import { MetricsService } from './metrics.service';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@ApiExcludeController()
@Controller('metrics')
export class MetricsController {
  private readonly token: string | null;

  constructor(
    private readonly metrics: MetricsService,
    config: ConfigService,
  ) {
    this.token = config.get<string | null>('metricsToken') ?? null;
  }

  @Public()
  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(
    @Headers('authorization') authorization?: string,
  ): Promise<string> {
    if (this.token !== null) {
      const provided = bearerToken(authorization);
      if (provided === null || !safeEqual(provided, this.token)) {
        throw new UnauthorizedException();
      }
    }
    return this.metrics.registry.metrics();
  }
}
