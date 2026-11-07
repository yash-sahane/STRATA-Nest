/**
 * Versioned wire-contract types. These shapes are consumed by the
 * Next.js frontend and MUST NOT change under /api/v1.
 */

export interface ApiErrorEnvelope {
  error: {
    message: string | string[] | Record<string, unknown>;
    code: number;
    type: string;
    /** The fields the error is about, when the API names them (a save refused because somebody else changed them). */
    fields?: string[];
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** WebSocket frame shape — also part of the versioned contract. */
export interface RealtimeFrame<T = unknown> {
  event: string;
  payload: T;
  channels: string[];
  timestamp: string; // ISO-8601 with trailing Z
}
