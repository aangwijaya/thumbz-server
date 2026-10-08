import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { RealtimeBroadcaster } from './realtime.broadcaster';
import { RealtimeGateway } from './realtime.gateway';
import { SequencerService } from './sequencer.service';

@Module({
  providers: [
    RealtimeGateway,
    RealtimeBroadcaster,
    PresenceService,
    SequencerService,
  ],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
