import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { DEFAULT_PORT } from './config/configuration';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  const config = app.get(ConfigService);

  configureApp(app);

  await app.listen(config.get<number>('port') ?? DEFAULT_PORT);
}
void bootstrap();
