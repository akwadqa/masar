# 00 — Executive Summary

Status: **Draft for approval** · Last updated: 2026-10-27

## What Masar is

Masar is a dedicated Agile work-management application for Akwad Programming's client, replacing a generic ERPNext-based task experience. It is organised around exactly five client-defined areas:

- **Spaces** — access-controlled project contexts with Manager/Member roles.
- **Tasks** — the single unit of work (no stages), with multiple assignees and a mandatory owner, lightweight **Actions**, shared labels plus Important (★) and My Day (☀), comments, attachments, history and a worklog.
- **Features** — business capabilities on a Now / Next / Later / Done roadmap board.
- **Batches** — one- or two-week, sprint-style plans that may include Tasks from several Spaces.
- **Releases** — product versions with their Tasks.

Target users: developers and analysts (Members), team leads (Managers), cross-team planners, and business stakeholders who read the roadmap.

## Architecture in one paragraph

A **modular monolith**: one Frappe v16 custom app (`masar`, no ERPNext) owns the data model, business rules, permissions, files and email; a **Nuxt 4.6 + Nuxt UI 4.12** single-page application (TypeScript 6.0.3) provides the product experience. The SPA (the **Masar Workspace**) is served **from the same origin** as Frappe at the domain root and authenticates with Frappe's session cookie and CSRF token — no tokens or secrets in the browser, no server-side rendering. The SPA talks only to a small set of permission-checked `masar.api.*` endpoints backed by services that enforce invariants transactionally. Space access is enforced on the server for every list, record, count, file, email and event, including viewer-scoped views of cross-Space Batches.

## Engineering philosophy

Requirements before architecture, evidence before decisions, permissions before endpoints, tests before claims. Nuxt UI native components first; custom components only where verified limitations require them (documented in ADRs). No speculative infrastructure.

## Key decisions

| Decision | Choice | Ref |
|---|---|---|
| Versions | Frappe v16.54, Nuxt 4.6.3, Nuxt UI 4.12.0, TS 6.0.3 (TS 7 breaks vue-tsc), Python 3.14, Node 24, MariaDB 11.8 | ADR-001 |
| Deployment | Same-origin static SPA at the domain root, Caddy gateway on AWS EC2; Frappe sessions + CSRF; Desk reserved for administrators | ADR-016, ADR-023, ADR-024 |
| API | Dedicated permission-checked services; generic Frappe writes to Masar data denied | ADR-003 |
| Permissions | Per-Space membership; `has_permission` (explicit bool) + query conditions + capability matrix; DocShare disabled | ADR-007 |
| Task List | Custom virtualised list built from Nuxt UI primitives (UTable fails cross-group drag and conflates expansion) | ADR-008 |
| Actions | Standalone records; one-time transactional promotion to Task with lineage | ADR-004 |
| Collaboration | Masar-owned comments, reactions, activity; private Frappe files attached to the Task | ADR-005, ADR-015 |
| Batches | Planned → Active → Completed; one current Batch per Task; participation history; viewer-scoped metrics | ADR-012 |
| Inline creation | Enter/blur commit with idempotency key — no duplicates, no lost text | ADR-011 |
| Concurrency | Field-scoped conflict detection (409) | ADR-018 |

## Status

Phase 0 (architecture, version validation, dev environment, Task List and auth feasibility spikes) is complete — see [phase-0-report.md](phase-0-report.md). Before Phase 1 can start, two things are needed: Akwad's review of these documents, and the client's answers to the business questions in [11](11-approval-questions.md), or acceptance of their recommended defaults.

## First milestone (Phase 1)

A vertical slice proving the architecture: a signed-in user sees only their Spaces, creates Tasks inline without duplicates, edits them in the list, opens them in a side panel and as a full page, and cannot reach another Space's Task by any endpoint, proven by automated permission tests and browser E2E.
