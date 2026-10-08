import { Module } from '@nestjs/common';
import { EmitterRealtimePublisher } from './emitter-realtime.publisher';
import { PresenceService } from './presence.service';
import { RealtimeBroadcaster } from './realtime.broadcaster';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimePublisher } from './realtime-publisher';
import { SequencerService } from './sequencer.service';

/** API process: owns the sockets and publishes to them directly. */
@Module({
  providers: [
    RealtimeGateway,
    { provide: RealtimePublisher, useExisting: RealtimeGateway },
    RealtimeBroadcaster,
    PresenceService,
    SequencerService,
  ],
  exports: [RealtimePublisher],
})
export class RealtimeModule {}

/** Worker process: no sockets; publishes through Redis to the API instances. */
@Module({
  providers: [
    { provide: RealtimePublisher, useClass: EmitterRealtimePublisher },
    RealtimeBroadcaster,
    SequencerService,
  ],
  exports: [RealtimePublisher],
})
export class RealtimeEmitterModule {}
