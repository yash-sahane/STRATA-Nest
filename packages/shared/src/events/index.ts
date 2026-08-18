/**
 * Base domain-event contract (ADR-0006, ADR-0012). Events carry BUSINESS
 * meaning — there is no generic `*Updated` (review #5). Concrete events (e.g.
 * `TaskAssigned`, `LeaveApproved`) are defined alongside their owning module
 * and re-exported here as the migration progresses (arch §11). Phase 0 ships
 * only the base contract — no domain events yet.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Stable business event name, e.g. "task.assigned". */
  readonly name: string;
  /** Owning workspace, used to route to authorized realtime rooms (ADR-0006). */
  readonly workspaceId?: string;
  readonly payload: TPayload;
  /** ISO-8601 timestamp, emitted AFTER commit (arch §4 side-effect rule). */
  readonly occurredAt: string;
}
