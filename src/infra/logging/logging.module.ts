import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { assignRequestId } from './request-id';

/** Paths that would only add noise (probes, scrapes). */
const QUIET_PATHS = ['/health', '/health/live', '/health/ready', '/metrics'];

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const nodeEnv = config.get<string>('nodeEnv');
        return {
          pinoHttp: {
            // Tests are silent unless LOG_LEVEL is set explicitly (debugging).
            level:
              nodeEnv === 'test' && !process.env.LOG_LEVEL
                ? 'silent'
                : (config.get<string>('logLevel') ?? 'info'),
            genReqId: assignRequestId,
            autoLogging: {
              ignore: (req) =>
                QUIET_PATHS.includes(req.url?.split('?')[0] ?? ''),
            },
            // Never log credentials or payment signatures.
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.headers["x-nowpayments-sig"]',
                'req.headers["x-callback-token"]',
                'res.headers["set-cookie"]',
              ],
              censor: '[redacted]',
            },
            serializers: {
              req: (req: { id: string; method: string; url: string }) => ({
                id: req.id,
                method: req.method,
                url: req.url,
              }),
              res: (res: { statusCode: number }) => ({
                statusCode: res.statusCode,
              }),
            },
            transport:
              nodeEnv === 'development'
                ? {
                    target: 'pino-pretty',
                    options: {
                      singleLine: true,
                      translateTime: 'SYS:HH:MM:ss',
                    },
                  }
                : undefined,
          },
        };
      },
    }),
  ],
})
export class LoggingModule {}
