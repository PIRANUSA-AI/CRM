# Sidebar & Per-Role Page Access Redesign

## Context

This is Stage 1 of the two-stage "make the CRM powerful" effort the user
initiated after the RBAC refactor
(`docs/superpowers/specs/2026-07-09-rbac-refactor-design.md`) landed. Stage 2
(new features — starting with lead source attribution) was paused
mid-brainstorm so this foundational Stage 1 could be finished first: today,
Superadmin, CEO, and Leader all see an effectively identical sidebar because
`role-access.ts` defines each tier as a **superset** of the one below it
(`CEO_PATHS = [...LEADER_PATHS, ...]`, `SUPERADMIN_PATHS = [...CEO_PATHS, ...]`).
That assumption breaks under the roles the user actually wants:

- **CEO** should see *fewer* operational pages than Leader (monitoring/reports
  only), not more.
- **Superadmin** should see *fewer* business-operational pages than CEO
  (technical/IT only), not the union of everything below it.

Separately, investigation of `apps/frontend/src/routes/_app/` found several
pages that exist and work but are unreachable from the sidebar (`analytics`,
`metrics`, `pipeline`, `templates`, `product-stock`, `integration`,
`help`, `developers/*`, `apps/meta-ads-tracker`), plus four files that are
genuinely dead code:

- `apps/index.tsx` and `apps/$appSlug.tsx` — a leftover multi-tenant SaaS
  "app marketplace" concept from before this became a single-tenant internal
  tool, consistent with the SaaS-scaffolding cleanup in commit `7511b12`.
  Zero inbound links anywhere in the app.
- `conversations/$conversationId.tsx` — a 465-line standalone chat view
  superseded by `chat.tsx`, the app's only active chat UI. Zero inbound
  links anywhere in the app.
- `team.tsx` — found during spec-writing (not previously flagged): its
  route (`createFileRoute('/_app/team')`) has a `beforeLoad` that
  unconditionally `redirect()`s to `/kelola-tim` before ever rendering,
  making its entire 2,474-line `AgentsManagementPage` component permanently
  unreachable dead code. `/team` only appears once anywhere in the
  codebase — in the very `role-access.ts` list this spec is replacing.

## Goals

- Replace the nested-superset role/path model with four independent,
  purpose-built page lists — one per role — reflecting what each role
  actually needs, not what the tier below has plus extras.
- Wire every orphan page that has real business value into the sidebar of
  the role(s) it serves.
