export namespace ApiModels {
  export interface Session {
    id: string;
    userId: string;
    current?: boolean;
    [key: string]: unknown;
  }

  export interface User {
    id: string;
    email: string;
    name: string;
    prefs?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface Resource {
    id: string;
    createdAt: string;
    updatedAt: string;
    [key: string]: unknown;
  }

  export interface ResourceList<T = Resource> {
    total: number;
    page: number;
    pageSize: number;
    items: T[];
  }

  export interface RealtimeEvent<T = unknown> {
    event: string;
    channels: string[];
    timestamp: string;
    payload: T;
  }
}