import { frontendLogger } from '../logging/Logger';

export interface CacheEvent {
  type: 'cache-invalidated' | 'cache-cleared' | 'data-updated' | 'adapter-cleared' | 'user-logout';
  source: 'coordinator' | 'adapter' | 'service' | 'component';
  scopeId?: string;
  dataType?: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

export type EventHandler<T = CacheEvent> = (data: T) => void;

export class EventBus {
  private listeners = new Map<string, Set<EventHandler<CacheEvent>>>();

  on<T = CacheEvent>(event: string, handler: EventHandler<T>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }

    this.listeners.get(event)!.add(handler as EventHandler<CacheEvent>);

    frontendLogger.adapter.transformSuccess('EventBus', `Subscribed to event: ${event}`);

    return () => {
      const handlers = this.listeners.get(event);
      if (handlers) {
        handlers.delete(handler as EventHandler<CacheEvent>);
        if (handlers.size === 0) {
          this.listeners.delete(event);
        }
        frontendLogger.adapter.transformSuccess('EventBus', `Unsubscribed from event: ${event}`);
      }
    };
  }

  emit<T = CacheEvent>(event: string, data: T): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          (handler as EventHandler<T>)(data);
          frontendLogger.adapter.transformSuccess('EventBus', `Event emitted: ${event}`);
        } catch (error) {
          frontendLogger.adapter.transformError('EventBus', error as Error, { event, data });
        }
      });
    } else {
      frontendLogger.adapter.transformStart('EventBus', `No listeners for event: ${event}`);
    }
  }

  off<T = CacheEvent>(event: string, handler: EventHandler<T>): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.delete(handler as EventHandler<CacheEvent>);
      if (handlers.size === 0) {
        this.listeners.delete(event);
      }
      frontendLogger.adapter.transformSuccess('EventBus', `Handler removed for event: ${event}`);
    }
  }

  clear(event?: string): void {
    if (event) {
      this.listeners.delete(event);
      frontendLogger.adapter.transformSuccess('EventBus', `Cleared all handlers for event: ${event}`);
    } else {
      this.listeners.clear();
      frontendLogger.adapter.transformSuccess('EventBus', 'Cleared all event handlers');
    }
  }

  getListenerCount(event?: string): number {
    if (event) {
      return this.listeners.get(event)?.size || 0;
    }
    return Array.from(this.listeners.values()).reduce((total, handlers) => total + handlers.size, 0);
  }

  getActiveListenerCount(): number {
    return Array.from(this.listeners.values()).reduce((total, handlers) => total + handlers.size, 0);
  }

  getListenersByEvent(): Record<string, number> {
    const result: Record<string, number> = {};
    this.listeners.forEach((handlers, event) => {
      result[event] = handlers.size;
    });
    return result;
  }
}
