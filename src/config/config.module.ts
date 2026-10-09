import { ConfigModule } from '@nestjs/config';
import { configuration, validateEnv } from './configuration';

/** Shared by the API and the worker. Tests never read .env (see test/setup-env.ts). */
export const AppConfigModule = ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: process.env.NODE_ENV === 'test' ? '.env.test' : '.env',
  load: [configuration],
  validate: validateEnv,
});
