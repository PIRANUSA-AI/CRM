# RBAC Refactor Design

## Context

The previous internal-only-auth work (`docs/superpowers/specs/2026-07-08-internal-only-auth-rbac-design.md`)
introduced a new `ceo`/`leader`/`sales` role vocabulary for account
provisioning (Kelola Tim), but deliberately left the pre-existing
`agent`/`supervisor`/`admin` vocabulary untouched because it was assumed to
be "a separate, unrelated concept" scoped to `team.tsx`.

That assumption turned out to be wrong. Grepping the codebase shows
`agent`/`supervisor`/`admin` role strings are hardcoded across the
operational core of the app — conversation handover (`handover/service.ts`),
chatbot follow-ups (`chatbot/followup-service.ts`), the flow decision engine
(`flow/decision-engine-service.ts`), webhook assignment
(`webhook/service.ts`), and CS metrics (`metrics/service.ts`). A user created
today with `role = 'sales'` via Kelola Tim would never receive an
auto-assigned WhatsApp conversation and would never appear in performance
metrics, because none of those queries recognize the new role values.

Separately, a real bug was found and fixed this session: Better Auth's
`user` config never declared `role` as an `additionalField`, so every
sign-in response silently dropped the `role` column. Client-side RBAC
(Sidebar, BottomNav, CommandPalette, the `_app.tsx` route guard) always
received an empty role and fell through to "unrestricted" for every
logged-in user, regardless of their actual role. This is already fixed
(`apps/backend/src/auth.ts`) and verified — this spec builds on top of that
fix, not instead of it.

This project is the first of a larger roadmap (agreed with the user) toward
an AI-driven sales-automation platform inspired by HubSpot/Qontak patterns.
The other pieces — AI-based lead assignment, per-sales AI reply personas,
license-conflict checking against an external spreadsheet, AI-drafted
follow-ups, and a per-sales daily/weekly/monthly task dashboard — are
explicitly **out of scope** here and will each get their own
brainstorm → spec → plan cycle once this RBAC foundation lands.

