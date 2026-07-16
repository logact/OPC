import { EventEmitter } from 'events';
import type { ServerEvent } from '@logact-pub/opc-protocol';

export class EventBus extends EventEmitter {
  emitEvent(event: ServerEvent): void {
    this.emit(event.type, event);
    this.emit('*', event);
  }
}

export type EventHandler<T extends ServerEvent> = (event: T) => void;
