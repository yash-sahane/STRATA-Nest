# L-T-Connect Django Backend

Django 5 + DRF + Channels backend that serves the native L-T-Connect REST and
realtime API.

See [docs/DJANGO_MIGRATION_PLAN.md](../docs/DJANGO_MIGRATION_PLAN.md) for the full
plan.

## Quick start (local)

```bash
cp .env.example .env
docker compose up -d postgres redis
pip install -e ".[dev]"
python app.py migrate
python app.py createsuperuser
python app.py runserver 0.0.0.0:8000
```

## Architecture

- `config/` Django project (settings, urls, asgi, celery)
- `apps/core/` Base model, native serializer/viewset/filter/pagination helpers
- `apps/accounts/` Custom `User`, JWT auth (cookie-based), `/auth/me/`
- `apps/workspaces/` `Workspace`, `WorkspaceMember`, `WorkspaceRole`, invites, join requests
- `apps/projects/` `Project`, `KanbanColumn`, `Label`
- `apps/requirements/` `ClientRequirement`, `FunctionalRequirement` + bulk-save
- `apps/epics/`, `apps/sprints/`, `apps/tasks/`
- `apps/attendance/`, `apps/leave/`, `apps/notifications/`, `apps/time_tracking/`
- `apps/integrations/` GitHub / GitLab / Discord / commits
- `apps/activity/` ActivityLog feed (auto-populated via signals)
- `apps/search/` SavedSearch + global search aggregator
- `apps/files/` Attachment uploads (django-storages, S3 or local)
- `apps/realtime/` Channels routing + resource event broadcast helpers
- `apps/emails/` Resend wrapper + Celery tasks

## API invariants

1. List response shape: `{ "items": [...], "total": N, "page": P, "pageSize": S }`.
2. Every resource carries `id`, `createdAt`, and `updatedAt`.
3. Default ordering on every list endpoint: `-created_at`.
4. Filters use normal query parameters with camelCase field names accepted.
5. Realtime WS payloads use `{ "event", "payload", "channels", "timestamp" }`.
