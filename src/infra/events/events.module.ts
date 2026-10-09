import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEvents } from './domain-events';

@Global()
@Module({
  imports: [
    EventEmitterModule.forRoot({ wildcard: false, ignoreErrors: false }),
  ],
  providers: [DomainEvents],
  exports: [DomainEvents],
})
export class EventsModule {}
