import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvents } from './domain-events';

/** DomainEvents for specs that build services by hand; `emitted` records calls. */
export function testEvents(): DomainEvents & { emitted: unknown[] } {
  const emitted: unknown[] = [];
  const events = new DomainEvents(new EventEmitter2()) as DomainEvents & {
    emitted: unknown[];
  };
  const emit = events.emit.bind(events);
  events.emitted = emitted;
  events.emit = (event) => {
    emitted.push(event);
    emit(event);
  };
  return events;
}
