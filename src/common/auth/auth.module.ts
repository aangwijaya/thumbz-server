import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createRemoteJWKSet } from 'jose';
import { JWT_KEY_RESOLVER, JwtVerifierService } from './jwt-verifier.service';

@Global()
@Module({
  providers: [
    {
      provide: JWT_KEY_RESOLVER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createRemoteJWKSet(
          new URL(config.get<string>('supabaseJwksUrl') as string),
        ),
    },
    JwtVerifierService,
  ],
  exports: [JwtVerifierService],
})
export class AuthModule {}
