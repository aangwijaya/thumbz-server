import { Injectable } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import {
  collectDefaultMetrics,
  Counter,
  Gauge,
  Histogram,
  Registry,
} from 'prom-client';

/**
 * Prometheus registry for the process. Feature modules register their own
 * collectors here (WS connections, queue depth, cache hits) via the helpers.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly httpDuration = new Histogram({
    name: 'http_request_duration_seconds',
    help: 'HTTP request latency by route pattern and status',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
    registers: [this.registry],
  });

  constructor() {
    collectDefaultMetrics({ register: this.registry, prefix: 'thumbz_' });
  }

  counter<L extends string>(name: string, help: string, labelNames: L[] = []) {
    return (
      (this.registry.getSingleMetric(name) as Counter<L> | undefined) ??
      new Counter({ name, help, labelNames, registers: [this.registry] })
    );
  }

  gauge<L extends string>(name: string, help: string, labelNames: L[] = []) {
    return (
      (this.registry.getSingleMetric(name) as Gauge<L> | undefined) ??
      new Gauge({ name, help, labelNames, registers: [this.registry] })
    );
  }

  /**
   * Express middleware timing every request. Labels use the matched route
   * pattern (`/api/v1/matches/:id`), never the raw URL, to bound cardinality.
   */
  httpMiddleware() {
    return (req: Request, res: Response, next: NextFunction): void => {
      const stop = this.httpDuration.startTimer({ method: req.method });
      res.on('finish', () => {
        const pattern = (req.route as { path?: string } | undefined)?.path;
        stop({
          route: pattern ? `${req.baseUrl}${pattern}` : 'unmatched',
          status: String(res.statusCode),
        });
      });
      next();
    };
  }
}
