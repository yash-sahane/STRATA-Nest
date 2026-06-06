# Native API Architecture

This project now uses a first-party Django REST API as the backend contract for the Next.js frontend.

## Stack

- Frontend: Next.js, React, TypeScript, Tailwind CSS, TanStack Query.
- Backend: Django, Django REST Framework, PostgreSQL, Redis, Channels, Celery.
- Realtime: Django Channels WebSockets.
- Background work: Celery workers backed by Redis.
- Files: Django file endpoints with local media or object storage depending on deployment settings.

## API Contract

Resources use native field names:

```json
{
  "id": "resource_id",
  "createdAt": "2026-01-01T00:00:00Z",
  "updatedAt": "2026-01-01T00:00:00Z"
}
```

List endpoints return a paginated envelope:

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "pageSize": 100
}
```

Filtering uses query parameters:

```text
/api/v1/tasks/?workspaceId=...&status=TODO&ordering=-createdAt&pageSize=50
```

Common lookup suffixes include `__ne`, `__lt`, `__lte`, `__gt`, `__gte`, `__icontains`, `__isnull`, and `__not_in`.

## Frontend Client

The browser uses `src/lib/api/client.ts`:

```ts
resources.list("tasks", [query.equal("workspaceId", workspaceId)]);
resources.get("tasks", taskId);
resources.create("tasks", id.unique(), data);
resources.update("tasks", taskId, data);
resources.remove("tasks", taskId);
```

Collection slugs resolve through `src/lib/api/collection-slugs.ts`, keeping URL construction centralized.

## Realtime Contract

Realtime messages use a native event frame:

```json
{
  "event": "tasks.update",
  "payload": { "id": "task_id" },
  "channels": ["tasks", "tasks.task_id"],
  "timestamp": "2026-01-01T00:00:00Z"
}
```

Frontend helpers live in `src/lib/api/realtime.ts`.

## Auth

The frontend talks to Django auth endpoints through `src/lib/api/auth-client.ts`. The `/api/v1/auth/me/` endpoint returns the current user and session in the same native naming style used by the rest of the API.

## Validation

Before shipping API-contract changes, run:

```bash
cd backend
python app.py check

cd ../frontend
npx tsc --noEmit --pretty false
```
