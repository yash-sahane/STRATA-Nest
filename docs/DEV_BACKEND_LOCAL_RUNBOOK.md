# Backend Local Development Runbook (Windows)

This project is configured so you can run Django directly on your host machine while running only required infrastructure in Docker.

## Root Cause of Previous Failure

The Django development server failed with PostgreSQL auth errors because your machine already has a local PostgreSQL service (`postgresql-x64-15`) listening on `5432`.

Your app was connecting to that local service instead of the intended Docker Postgres container.

## Root Fix Applied

- Docker Postgres host port changed to `5433` in `backend/docker-compose.yml`.
- Backend env defaults now point to `127.0.0.1:5433` in:
  - `backend/.env`
  - `backend/.env.example`

This avoids collision with local PostgreSQL on `5432`.

## Development Mode (Recommended)

Run only infra in Docker:

- Postgres
- Redis

Run app processes on host:

- Django (Daphne runserver)
- Celery worker (optional during feature work)
- Celery beat (optional if working on scheduled jobs)

## 1) Start Required Infra in Docker

From repo root:

```powershell
docker compose -f .\backend\docker-compose.yml up -d postgres redis
docker compose -f .\backend\docker-compose.yml ps
```

Expected:

- Postgres should expose `0.0.0.0:5433->5432/tcp`
- Redis should expose `0.0.0.0:6379->6379/tcp`

## 2) Run Backend on Host

From repo root:

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe app.py migrate
.\.venv\Scripts\python.exe app.py runserver 0.0.0.0:8000
```

Backend URL:

- `http://localhost:8000`

## 3) Optional Host Processes

In separate terminals (from `backend`):

```powershell
.\.venv\Scripts\python.exe -m celery -A config worker -l info
```

```powershell
.\.venv\Scripts\python.exe -m celery -A config beat -l info
```

Run these only when your feature requires async tasks or schedules.

## 4) Frontend (Host)

From repo root:

```powershell
Set-Location .\frontend
npm run dev
```

Frontend URL:

- `http://localhost:3000`

## Sanity Checks

- Backend check:

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe app.py check
```

- DB connectivity (uses current `DATABASE_URL`):

```powershell
Set-Location .\backend
.\.venv\Scripts\python.exe -c "import os, psycopg2; conn=psycopg2.connect(os.environ.get('DATABASE_URL') or 'postgres://postgres:postgres@127.0.0.1:5433/ltconnect'); cur=conn.cursor(); cur.execute('select 1'); print(cur.fetchone()); conn.close()"
```

## Troubleshooting

### Error: `can't open file ... app.py`

You are in the wrong directory. `app.py` is under `backend`.

### Error: `password authentication failed for user \"postgres\"`

You are likely connecting to local PostgreSQL on `5432` instead of Docker Postgres on `5433`.

Confirm:

```powershell
Get-NetTCPConnection -LocalPort 5432 -State Listen
docker compose -f .\backend\docker-compose.yml ps
```

Ensure `DATABASE_URL` is exactly:

```text
postgres://postgres:postgres@127.0.0.1:5433/ltconnect
```

### Docker cleanup (if needed)

```powershell
docker compose -f .\backend\docker-compose.yml down
docker compose -f .\backend\docker-compose.yml up -d postgres redis
```

## Minimal Daily Workflow

1. Start Docker Desktop.
2. `docker compose -f .\backend\docker-compose.yml up -d postgres redis`
3. Start backend on host from `backend` folder.
4. Start frontend on host from `frontend` folder.
