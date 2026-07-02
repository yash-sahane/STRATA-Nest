# Claude Prompt --- Migrate L-T-Connect-2 Architecture from Django to NestJS

## Context

You are acting as a **Principal Software Architect** and **Senior Staff
Engineer**.

I have an existing enterprise application whose frontend is already
based on **Next.js**. The backend is currently implemented using
**Django + Django REST Framework + Django Channels + Celery**.

Your task is **NOT** to simply translate Django code into NestJS.

Instead, redesign the entire backend into a modern, scalable TypeScript
architecture while preserving every business capability.

The final architecture must be something that a senior engineer at
companies like Linear, Notion, Vercel, GitLab, Atlassian or Microsoft
would design.

------------------------------------------------------------------------

# Tech Stack

## Frontend

-   Next.js (latest App Router)
-   React
-   TypeScript
-   Tailwind
-   TanStack Query

## Backend

-   NestJS
-   Prisma ORM
-   PostgreSQL
-   Redis
-   BullMQ
-   Socket.IO (Nest WebSocket Gateway)
-   Passport
-   JWT
-   Refresh Tokens via httpOnly cookies
-   class-validator
-   Swagger
-   Docker

------------------------------------------------------------------------

# Primary Goal

Redesign the backend architecture---not just syntax.

Replace every Django concept with the best NestJS equivalent.

Never recreate Django patterns when a better NestJS approach exists.

------------------------------------------------------------------------

# Preserve

The following business modules and workflows must remain fully
functional:

-   Authentication
-   Users
-   Workspaces
-   Roles & Permissions (RBAC)
-   Invitations
-   Join Requests
-   Projects
-   Requirements
-   Functional Requirements
-   Epics
-   Sprints
-   Tasks
-   Subtasks
-   Kanban
-   Labels
-   Comments
-   Activity Logs
-   Notifications
-   Attendance
-   Leave
-   Time Tracking
-   File Uploads
-   GitHub/GitLab Integrations
-   AI
-   Analytics
-   Search
-   Email
-   Real-time Updates

Do not remove features.

------------------------------------------------------------------------

# Architecture Requirements

Design a production-ready monorepo.

Example:

``` text
apps/
    api/
    worker/

packages/
    prisma/
    auth/
    shared/
    common/
    config/

infra/
    docker/
    nginx/
    terraform/
```

Separate API and Worker.

Worker processes: - emails - notifications - reminders - AI -
integrations - scheduled jobs

------------------------------------------------------------------------

# Domain Modules

Each business domain must become an isolated Nest module.

Each module should contain:

-   controller
-   service
-   repository
-   dto
-   entities/models
-   events
-   websocket gateway (when required)
-   validators
-   tests

No gigantic service files.

------------------------------------------------------------------------

# Database

Replace Django ORM completely with Prisma.

Design: - Prisma schema - relationships - indexes - cascading rules -
transaction strategy - soft deletes where appropriate - audit fields -
migrations

Explain why each modeling decision exists.

------------------------------------------------------------------------

# Authentication

Implement:

-   Passport
-   JWT
-   Refresh Tokens
-   httpOnly cookies
-   Guards
-   Decorators
-   Role Guards
-   Workspace Guards
-   Permission Guards

Include complete authentication flow.

------------------------------------------------------------------------

# Authorization

Design enterprise RBAC.

Support:

Workspace Roles

Project Roles

Permissions

Ownership

Inherited permissions

Custom roles

Policy-based authorization

Avoid hardcoded role checks.

------------------------------------------------------------------------

# API

Use REST.

Version all endpoints.

Use DTOs everywhere.

Use validation pipes.

Return standardized API responses.

Centralize exception filters.

------------------------------------------------------------------------

# Real-time

Replace Django Channels with:

NestJS Gateway

Socket.IO

Redis adapter

Explain:

subscriptions

rooms

workspace broadcasts

project broadcasts

notification broadcasts

cache invalidation

------------------------------------------------------------------------

# Background Jobs

Replace Celery with BullMQ.

Separate queues:

Email Queue

Notification Queue

Reminder Queue

Attendance Queue

AI Queue

Git Queue

Deadline Queue

Explain retries, backoff, idempotency and monitoring.

------------------------------------------------------------------------

# Event Driven Design

Use domain events.

Example:

TaskCreated

TaskUpdated

SprintCompleted

LeaveApproved

NotificationCreated

TimeEntryApproved

Avoid tightly coupled modules.

------------------------------------------------------------------------

# Shared Package

Create shared packages for:

types

interfaces

constants

utilities

errors

decorators

guards

pipes

config

------------------------------------------------------------------------

# Frontend

Keep Next.js.

Explain any frontend improvements required to better integrate with
NestJS.

Include:

API layer

React Query strategy

WebSocket strategy

Optimistic updates

Cache invalidation

Error handling

------------------------------------------------------------------------

# Infrastructure

Design Docker-based deployment.

Include:

API

Worker

Redis

Postgres

Nginx/Caddy

Storage

Environment variables

Health checks

Logging

Monitoring

------------------------------------------------------------------------

# Documentation to Produce

Generate a complete replacement architecture document including:

1.  High-level architecture
2.  Folder structure
3.  Module dependency graph
4.  Database architecture
5.  Prisma schema organization
6.  Authentication flow
7.  Authorization design
8.  REST API design
9.  WebSocket architecture
10. Queue architecture
11. Event-driven architecture
12. Background jobs
13. Infrastructure
14. Deployment
15. Security
16. Scalability
17. Performance optimizations
18. Caching strategy
19. Testing strategy
20. Migration plan from Django to NestJS
21. Risks and trade-offs
22. Future microservice extraction opportunities

------------------------------------------------------------------------

# Migration Expectations

For every Django component, specify:

Current implementation

NestJS replacement

Benefits

Migration steps

Breaking changes

Risk level

------------------------------------------------------------------------

# Coding Standards

Follow:

SOLID

DDD-inspired modular design

Repository Pattern (where valuable)

Dependency Injection

Clean Architecture principles

Avoid overengineering.

Prefer simplicity with scalability.

------------------------------------------------------------------------

# Deliverable

Produce a single enterprise-grade architecture document in Markdown that
can directly replace the existing architecture documentation. The output
should be implementation-ready, opinionated, and detailed enough for a
team to begin development immediately.
