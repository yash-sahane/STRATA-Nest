import type { EventEmitter2 } from '@nestjs/event-emitter';

/**
 * Emit a domain event in the envelope every subscriber reads:
 * `{ name, workspaceId, payload, occurredAt }`.
 *
 * Call it AFTER the write has committed — subscribers notify people and write
 * the audit trail, neither of which should describe something that then rolled
 * back.
 */
export function emitDomainEvent(
  events: EventEmitter2,
  name: string,
  workspaceId: string,
  payload: object,
): void {
  events.emit(name, { name, workspaceId, payload, occurredAt: new Date().toISOString() });
}
