/**
 * FROZEN wire-contract types (ADR-0003). These shapes are consumed by the
 * Next.js frontend and MUST NOT change under /api/v1.
 *   - error envelope:      CURRENT_SYSTEM_AUDIT.md §4.5
 *   - pagination envelope: CURRENT_SYSTEM_AUDIT.md §4.4
 */

export interface ApiErrorEnvelope {
  error: {
    message: string | string[] | Record<string, unknown>;
    code: number;
    type: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** WebSocket frame shape (CURRENT_SYSTEM_AUDIT.md §7.1) — also frozen. */
export interface RealtimeFrame<T = unknown> {
  event: string;
  payload: T;
  channels: string[];
  timestamp: string; // ISO-8601 with trailing Z
}
