/**
 * Writes openapi.json at the repo root without a database or network:
 * providers are instantiated but lifecycle hooks (DB connect) never run.
 * CI regenerates it and fails when the committed copy has drifted.
 */
import './openapi-env';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { buildOpenApiDocument } from '../openapi';

async function main(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  const document = buildOpenApiDocument(app);
  const target = resolve(__dirname, '../../openapi.json');
  writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  console.log(`OpenAPI document written to ${target}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
