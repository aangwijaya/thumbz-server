import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ProfileSyncInterceptor } from './profile-sync.interceptor';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ProfileSyncInterceptor,
    },
  ],
  exports: [UsersService],
})
export class UsersModule {}
