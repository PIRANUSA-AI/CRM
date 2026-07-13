# Internal-Only Auth & Team Provisioning — Design

Status: approved for planning
Date: 2026-07-08

## Program context

Crm (formerly OpenCRM/Scalebiz) is Piranusa's internal sales CRM —
single-tenant, one organization, one production deployment, no self-service
signup. The codebase was inherited from a vendored multi-tenant SaaS
product, so it currently has a public registration + organization-creation
onboarding flow that doesn't match how this app is actually used.

Org structure: CEO → Sales Leader → Sales Rep (three roles, established in
earlier product discussion). Access control (who can see/edit what) does
not exist in a real, enforced sense today — the `role` field on `users` is
a free string with no permission checks behind it anywhere except one
narrow case (`handover/service.ts`'s supervisor/admin auto-approve bypass).

This spec covers only the auth/provisioning slice: turning off public
signup, bootstrapping the first (CEO) account, and giving CEO/Leader a way
to create and manage team accounts with the three canonical roles. Full
RBAC enforcement across existing modules (inbox assignment visibility, deal
ownership scoping, broadcast/developer-key access, etc.) is explicitly out
of scope — it's a large, module-by-module effort that deserves its own
spec, built on top of the `requireRole()` helper this spec introduces.

## Problem

Right now anyone can self-register at `/register`, which calls Better
Auth's public `POST /auth/sign-up/email` endpoint and then walks through an
`/onboarding` wizard that creates a new organization. For a single-tenant
internal tool this is actively wrong: there should be exactly one
organization, and exactly the people Piranusa's leadership adds should have
accounts.

## Current-state findings (grounded in the actual codebase)

- `src/auth.ts` configures Better Auth with `emailAndPassword: { enabled:
  true, autoSignInAfterRegistration: true }` and `plugins: []` (no
  organization/admin plugin loaded). The HTTP mount point is a thin
  wrapper, `betterAuthView`, in the same file — this is where signup will
  be intercepted.
- `apps/frontend/src/routes/register.tsx` posts directly to
  `${API}/auth/sign-up/email`, then redirects to `/onboarding` (which
  creates an organization) or `/dashboard`.
- `apps/backend/src/modules/admin/` exists as an empty stub — no files.
  This is where the new team-provisioning endpoint belongs.
- `apps/backend/src/modules/user/` (261 lines) only reads/writes the
  `role` string field; no role-based authorization exists there.
- `apps/backend/src/lib/organization-membership.ts` already has
  `ensureBetterAuthOrganizationMembership()`, which keeps a Better Auth
  `member` row in sync with an app-level user + role. This spec reuses it
  rather than duplicating org-membership logic.
- `users.active` (Boolean, default true) already exists in the Prisma
  schema — available for a future deactivation feature, not built here.

## Decisions made during brainstorming

- **Bootstrap the first (CEO) account via a one-time seed script**
  (`bun run db:seed:ceo`, reading `SEED_CEO_EMAIL` / `SEED_CEO_PASSWORD`
  from `.env`), not any public or semi-public form. Idempotent — running it
  again when a CEO already exists is a no-op.
- **CEO and Sales Leader can both create new accounts** (not CEO-only) —
  a Leader can onboard their own Sales Reps without routing through the
  CEO every time.
- **New accounts get a system-generated random password**, shown once to
  the admin who created the account, to hand off manually (WhatsApp, in
  person). No email-sending infrastructure is required for this.
- **Roles are exactly three canonical string values**: `ceo`, `leader`,
  `sales`. Kept as a validated `String` column (matching the existing
  pattern), not a new Prisma enum — enforcement happens at the API layer.
- **Scope**: this spec covers turning off public signup, the CEO seed, and
  a "Kelola Tim" admin page (create account + edit an existing member's
  role). Enforcing role-based visibility inside every other module (deals,
  inbox, broadcasts, etc.) is a separate future spec.

## Architecture

```
[1] Seed script (one-time)
      bun run db:seed:ceo
        → creates the one organization (if missing)
        → creates one user, role="ceo", from SEED_CEO_EMAIL/PASSWORD
        → idempotent: skips if a ceo already exists

[2] Public signup blocked
      apps/frontend/register.tsx route → removed / redirects to /login
      apps/backend/src/auth.ts (betterAuthView wrapper)
        → intercepts requests to /auth/sign-up/email
        → 403 unless called internally (see [3])
      /onboarding route → removed / redirects to /login
      (login itself is untouched — /auth/sign-in/email keeps working)

[3] Admin-driven account creation
      POST /api/admin/team-members   (new: apps/backend/src/modules/admin/)
        → requireRole(context, ['ceo', 'leader'])
        → generate strong random password
        → auth.api.signUpEmail() called in-process (server-side, bypasses
          the HTTP block in [2] entirely — it's a function call, not an
          HTTP request)
        → set users.role to the requested value (ceo/leader/sales)
        → ensureBetterAuthOrganizationMembership() to attach to the one org
        → response: { user, generatedPassword } — password never persisted
          in plaintext anywhere else, never logged

      PATCH /api/admin/team-members/:id/role
        → requireRole(context, ['ceo', 'leader'])
        → updates users.role to one of ceo/leader/sales

      GET /api/admin/team-members
        → requireRole(context, ['ceo', 'leader'])
        → lists existing users + roles for the "Kelola Tim" page

[4] Shared authorization helper
      requireRole(context, allowedRoles: string[])
        → reads the authenticated user's role from session
        → throws/returns 403 if not in allowedRoles
        → reused by [3]'s three endpoints; becomes the pattern the future
          full-RBAC spec builds on for every other module

[5] Frontend "Kelola Tim" page (apps/frontend/src/routes, new)
      Visible only to ceo/leader (client-side route guard using the same
      role check, backed by the server-side requireRole as the real
      enforcement).
      - Form: name, email, role dropdown → POST /api/admin/team-members
      - On success: modal showing the generated password once, copyable,
        dismiss-to-clear (never re-fetchable after dismissal)
      - List: existing team members + role, inline role editor →
        PATCH /api/admin/team-members/:id/role
```

## Error handling

| Situation | Handling |
|---|---|
| Direct public `POST /auth/sign-up/email` | Blocked in `betterAuthView` before reaching `auth.handler()` → `403`. |
| Non-`ceo`/`leader` calls any `/api/admin/team-members*` endpoint | `403`, generic message, no detail on who is authorized. |
| Duplicate email on account creation | Clear validation error (`409`), not a raw Better Auth `500`. |
| Invalid `role` value (anything other than `ceo`/`leader`/`sales`) | Rejected at request-schema validation, never reaches the database. |
| Seed script run twice | Idempotent no-op if a `ceo` user already exists. |
| Admin endpoint called before the seed has run (no organization yet) | Fails with a clear "organization not set up" error, not a null-pointer crash. |

## Testing

- Unit test for `requireRole()`: allows `ceo`/`leader`, denies `sales`.
- Integration test: direct `POST /auth/sign-up/email` returns `403`.
- Integration test: `POST /api/admin/team-members` as `sales` → `403`; as
  `ceo`/`leader` → `201` with a generated password in the response.
- Integration test: duplicate email → `409` with a clear message.
- Manual/script check: running the seed script twice results in exactly
  one `ceo` user in the database.

## Out of scope for this spec

- Full RBAC enforcement across existing modules (deal/lead ownership
  visibility, inbox assignment scoping, broadcast permissions, developer
  API key access, etc.) — separate future spec, built on `requireRole()`.
- Deactivating/removing team members (the `users.active` field already
  exists and can support this later; no UI for it here).
- Self-service password reset for team members.
- Email notifications on account creation (no SMTP infrastructure
  confirmed available; the one-time-shown generated password is the
  chosen alternative).

Each of the above will be brainstormed and specced separately when needed.
