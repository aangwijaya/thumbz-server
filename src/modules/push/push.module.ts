import { Module } from '@nestjs/common';
import { PushController } from './push.controller';
import { PUSH_SENDER, webPushSender } from './push.sender';
import { PushService } from './push.service';

@Module({
  controllers: [PushController],
  providers: [PushService, { provide: PUSH_SENDER, useValue: webPushSender }],
  exports: [PushService],
})
export class PushModule {}