- Delete the three dead-code route files identified above.
- Gate the two existing in-page tab systems (Handover's queue/rules/roster/logs
  tabs, Settings' tab list) to match the new role philosophy, replacing their
  own nested-superset assumptions the same way.

## Non-goals

- No change to backend `requireRole` guards, the canonical role hierarchy
  (`sales < leader < ceo < superadmin` stays as the grant/permission rank —
  only sidebar *visibility* stops being additive), or any API authorization
  logic. This is a frontend navigation and access-list restructuring only.
- No new pages are built. Orphan pages are wired in as-is; polishing their
  content is out of scope here.
- No changes to the Handover backend (`apps/backend/src/modules/handover`)
  — its endpoints having zero `requireRole` guards was flagged earlier this
  session as a separate, pre-existing security gap. Out of scope for this
  spec; worth a dedicated fix pass later.
- Stage 2 features (lead source attribution, auto-assign, etc.) are
  unaffected and remain paused, to be resumed after this spec ships.

## Role definitions

Four independent roles, each defined by what they actually do day to day —
not by inheritance from the tier below:

- **Sales**: day-to-day operational work only — the conversations, orders,
  and customers assigned to them.
- **Leader**: "Kelola Tim" (team management) plus every operational tool
  needed to run the business day to day — everything Sales has, plus
  product/broadcast/automation/reporting tooling and channel setup.
- **CEO**: monitoring and reporting only. Read-only oversight, not an
  operational user.
- **Superadmin**: technical/IT administration only — developer tools and
  system-level configuration, not day-to-day business operations.

## Sidebar navigation groups

Two new groups are added alongside the four existing ones
(`operasional`, `data`, `outreach`, `otomasi`):

- **`laporan`** (Reports): Analytics, Metrics, Meta Ads Tracker
- **`sistem`** (System): Developers, Integration, Settings

## Per-role page mapping

| Nav item | Path | Group | Sales | Leader | CEO | Superadmin |
|---|---|---|:-:|:-:|:-:|:-:|
| Dashboard | `/dashboard` | operasional | ✅ | ✅ | ✅ | – |
| Inbox | `/chat` | operasional | ✅ | ✅ | – | – |
| Handover | `/handover` | operasional | ✅ (Queue tab only) | ✅ (all tabs) | – | – |
| Orders | `/orders` | operasional | ✅ | ✅ | – | – |
| Kelola Tim | `/kelola-tim` | operasional | – | ✅ | ✅ (read-only) | ✅ |
| Customers | `/customers` | data | ✅ | ✅ | – | – |
| Products | `/products` | data | – | ✅ | – | – |
| Product Stock *(orphan)* | `/product-stock` | data | – | ✅ | – | – |
| Pipeline *(orphan)* | `/pipeline` | data | – | ✅ | – | – |
| Broadcast | `/broadcast` | outreach | – | ✅ | – | – |
| Templates *(orphan)* | `/templates` | outreach | – | ✅ | – | – |
| Workflow | `/flows` | otomasi | – | ✅ | – | – |
| AI Agents | `/ai-agents` | otomasi | – | ✅ | – | – |
| AI Playground | `/ai` | otomasi | – | ✅ | – | – |
| Knowledge Base | `/knowledge` | otomasi | – | ✅ | – | – |
| Analytics *(orphan)* | `/analytics` | laporan | – | ✅ | ✅ | – |
| Metrics *(orphan)* | `/metrics` | laporan | – | ✅ | ✅ | – |
| Meta Ads Tracker *(orphan)* | `/apps/meta-ads-tracker` | laporan | – | ✅ | – | – |
| Integration *(orphan)* | `/integration` | sistem | – | ✅ | – | – |
| Developers *(orphan)* | `/developers` | sistem | – | – | – | ✅ |
| Settings | `/settings` | sistem | ✅ (personal tabs only) | ✅ (full) | ✅ (limited tabs) | ✅ (system tabs) |
| Help *(orphan)* | `/help` | — | ✅ | ✅ | ✅ | ✅ |

Help carries no sensitive data, so it is exempt from per-role gating
entirely — visible to every authenticated role, similar to how public
routes work today.

## Dead code removal

Four files are deleted outright (confirmed via grep: zero `Link`/`navigate`
references anywhere in the app outside the files' own internal cross-links,
and — for the two `apps/` files — no relation to the actively used
`apps/meta-ads-tracker.tsx`, which is kept and wired in per the table above):

- `apps/frontend/src/routes/_app/apps/index.tsx`
- `apps/frontend/src/routes/_app/apps/$appSlug.tsx`
- `apps/frontend/src/routes/_app/conversations/$conversationId.tsx`
- `apps/frontend/src/routes/_app/team.tsx`

TanStack Router's generated route tree (`routeTree.gen.ts`) is regenerated
by the router plugin on the next dev/build run after these files are
deleted — it is not hand-edited.

The Developers hub (`apps/frontend/src/routes/_app/developers/index.tsx`)
needs no content changes: it already renders a `mode="link"` row for every
entry in `developersSubmenuItems` (`developers/-model.ts`) — Webhooks, API
Tools, Messages sent by API, and API Documentation are all already
reachable from that one hub page. Wiring Developers into the sidebar is
exactly one new nav item pointing at `/developers`.

## Architecture: from nested supersets to independent lists

`apps/frontend/src/lib/role-access.ts` currently defines:

```typescript
export const SALES_PATHS = [...]
export const LEADER_PATHS = [...SALES_PATHS, ...]
export const CEO_PATHS = [...LEADER_PATHS, ...]
export const SUPERADMIN_PATHS = [...CEO_PATHS, ...]
```

This becomes four standalone arrays. Each starts from the mapping table
above for that role, plus the non-nav channel sub-paths those pages link
to internally (`/channels/whatsapp`, `/channels/facebook`, `/channels/line`,
`/channels/telegram`, `/channels/livechat`, `/channels/bot`,
`/channels/custom` — reached from the Integration page and Settings'
`whatsapp` tab, not from a sidebar nav item, so they don't appear in the
nav mapping table but still need to be in the allow-list for whichever
roles can reach Integration/Settings). These channel paths follow Leader
and Superadmin (whoever has `/integration` or the `whatsapp` settings tab)
the same way the nav paths do — no separate table needed, just include them
alongside `/settings` and `/integration` in each role's array. `/team` and
`/conversations` are dropped from every list (their routes no longer
exist per the Dead code removal section above).

**Correction found during implementation planning:** `getAllowedPrimaryPathsForRole()`
currently has a `normalizedRole === 'superadmin'` branch that returns `null`,
which means "unrestricted — skip filtering entirely" (see
`isItemVisibleForRole()` in `Sidebar.tsx`: `if (!allowed) return true`).
That was correct under the old nested-superset model, where superadmin
legitimately was a superset of everyone. It is the opposite of what this
spec wants: superadmin is now the *most* restricted role in practice
(technical/IT only, fewer business pages than Leader or even Sales). The
`superadmin` branch must be changed to `return SUPERADMIN_PATHS` — the same
shape as the other three branches — not left returning `null`. Fail-closed
behavior for unrecognized/missing roles (falls through to `SALES_PATHS`)
is unaffected.

`apps/frontend/src/lib/crm-navigation.ts` gets the new nav items (Pipeline,
Templates, Product Stock, Analytics, Metrics, Meta Ads Tracker, Integration,
Developers, Help) added to `CRM_NAV_ITEMS`, and `CrmNavGroup` /
`CRM_GROUP_LABELS` extended with `laporan` and `sistem`. `Sidebar.tsx`
itself needs no logic changes — it already filters `CRM_NAV_ITEMS` through
`getAllowedPrimaryPathsForRole()` and groups by `CRM_GROUP_LABELS`, so new
items and groups flow through automatically once the two lib files are
updated. (Help is excluded from the filtered set and rendered unconditionally
instead, since it isn't role-gated.)

## In-page tab gating

Two existing tab systems currently use the same nested-superset pattern as
`role-access.ts` and need the equivalent fix:

**Handover** (`apps/frontend/src/routes/_app/handover.tsx`): the `tabs` array
(`queue`, `rules`, `roster`, `logs`, built around line 546) is filtered by
role — Sales sees only the `queue` tab (where they claim/handle their own
tickets); Leader, CEO, and Superadmin are out of scope for this page
entirely per the mapping table (only Sales and Leader have `/handover` in
their path list at all, so CEO/Superadmin never reach this page — the tab
filtering only matters for Sales vs. Leader).

**Settings** (`apps/frontend/src/routes/_app/settings-tab-access.ts`):
restructured from nested supersets to four independent lists, following the
same role philosophy as the sidebar:

```typescript
const PERSONAL_TABS: SettingsNavItemId[] = ['security', 'notifications', 'localization']
const SALES_TABS = PERSONAL_TABS
const LEADER_TABS = [...PERSONAL_TABS, 'general', 'ai-models', 'customer-level', 'labels', 'whatsapp']
const CEO_TABS = [...PERSONAL_TABS, 'general']
const SUPERADMIN_TABS = [...PERSONAL_TABS, 'developer', 'whatsapp', 'pakasir']
```

Reasoning: Leader owns all operational business configuration (AI models,
customer levels, labels, channel setup). CEO is monitoring-only, so it gets
just enough to see organization-level info (`general`) alongside personal
tabs — not operational config screens. Superadmin's scope is technical/IT,
so it gets the developer tab plus the technical side of channel/payment
provider config (`whatsapp`, `pakasir`), not day-to-day business settings
like `ai-models`/`customer-level`/`labels` which belong to Leader's
operational domain. This is a judgment call made during spec-writing to
keep the design concrete rather than leaving it open — flag it during spec
review if any of these four tab lists should move.

## Testing

- Update `apps/frontend/src/lib/role-access.test.ts` (already exists, already
  tests the four role tiers) to assert the new independent per-role path
  lists instead of the old superset relationships — in particular, add
  cases proving CEO does **not** get Leader-only paths like `/broadcast` or
  `/ai-agents`, and Superadmin does **not** get business-operational paths
  like `/chat` or `/orders`. Also replace the existing
  `'superadmin is unrestricted'` test (asserts `getAllowedPrimaryPathsForRole('superadmin')`
  is `null`) — per the correction above, it must now equal `SUPERADMIN_PATHS`.
- Update `apps/frontend/src/routes/_app/settings-tab-access.test.ts`
  (already exists) the same way for the four new `*_TABS` lists.
- Manual verification: log in as each of the seven seeded test accounts
  (superadmin/kristian/beni/lukman/nurhayati/tika/lody@piranusa.com) and
  confirm the sidebar matches the mapping table exactly for that role, the
  four deleted routes 404, and `/developers` reaches all four sub-pages
  for the superadmin account.