The project has no production deployment yet (per the repo's `README.md`)
and the database currently holds no real user data — only manually seeded
test accounts. This means the role rename below can be a clean, one-time
replacement rather than a backward-compatible migration.

## Goals

- Replace the two parallel role vocabularies (`ceo/leader/sales` for
  auth+account-management, `agent/supervisor/admin` for operational
  routing/metrics) with a single four-tier vocabulary used everywhere:
  `sales < leader < ceo < superadmin`.
- Make every operational code path (handover, chatbot follow-up, flow
  decision engine, webhook assignment, metrics) recognize the new role
  values, closing the "sales accounts are invisible to routing" gap.
- Define, and enforce both client-side (sidebar/nav) and server-side
  (`requireRole` guards), exactly which pages and API actions each of the
  four roles can reach.
- Add governance so a role can only ever create accounts at or below its
  own tier (a `leader` cannot mint a `ceo`, etc).
- Remove dead route scaffolding left over from when this product was
  planned to be sold as multi-tenant SaaS (it is now confirmed
  internal-only, single-tenant).

## Non-goals

- No changes to `chatbots` (AI agent) ownership model, lead-assignment
  algorithms, license-conflict checking, AI-drafted replies, or the sales
  daily-task dashboard. These are separate future sub-projects.
- No Prisma schema migration. `users.role` stays a plain `String` column;
  this is purely an application-layer value and authorization change.
- No new "developer" role in the `users` table. Codebase maintenance access
  (SSH, direct DB, `git`, PM2) stays outside the app's login system
  entirely, exactly as it works today.

## Role hierarchy

Four account roles, one straight hierarchy — each tier inherits everything
the tier below it can do, plus its own additions:

```
sales  <  leader  <  ceo  <  superadmin
```

- **`sales`** — frontline rep. Scoped to their own assigned conversations,
  orders, and customers only.
- **`leader`** — team lead. Everything `sales` has, but company-wide
  (all sales reps, not just their own), plus team/product/campaign
  management.
- **`ceo`** — business owner. Everything `leader` has, plus financial and
  external-integration concerns (payment gateway config, company-wide
  channel connections).
- **`superadmin`** — technical/system administrator. Everything `ceo` has,
  plus sensitive technical configuration (API keys, webhook config,
  developer tools). Typically held by IT/ops, not necessarily the business
  owner.

**`developer` is explicitly not part of this hierarchy.** It refers to
whoever maintains the codebase and has direct server/database/git access —
access that already exists outside the app's HTTP/session layer and is
unaffected by anything in this spec. No UI, no database row, no guard is
built for it.

## Role assignment governance

To prevent privilege escalation through the account-creation endpoint
itself, each role may only create accounts at or below its own tier:

| Creator role | Can create |
|---|---|
| `leader` | `sales` only |
| `ceo` | `sales`, `leader`, `ceo` |
| `superadmin` | any role, including another `superadmin` |

`sales` cannot create any accounts (matches today's `requireRole(['ceo','leader'])`
gate on `/agents`, now extended to include `superadmin` and checked against
the role value being submitted, not just the caller's role).

## Per-role page & sidebar matrix

| Area | `sales` | `leader` | `ceo` | `superadmin` |
|---|:---:|:---:|:---:|:---:|
| Dashboard | own data | team-wide | ✓ | ✓ |
| Chat / Inbox | own conversations only | all conversations | ✓ | ✓ |
| Orders | own only | all | ✓ | ✓ |
| Customers | own only | all | ✓ | ✓ |
| *AI Agent Saya* (placeholder, future sub-project) | ✓ | — | — | — |
| Kelola Tim (create/manage accounts) | — | ✓ (sales only) | ✓ | ✓ |
| Handover, Conversations, Pipeline | — | ✓ | ✓ | ✓ |
| Products, Product Stock, Broadcast | — | ✓ | ✓ | ✓ |
| Flows/Workflow, AI Agents, AI Playground, Knowledge Base | — | ✓ | ✓ | ✓ |
| Analytics, Metrics, Templates | — | ✓ | ✓ | ✓ |
| Channels (WhatsApp, Facebook, Line, Telegram, Livechat, Bot, Custom) | — | ✓ | ✓ | ✓ |
| Integration, Apps Center (add-on marketplace), Help | — | — | ✓ | ✓ |
| `/developers` (API docs, webhooks, API tools) | — | — | — | ✓ |

### Settings tabs (finer-grained than the top-level page)

| Tab | `sales` | `leader` | `ceo` | `superadmin` |
|---|:---:|:---:|:---:|:---:|
| Notifications, Security, Localization (own account) | ✓ | ✓ | ✓ | ✓ |
| General, AI Models, Customer Level, Labels | — | ✓ | ✓ | ✓ |
| Teams *(being folded into Kelola Tim — see Cleanup)* | — | ✓ | ✓ | ✓ |
| Pakasir (payment gateway — used for customer order checkout, not SaaS billing), WhatsApp (company-level channel config) | — | — | ✓ | ✓ |
| Developer Tools | — | — | — | ✓ |

## Backend changes

1. **`apps/backend/src/lib/require-role.ts`** — expand
   `CANONICAL_ROLES` to `['sales', 'leader', 'ceo', 'superadmin'] as const`.
   Remove the `LEGACY_AGENT_ROLES` bridging set from
   `apps/backend/src/modules/agent/service.ts` — it is no longer needed
   once the rename is complete.
2. Add two derived constants (single source of truth, consumed by the
   operational modules below instead of each hardcoding its own literal
   array):
   - `CHAT_ASSIGNABLE_ROLES = ['sales', 'leader']` — who can receive an
     auto-assigned conversation (replaces `['agent','supervisor']` in
     `chatbot/followup-service.ts`, `flow/decision-engine-service.ts`,
     `webhook/service.ts`).
   - `STAFF_ROSTER_ROLES = ['sales', 'leader', 'ceo']` — who appears in the
     staff roster / CS metrics (replaces `['agent','supervisor','admin']`
     in `handover/service.ts` `getRoster()` and `metrics/service.ts`).
3. Extend the role-value validation added in `5f29e86` (currently
   `isValidAgentRole` accepting canonical + legacy sets) to enforce the
   creator-tier governance table above — reject `POST`/`PATCH /agents`
   when the caller's role is not high enough to grant the requested role
   value, returning a 400/403 with a clear message.
4. Add `requireRole()` guards to endpoints that currently have none but
   sit behind sensitive settings tabs identified above: Pakasir config,
   company-level WhatsApp channel config, and the `/developers`
   (API docs/webhooks/API tools) routes. Today only `/agents` is guarded;
   hiding a sidebar link is not a security boundary.
5. **Row-level data scoping for `sales`.** Everything above only controls
   which *pages* a role can reach — it does not filter which *rows* an API
   returns. Today, conversation/order/customer list endpoints return all
   records to anyone who can reach the page; there is no per-user
   ownership filter. To make "`sales` sees only their own conversations,
   orders, and customers" actually true (not just true of the sidebar),
   the conversation, order, and customer list/detail endpoints need a
   `WHERE assignee_id = currentUserId` (or equivalent) filter applied when
   the caller's role is `sales`. `leader` and above keep the current
   unfiltered, company-wide behavior. This is the single most invasive
   change in this spec — it touches query logic in modules that today
   have none of this filtering, and needs its own careful pass per
   endpoint during implementation planning.

## Frontend changes

1. **`apps/frontend/src/lib/role-access.ts`** — rewrite
   `getAllowedPrimaryPathsForRole` so each tier's path list is built by
   composing the tier below it plus its own additions, instead of four
   independent flat arrays that have to be kept in sync by hand.
2. Sidebar, BottomNav, CommandPalette, and the `_app.tsx` route guard need
   **no structural changes** — they already read from the single
   `getAllowedPrimaryPathsForRole` choke point, which is why fixing the
   Better Auth `role` field was sufficient to make them work correctly.
3. Add per-tab gating inside `apps/frontend/src/routes/_app/settings.tsx`
   (currently every tab renders for anyone who can reach `/settings` at
   all) matching the Settings tab table above.
4. Fold the "Teams" settings tab (`<AgentsManagementPage mode="roles" initialTab="teams" />`,
   which renders the exact same component as the old `team.tsx`) into
   Kelola Tim, so there is one place to manage accounts, not two competing
   UIs using two different role vocabularies.

## Dead code cleanup

Confirmed empty or alias-only during this session — remove from the role
matrix and delete from the codebase (leftover from when this product was
planned as multi-tenant SaaS, before the Crm internal-only rebrand):

- `apps/frontend/src/routes/_app/billing/` (empty)
- `apps/frontend/src/routes/_app/subscription/` (empty)
- `apps/frontend/src/routes/_app/top-up/` (empty)
- `apps/frontend/src/routes/_app/outbound.tsx` (redirects to `/broadcast`, not a real page)
- `apps/frontend/src/routes/_app/instagram/` (empty)
- `apps/frontend/src/routes/_app/channels/instagram/` (empty)
- `apps/frontend/src/routes/_app/channels/tiktok/` (empty)

## Data migration

No schema migration — `role` stays a plain string column. Migration is
purely a value rename, and only in the (test-only) dev database today:
`agent → sales`, `supervisor → leader`, `admin → ceo`, plus introducing
`superadmin` as a new value. The three test accounts seeded this session
(`admin@test.com`, `supervisor@test.com`, `agent@test.com`) will be
recreated under the new role names as part of implementation verification.

## Testing

- Extend the existing test pattern (`agent-role-guard.test.ts`,
  `agent-role-validation.test.ts`, `role-access.test.ts`) to cover all four
  roles instead of the current three.
- Add tests for the creator-tier governance table (a `leader` request to
  create a `ceo` account must be rejected, etc).
- Add tests asserting `CHAT_ASSIGNABLE_ROLES` / `STAFF_ROSTER_ROLES` are
  actually consumed by `handover`, `followup-service`,
  `decision-engine-service`, `webhook/service.ts`, and `metrics/service.ts`
  (a `sales` user must be eligible for auto-assignment and must appear in
  metrics).
- Manual verification checklist: log in as each of the four roles, confirm
  the sidebar differs as specified, and confirm server-side 403s via
  direct `curl` calls to out-of-tier endpoints (not just UI button
  visibility) for at least one endpoint per tier boundary.

## Explicitly deferred (future specs, in this order)

1. Lead intake & AI-based assignment (routing algorithm, WhatsApp number
   per sales rep, promo/ad source attribution)
2. Per-sales AI reply persona (`chatbots` ownership model)
3. License-conflict checking against an external spreadsheet dataset
4. AI-drafted one-click reply/follow-up, with category types (follow-up,
   license-expiry reminder, new product offer, promo offer)
5. Per-sales daily/weekly/monthly task dashboard
