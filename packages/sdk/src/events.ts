import { EventEmitter } from 'node:events';
import type { ServerEvent } from '@opc/core';

export class EventBus extends EventEmitter {
  emitEvent(event: ServerEvent): void {
    this.emit(event.type, event);
    this.emit('*', event);
  }
}

export type EventHandler<T extends ServerEvent> = (event: T) => void;
