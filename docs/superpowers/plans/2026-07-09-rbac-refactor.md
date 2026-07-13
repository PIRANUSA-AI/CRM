# RBAC Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two parallel role vocabularies (`ceo/leader/sales` for auth, `agent/supervisor/admin` for operational routing) with one four-tier vocabulary — `sales < leader < ceo < superadmin` — enforced consistently in the database, every backend route, and the frontend nav/settings gating.

**Architecture:** `users.role` stays a plain string column (no schema migration). A single shared module (`apps/backend/src/lib/require-role.ts`) becomes the one source of truth for the role list, the role hierarchy/rank, and the derived role-group constants that operational modules (handover, chatbot, flow, webhook, metrics) consume instead of hardcoding their own literal arrays. The frontend mirrors this with one composable tier list in `role-access.ts` that every nav/guard component already reads from.

**Tech Stack:** Existing stack, unchanged — Bun, Elysia, Prisma/PostgreSQL, Better Auth, TanStack Start/React frontend, `bun test` (backend), `vitest` (frontend).

## Global Constraints

- No Prisma schema migration — `role` stays `String` on `users`.
- No new "developer" role in the `users` table or anywhere in the app's auth system — codebase maintenance access (SSH/DB/git) stays outside the app entirely, per the spec's non-goals.
- Every new/modified endpoint that needs a role check must go through `requireRole()` — no ad-hoc string comparisons (matches the existing project convention from the prior internal-auth plan).
- `role-access.ts`'s unknown/missing-role fallback changes from "unrestricted" to "most restrictive tier" (see Task 8) — this is a deliberate security fix, not a regression: the Better-Auth `role`-field bug fixed earlier this session means an empty role should never again silently mean "sees everything."
- Do not touch `apps/frontend/src/routes/_app/flows/$flowId.tsx:1339-1354`, `apps/backend/src/modules/flow/runtime-service.ts:26-35,2407-2423`, or `apps/backend/src/modules/flow/decision-engine-service.ts:110-131` — these `'agent'`/`'admin'` strings are WhatsApp-history sender-type normalization and intent-keyword lists (LLM prompt roles / handover trigger phrases), not RBAC permission roles. Confirmed by direct inspection this session; touching them is out of scope and would break AI conversation history formatting.
- Do not touch `apps/frontend/src/lib/organization.ts`'s `'owner' | 'admin' | 'member'` role type — that's Better Auth's own organization-membership concept (a separate axis), untouched per the spec.

---

### Task 1: Expand canonical roles and add role-grant governance

**Files:**
- Modify: `apps/backend/src/lib/require-role.ts`
- Test: `apps/backend/test/require-role.test.ts`

**Interfaces:**
- Consumes: `prisma` (existing).
- Produces: `CANONICAL_ROLES = ['sales', 'leader', 'ceo', 'superadmin'] as const`, `type CanonicalRole`, `requireRole()` (unchanged signature), `ROLE_RANK: Record<CanonicalRole, number>`, `canGrantRole(granterRole: string, targetRole: string): boolean`. `canGrantRole` and `ROLE_RANK` are consumed by Task 2.

- [ ] **Step 1: Write the failing test**

Replace the contents of `apps/backend/test/require-role.test.ts` with:

```typescript
// apps/backend/test/require-role.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import prisma from '../src/lib/prisma'
import { requireRole, canGrantRole, CANONICAL_ROLES } from '../src/lib/require-role'

let ceoId: string
let salesId: string

beforeAll(async () => {
	const ceo = await prisma.users.create({
		data: { name: 'Test CEO', email: `ceo-${Date.now()}@test.local`, role: 'ceo' },
	})
	ceoId = ceo.id
	const sales = await prisma.users.create({
		data: { name: 'Test Sales', email: `sales-${Date.now()}@test.local`, role: 'sales' },
	})
	salesId = sales.id
})

afterAll(async () => {
	await prisma.users.deleteMany({ where: { id: { in: [ceoId, salesId] } } })
})

describe('requireRole', () => {
	test('allows a user whose role is in the allowed list', async () => {
		const result = await requireRole(ceoId, ['ceo', 'leader'])
		expect(result.ok).toBe(true)
	})

	test('denies a user whose role is not in the allowed list', async () => {
		const result = await requireRole(salesId, ['ceo', 'leader'])
		expect(result.ok).toBe(false)
		if (!result.ok) expect(result.status).toBe(403)
	})

	test('denies when userId is null (not logged in)', async () => {
		const result = await requireRole(null, ['ceo', 'leader'])
		expect(result.ok).toBe(false)
	})

	test('CANONICAL_ROLES has the four expected tiers in ascending order', () => {
		expect(CANONICAL_ROLES).toEqual(['sales', 'leader', 'ceo', 'superadmin'])
	})
})

describe('canGrantRole', () => {
	test('leader can grant sales', () => {
		expect(canGrantRole('leader', 'sales')).toBe(true)
	})

	test('leader cannot grant leader', () => {
		expect(canGrantRole('leader', 'leader')).toBe(false)
	})

	test('leader cannot grant ceo', () => {
		expect(canGrantRole('leader', 'ceo')).toBe(false)
	})

	test('ceo can grant sales, leader, and ceo', () => {
		expect(canGrantRole('ceo', 'sales')).toBe(true)
		expect(canGrantRole('ceo', 'leader')).toBe(true)
		expect(canGrantRole('ceo', 'ceo')).toBe(true)
	})

	test('ceo cannot grant superadmin', () => {
		expect(canGrantRole('ceo', 'superadmin')).toBe(false)
	})

	test('superadmin can grant any role including superadmin', () => {
		expect(canGrantRole('superadmin', 'sales')).toBe(true)
		expect(canGrantRole('superadmin', 'ceo')).toBe(true)
		expect(canGrantRole('superadmin', 'superadmin')).toBe(true)
	})

	test('sales cannot grant anything', () => {
		expect(canGrantRole('sales', 'sales')).toBe(false)
	})

	test('an unrecognized target role is never grantable', () => {
		expect(canGrantRole('superadmin', 'made-up-role')).toBe(false)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/require-role.test.ts`
Expected: FAIL — `canGrantRole` and updated `CANONICAL_ROLES` don't exist yet.

- [ ] **Step 3: Write the implementation**

Replace the contents of `apps/backend/src/lib/require-role.ts` with:

```typescript
// apps/backend/src/lib/require-role.ts
import prisma from './prisma'

export const CANONICAL_ROLES = ['sales', 'leader', 'ceo', 'superadmin'] as const
export type CanonicalRole = (typeof CANONICAL_ROLES)[number]

export const ROLE_RANK: Record<CanonicalRole, number> = {
	sales: 0,
	leader: 1,
	ceo: 2,
	superadmin: 3,
}

// Roles eligible to receive an auto-assigned conversation (day-to-day CS work).
export const CHAT_ASSIGNABLE_ROLES: CanonicalRole[] = ['sales', 'leader']

// Roles that appear in the staff roster / CS metrics reporting.
export const STAFF_ROSTER_ROLES: CanonicalRole[] = ['sales', 'leader', 'ceo']

type RequireRoleResult =
	| { ok: true; role: string }
	| { ok: false; status: number; error: string }

export async function requireRole(
	userId: string | null,
	allowedRoles: CanonicalRole[],
): Promise<RequireRoleResult> {
	if (!userId) {
		return { ok: false, status: 403, error: 'Not authenticated' }
	}

	const user = await prisma.users.findUnique({
		where: { id: userId },
		select: { role: true },
	})

	if (!user || !allowedRoles.includes(user.role as CanonicalRole)) {
		return { ok: false, status: 403, error: 'Not authorized' }
	}

	return { ok: true, role: user.role as string }
}

/**
 * A role may only grant accounts at or below its own tier. A `leader`
 * cannot mint a `ceo`; only `superadmin` can mint another `superadmin`.
 */
export function canGrantRole(granterRole: string, targetRole: string): boolean {
	if (!CANONICAL_ROLES.includes(granterRole as CanonicalRole)) return false
	if (!CANONICAL_ROLES.includes(targetRole as CanonicalRole)) return false
	return ROLE_RANK[targetRole as CanonicalRole] <= ROLE_RANK[granterRole as CanonicalRole]
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/require-role.test.ts`
Expected: PASS (all tests green) — requires a reachable dev database.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/lib/require-role.ts apps/backend/test/require-role.test.ts
git commit -m "feat: expand canonical roles to sales/leader/ceo/superadmin, add grant governance"
```

---

### Task 2: Enforce grant governance and drop legacy role bridging in agent creation

**Files:**
- Modify: `apps/backend/src/modules/agent/service.ts`
- Modify: `apps/backend/src/modules/agent/index.ts`
- Modify: `apps/backend/test/agent-role-validation.test.ts`
- Modify: `apps/backend/test/agent-role-guard.test.ts`

**Interfaces:**
- Consumes: `canGrantRole`, `CANONICAL_ROLES` (Task 1).
- Produces: `POST /agents` and `PATCH/PUT /agents/:id` now reject (403, `"Cannot grant a role higher than your own"`) when the caller's role cannot grant the requested `role` value, in addition to the existing 403 for callers outside `['ceo','leader']`. The `requireRole` guard on these three routes is widened to `['leader', 'ceo', 'superadmin']` (sales still fully excluded).

- [ ] **Step 1: Write the failing test**

Replace the contents of `apps/backend/test/agent-role-validation.test.ts` with (this replaces the old `superadmin`/legacy-role scenarios):

```typescript
// apps/backend/test/agent-role-validation.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import prisma from '../src/lib/prisma'
import { app } from '../src/index'

let appId: string
let createdAppId: string | null = null
let leaderId: string
let ceoId: string
let leaderSessionToken: string
let ceoSessionToken: string
const createdEmails: string[] = []

async function createSessionForUser(userId: string): Promise<string> {
	const token = `test-session-${userId}`
	await prisma.session.create({
		data: { id: crypto.randomUUID(), token, userId, expiresAt: new Date(Date.now() + 60_000) },
	})
	return token
}

beforeAll(async () => {
	const org = await prisma.apps.findFirst({ select: { id: true } })
	if (org) {
		appId = org.id
	} else {
		const seeded = await prisma.apps.create({
			data: {
				app_id: `role-validation-test-${Date.now()}`,
				app_name: 'Role Validation Test App',
				business_name: 'Role Validation Test Business',
			},
			select: { id: true },
		})
		appId = seeded.id
		createdAppId = seeded.id
	}

	const leader = await prisma.users.create({
		data: { name: 'Role Validation Leader', email: `role-validation-leader-${Date.now()}@test.local`, role: 'leader', app_id: appId || null },
	})
	leaderId = leader.id
	leaderSessionToken = await createSessionForUser(leaderId)

	const ceo = await prisma.users.create({
		data: { name: 'Role Validation CEO', email: `role-validation-ceo-${Date.now()}@test.local`, role: 'ceo', app_id: appId || null },
	})
	ceoId = ceo.id
	ceoSessionToken = await createSessionForUser(ceoId)
})

afterAll(async () => {
	await prisma.session.deleteMany({ where: { userId: { in: [leaderId, ceoId] } } })
	await prisma.users.deleteMany({ where: { email: { in: createdEmails } } })
	await prisma.users.deleteMany({ where: { id: { in: [leaderId, ceoId] } } })
	if (createdAppId) {
		await prisma.apps.delete({ where: { id: createdAppId } })
	}
})

function createAgentRequest(token: string, role: string | undefined) {
	const email = `role-validation-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`
	createdEmails.push(email)
	return new Request(`http://localhost/agents?appId=${appId}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ name: 'Role Validation Hire', email, ...(role !== undefined ? { role } : {}) }),
	})
}

describe('POST /agents role value validation', () => {
	test('rejects an explicitly invalid role with 400', async () => {
		const response = await app.handle(createAgentRequest(ceoSessionToken, 'superadmin-typo'))
		expect(response.status).toBe(400)
		const body = await response.json()
		expect(body.error).toBe('Invalid role value')
	})

	test.each(['sales', 'leader', 'ceo', 'superadmin'])('accepts canonical role %s', async (role) => {
		const response = await app.handle(createAgentRequest(ceoSessionToken, role))
		expect(response.status).toBe(200)
	})

	test('omitting role entirely still works with the existing default', async () => {
		const response = await app.handle(createAgentRequest(ceoSessionToken, undefined))
		expect(response.status).toBe(200)
		const body = await response.json()
		expect(body.data.role).toBe('sales')
	})
})

describe('POST /agents grant governance', () => {
	test('leader can create a sales account', async () => {
		const response = await app.handle(createAgentRequest(leaderSessionToken, 'sales'))
		expect(response.status).toBe(200)
	})

	test('leader cannot create a leader account', async () => {
		const response = await app.handle(createAgentRequest(leaderSessionToken, 'leader'))
		expect(response.status).toBe(403)
		const body = await response.json()
		expect(body.error).toBe('Cannot grant a role higher than your own')
	})

	test('leader cannot create a ceo account', async () => {
		const response = await app.handle(createAgentRequest(leaderSessionToken, 'ceo'))
		expect(response.status).toBe(403)
	})

	test('ceo can create a leader account', async () => {
		const response = await app.handle(createAgentRequest(ceoSessionToken, 'leader'))
		expect(response.status).toBe(200)
	})

	test('ceo cannot create a superadmin account', async () => {
		const response = await app.handle(createAgentRequest(ceoSessionToken, 'superadmin'))
		expect(response.status).toBe(403)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/agent-role-validation.test.ts`
Expected: FAIL — `role: 'sales'` currently defaults on omit to `'agent'` not present, `superadmin` isn't a recognized canonical role yet, and there is no grant-governance check at all (a `leader` creating a `leader`/`ceo` currently succeeds with 200).

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/modules/agent/service.ts`, replace the top of the file (lines 1–21) with:

```typescript
import bcrypt from 'bcryptjs'
import { syncBetterAuthCredentialAccount } from '../../lib/better-auth-credentials'
import type { Prisma } from '../../generated/prisma'
import { ensureBetterAuthOrganizationMembership } from '../../lib/organization-membership'
import { generateStrongPassword } from '../../lib/generate-password'
import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'
import { CANONICAL_ROLES } from '../../lib/require-role'

type DbTx = Prisma.TransactionClient

function isValidAgentRole(role: unknown): boolean {
	return CANONICAL_ROLES.includes(role as (typeof CANONICAL_ROLES)[number])
}
```

Then find the two `data.role || 'agent'` defaults inside `createAgent` (the role default used when the caller omits `role`) and change `'agent'` to `'sales'`:

```typescript
					role: data.role || 'sales',
```

(This is the same line shown at plan-authoring time as `role: data.role || 'agent',` inside the `tx.users.create` call in `createAgent` — the only literal `'agent'` default in this file.)

In `apps/backend/src/modules/agent/index.ts`, add the import and widen/extend all three guards. Replace the import line:

```typescript
import { requireRole } from '../../lib/require-role'
```

with:

```typescript
import { requireRole, canGrantRole } from '../../lib/require-role'
```

Then replace each of the three identical guard blocks —

```typescript
			const guard = await requireRole(userId, ['ceo', 'leader'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
```

(appearing in the `POST '/'` handler, the `PATCH '/:id'` handler, and the `PUT '/:id'` handler) — with:

```typescript
			const guard = await requireRole(userId, ['leader', 'ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (body.role !== undefined && !canGrantRole(guard.role, body.role)) {
				set.status = 403
				return { error: 'Cannot grant a role higher than your own' }
			}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/agent-role-validation.test.ts test/agent-role-guard.test.ts test/require-role.test.ts`
Expected: PASS (all green). `agent-role-guard.test.ts` continues to pass unmodified — it only asserts `sales` (previously `agent`-equivalent caller) gets 403 and `ceo` gets 200, both still true.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/agent/service.ts apps/backend/src/modules/agent/index.ts apps/backend/test/agent-role-validation.test.ts
git commit -m "feat: enforce role-grant governance on agent create/update, default new hires to sales"
```

---

### Task 3: Wire shared role-group constants into operational routing and metrics

**Files:**
- Modify: `apps/backend/src/modules/handover/service.ts` (lines 281, 781, 1114, 1157)
- Modify: `apps/backend/src/modules/handover/index.ts` (line 110)
- Modify: `apps/backend/src/modules/chatbot/followup-service.ts` (line 1445)
- Modify: `apps/backend/src/modules/flow/decision-engine-service.ts` (line 1496)
- Modify: `apps/backend/src/modules/flow/runtime-service.ts` (line 3976)
- Modify: `apps/backend/src/modules/webhook/service.ts` (lines 2908, 2924)
- Modify: `apps/backend/src/modules/metrics/service.ts` (line 1175)
- Test: `apps/backend/test/operational-role-routing.test.ts`

**Interfaces:**
- Consumes: `CHAT_ASSIGNABLE_ROLES`, `STAFF_ROSTER_ROLES` (Task 1).
- Produces: a `sales`-role user is now eligible for auto-assignment (handover roster, chatbot follow-up fallback, flow decision-engine best-assignee, webhook assignment) and appears in CS metrics — closing the gap where new-vocabulary accounts were invisible to all of this.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/test/operational-role-routing.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import prisma from '../src/lib/prisma'
import { HandoverService } from '../src/modules/handover/service'
import { FlowDecisionEngineService } from '../src/modules/flow/decision-engine-service'

let appId: string
let salesId: string

beforeAll(async () => {
	const app = await prisma.apps.create({
		data: {
			app_id: `op-routing-test-${Date.now()}`,
			app_name: 'Op Routing Test',
			business_name: 'Op Routing Test',
		},
	})
	appId = app.id
	const sales = await prisma.users.create({
		data: {
			name: 'Routing Sales',
			email: `routing-sales-${Date.now()}@test.local`,
			role: 'sales',
			app_id: appId,
			active: true,
		},
	})
	salesId = sales.id
})

afterAll(async () => {
	await prisma.users.deleteMany({ where: { id: salesId } })
	await prisma.apps.deleteMany({ where: { id: appId } })
})

describe('sales role is recognized by operational routing', () => {
	test('appears in the handover roster', async () => {
		const roster = await HandoverService.getRoster(appId)
		expect(roster.some((r) => r.id === salesId)).toBe(true)
	})

	test('is a valid candidate for flow decision-engine assignment', async () => {
		const assigneeId = await FlowDecisionEngineService.resolveBestAssignee({
			appId,
			intent: null,
			candidateAgentIds: [salesId],
		})
		expect(assigneeId).toBe(salesId)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/operational-role-routing.test.ts`
Expected: FAIL — `role: { in: ['agent', 'supervisor', 'admin'] }` / `['agent', 'supervisor']` in the modules above don't recognize `'sales'`, so both assertions fail (roster empty, assignee resolves to `null`).

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/modules/handover/service.ts`, add the import at the top of the file:

```typescript
import { CHAT_ASSIGNABLE_ROLES, STAFF_ROSTER_ROLES } from '../../lib/require-role'
```

Replace line 1114 —
```typescript
					role: { in: ['agent', 'supervisor', 'admin'] },
```
with:
```typescript
					role: { in: STAFF_ROSTER_ROLES },
```

Replace line 781 —
```typescript
				role: { in: ['supervisor', 'admin'] },
```
with:
```typescript
				role: { in: ['leader', 'ceo', 'superadmin'] },
```

Replace line 1157 —
```typescript
				role: user.role || 'agent',
```
with:
```typescript
				role: user.role || 'sales',
```

Replace line 281 —
```typescript
		const isSupervisorOrAdmin = userRole === 'supervisor' || userRole === 'admin'
```
with:
```typescript
		const isSupervisorOrAdmin = userRole === 'leader' || userRole === 'ceo' || userRole === 'superadmin'
```

In `apps/backend/src/modules/handover/index.ts`, replace line 110 —
```typescript
			const userRole = userObj?.role || 'agent'
```
with:
```typescript
			const userRole = userObj?.role || 'sales'
```

In `apps/backend/src/modules/chatbot/followup-service.ts`, add the import:
```typescript
import { CHAT_ASSIGNABLE_ROLES } from '../../lib/require-role'
```
Replace line 1445 —
```typescript
			role: { in: ['agent', 'supervisor'] },
```
with:
```typescript
			role: { in: CHAT_ASSIGNABLE_ROLES },
```

In `apps/backend/src/modules/flow/decision-engine-service.ts`, add the import and replace line 1496 the same way:
```typescript
import { CHAT_ASSIGNABLE_ROLES } from '../../lib/require-role'
```
```typescript
				role: { in: CHAT_ASSIGNABLE_ROLES },
```

In `apps/backend/src/modules/flow/runtime-service.ts`, add the import and replace line 3976 the same way:
```typescript
import { CHAT_ASSIGNABLE_ROLES } from '../lib/require-role'
```
```typescript
					role: { in: CHAT_ASSIGNABLE_ROLES },
```
(Adjust the relative import depth to match this file's actual nesting — `runtime-service.ts` sits directly in `modules/flow/`, same depth as `decision-engine-service.ts`, so the import path is identical: `'../../lib/require-role'`.)

In `apps/backend/src/modules/webhook/service.ts`, add the import and replace both occurrences (lines 2908 and 2924):
```typescript
import { CHAT_ASSIGNABLE_ROLES } from '../../lib/require-role'
```
```typescript
					role: { in: CHAT_ASSIGNABLE_ROLES },
```

In `apps/backend/src/modules/metrics/service.ts`, replace line 1175 —
```typescript
			  AND LOWER(COALESCE(u.role, 'agent')) IN ('agent', 'supervisor', 'admin')
```
with:
```typescript
			  AND LOWER(COALESCE(u.role, 'sales')) IN ('sales', 'leader', 'ceo')
```
(This file builds a raw SQL string, so the values are inlined directly rather than imported — keep this literal list in sync with `STAFF_ROSTER_ROLES` by eye; it cannot import a TS constant into a SQL template.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/operational-role-routing.test.ts`
Expected: PASS (2 pass).

Then run the full backend test suite to confirm nothing regressed:

Run: `cd apps/backend && bun test`
Expected: no new failures beyond the pre-existing, unrelated ones (webhook-formatter mocks, meta-api fetch mocks — confirmed present before this plan, tracked separately).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/handover apps/backend/src/modules/chatbot/followup-service.ts apps/backend/src/modules/flow/decision-engine-service.ts apps/backend/src/modules/flow/runtime-service.ts apps/backend/src/modules/webhook/service.ts apps/backend/src/modules/metrics/service.ts apps/backend/test/operational-role-routing.test.ts
git commit -m "feat: recognize sales/leader/ceo in handover, flow, chatbot, webhook, and metrics routing"
```

---

### Task 4: Guard Pakasir, WhatsApp channel, and developer-tooling endpoints

**Files:**
- Modify: `apps/backend/src/modules/commerce/index.ts` (lines 438–474)
- Modify: `apps/backend/src/modules/whatsapp/index.ts` (lines 367–424)
- Modify: `apps/backend/src/modules/developer-keys/index.ts`
- Modify: `apps/backend/src/modules/webhook/index.ts` (lines 144–186)
- Modify: `apps/backend/src/modules/api-tools/index.ts` (lines 42–90)
- Test: `apps/backend/test/sensitive-endpoint-guards.test.ts`

**Interfaces:**
- Consumes: `requireRole` (Task 1, unchanged signature).
- Produces: Pakasir settings (`GET`/`PATCH /commerce/settings/pakasir`) and company WhatsApp channel writes (`POST /whatsapp`, `PATCH /whatsapp/:id`, `DELETE /whatsapp/:id`) now require `['ceo', 'superadmin']`. Developer Keys, Webhooks, and API Tools routes now require `['superadmin']`. These endpoints currently have **no role check at all** — confirmed by direct inspection this session — so this task is a pure addition, no existing behavior to preserve beyond "still works for `ceo`/`superadmin`."

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/test/sensitive-endpoint-guards.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import prisma from '../src/lib/prisma'
import { app } from '../src/index'

let leaderId: string
let ceoId: string
let superadminId: string
let leaderToken: string
let ceoToken: string
let superadminToken: string

async function createSessionForUser(userId: string): Promise<string> {
	const token = `test-session-${userId}`
	await prisma.session.create({
		data: { id: crypto.randomUUID(), token, userId, expiresAt: new Date(Date.now() + 60_000) },
	})
	return token
}

beforeAll(async () => {
	const leader = await prisma.users.create({
		data: { name: 'Guard Leader', email: `guard-leader-${Date.now()}@test.local`, role: 'leader' },
	})
	leaderId = leader.id
	leaderToken = await createSessionForUser(leaderId)

	const ceo = await prisma.users.create({
		data: { name: 'Guard CEO', email: `guard-ceo-${Date.now()}@test.local`, role: 'ceo' },
	})
	ceoId = ceo.id
	ceoToken = await createSessionForUser(ceoId)

	const superadmin = await prisma.users.create({
		data: { name: 'Guard Superadmin', email: `guard-superadmin-${Date.now()}@test.local`, role: 'superadmin' },
	})
	superadminId = superadmin.id
	superadminToken = await createSessionForUser(superadminId)
})

afterAll(async () => {
	await prisma.session.deleteMany({ where: { userId: { in: [leaderId, ceoId, superadminId] } } })
	await prisma.users.deleteMany({ where: { id: { in: [leaderId, ceoId, superadminId] } } })
})

describe('Pakasir settings guard', () => {
	test('leader is rejected', async () => {
		const response = await app.handle(
			new Request('http://localhost/commerce/settings/pakasir', {
				headers: { authorization: `Bearer ${leaderToken}` },
			}),
		)
		expect(response.status).toBe(403)
	})

	test('ceo is allowed through the guard (may still fail later for other reasons, but not 403)', async () => {
		const response = await app.handle(
			new Request('http://localhost/commerce/settings/pakasir', {
				headers: { authorization: `Bearer ${ceoToken}` },
			}),
		)
		expect(response.status).not.toBe(403)
	})
})

describe('Developer Keys guard', () => {
	test('ceo is rejected (superadmin-only)', async () => {
		const response = await app.handle(
			new Request('http://localhost/developer_keys', {
				headers: { authorization: `Bearer ${ceoToken}` },
			}),
		)
		expect(response.status).toBe(403)
	})

	test('superadmin is allowed through the guard', async () => {
		const response = await app.handle(
			new Request('http://localhost/developer_keys', {
				headers: { authorization: `Bearer ${superadminToken}` },
			}),
		)
		expect(response.status).not.toBe(403)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/sensitive-endpoint-guards.test.ts`
Expected: FAIL — every request currently returns whatever the unguarded handler returns (likely a 400 "Business ID required" or 200), never a 403, because no role check exists yet.

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/modules/commerce/index.ts`, add the import near the top:
```typescript
import { requireRole } from '../../lib/require-role'
```
Then add a guard as the first line inside both the `GET '/commerce/settings/pakasir'` and `PATCH '/commerce/settings/pakasir'` handlers, e.g. the `GET` becomes:
```typescript
		.get(
			'/commerce/settings/pakasir',
			async ({ resolvedAppId, request, headers, userId, set }) => {
				const guard = await requireRole(userId, ['ceo', 'superadmin'])
				if (!guard.ok) {
					set.status = guard.status
					return { error: guard.error }
				}
				if (!resolvedAppId) return unauthorized(set)
				try {
					const data = await CommerceService.getPakasirSettings(
						resolvedAppId,
						request.url,
						headers as Record<string, unknown>,
					)
					return { message: 'success', data }
				} catch (error) {
					return badRequest(set, error)
				}
			},
		)
```
and the `PATCH` gets the identical three-line guard inserted as its first statement (using the `userId` already destructured in that handler).

In `apps/backend/src/modules/whatsapp/index.ts`, add the same import and insert the guard as the first statement in the `POST '/'`, `PATCH '/:id'`, and `DELETE '/:id'` handlers — e.g. `POST '/'` becomes:
```typescript
		.post(
			'/',
			async ({ resolvedAppId, body, userId, set }) => {
				const guard = await requireRole(userId, ['ceo', 'superadmin'])
				if (!guard.ok) {
					set.status = guard.status
					return { error: guard.error }
				}
				if (!resolvedAppId) {
					set.status = 400
					return { error: 'App ID required' }
				}
				try {
					const channel = await WhatsAppService.createChannel(body, resolvedAppId)
					return { data: channel }
				} catch (error: any) {
					// ... unchanged catch block
				}
			},
			{ body: WhatsAppRequestModel.create },
		)
```
(`PATCH '/:id'` and `DELETE '/:id'` need `userId` added to their destructured route params, since neither currently reads it — add `userId` alongside the existing `params`/`body`/`set` in each handler's arguments, then insert the same three-line guard as their first statement.)

In `apps/backend/src/modules/developer-keys/index.ts`, add the import and insert the guard as the first statement of the `GET '/'` and `POST '/regenerate'` handlers, using `['superadmin']`:
```typescript
import { requireRole } from '../../lib/require-role'
```
```typescript
				const guard = await requireRole(userId, ['superadmin'])
				if (!guard.ok) {
					set.status = guard.status
					return { error: guard.error }
				}
```
(`userId` is already destructured in neither handler per the research — add it alongside `query, headers, orgId, resolvedAppId, request, set`.)

In `apps/backend/src/modules/webhook/index.ts`, add `userId` to the `GET '/'`, `POST '/'`, and `DELETE '/:id'` handler params and insert the same `requireRole(userId, ['superadmin'])` guard as their first statement.

In `apps/backend/src/modules/api-tools/index.ts`, add `userId` to the `GET '/'` and `PUT '/'` handler params and insert the same `requireRole(userId, ['superadmin'])` guard as their first statement.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/sensitive-endpoint-guards.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/commerce/index.ts apps/backend/src/modules/whatsapp/index.ts apps/backend/src/modules/developer-keys/index.ts apps/backend/src/modules/webhook/index.ts apps/backend/src/modules/api-tools/index.ts apps/backend/test/sensitive-endpoint-guards.test.ts
git commit -m "feat: guard Pakasir, WhatsApp channel writes, and developer-tooling endpoints with requireRole"
```

---

### Task 5: Row-level scoping for `sales` on conversations

**Files:**
- Modify: `apps/backend/src/modules/conversation/index.ts` (lines 82–108)
- Modify: `apps/backend/src/modules/conversation/service.ts` (lines 571–596)
- Test: `apps/backend/test/conversation-role-scoping.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `ConversationService.getConversations` now accepts an additional `viewerRole?: string` field on its filter object; when `viewerRole === 'sales'`, the query forces `where.assignee_id = filter.viewerUserId` regardless of any `agentId` query param the caller passed — a `sales` user can no longer request another rep's conversations by guessing their `agentId`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/test/conversation-role-scoping.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import prisma from '../src/lib/prisma'
import { ConversationService } from '../src/modules/conversation/service'

let appId: string
let salesAId: string
let salesBId: string
let contactId: string
let conversationOwnedByA: string
let conversationOwnedByB: string

beforeAll(async () => {
	const app = await prisma.apps.create({
		data: { app_id: `conv-scope-test-${Date.now()}`, app_name: 'Conv Scope Test', business_name: 'Conv Scope Test' },
	})
	appId = app.id

	const salesA = await prisma.users.create({
		data: { name: 'Sales A', email: `sales-a-${Date.now()}@test.local`, role: 'sales', app_id: appId },
	})
	salesAId = salesA.id
	const salesB = await prisma.users.create({
		data: { name: 'Sales B', email: `sales-b-${Date.now()}@test.local`, role: 'sales', app_id: appId },
	})
	salesBId = salesB.id

	const contact = await prisma.contacts.create({
		data: { name: 'Test Contact', app_id: appId },
	})
	contactId = contact.id

	const convA = await prisma.conversations.create({
		data: { app_id: appId, contact_id: contactId, assignee_id: salesAId, status: 'open' },
	})
	conversationOwnedByA = convA.id
	const convB = await prisma.conversations.create({
		data: { app_id: appId, contact_id: contactId, assignee_id: salesBId, status: 'open' },
	})
	conversationOwnedByB = convB.id
})

afterAll(async () => {
	await prisma.conversations.deleteMany({ where: { id: { in: [conversationOwnedByA, conversationOwnedByB] } } })
	await prisma.contacts.deleteMany({ where: { id: contactId } })
	await prisma.users.deleteMany({ where: { id: { in: [salesAId, salesBId] } } })
	await prisma.apps.deleteMany({ where: { id: appId } })
})

describe('conversation list row-level scoping', () => {
	test('a sales viewer only sees their own conversations, even without an agentId filter', async () => {
		const result = await ConversationService.getConversations(appId, {
			viewerUserId: salesAId,
			viewerRole: 'sales',
		})
		const ids = result.conversations.map((c: any) => c.id)
		expect(ids).toContain(conversationOwnedByA)
		expect(ids).not.toContain(conversationOwnedByB)
	})

	test('a sales viewer cannot see another rep\'s conversations by passing their agentId explicitly', async () => {
		const result = await ConversationService.getConversations(appId, {
			viewerUserId: salesAId,
			viewerRole: 'sales',
			agentId: salesBId,
		})
		const ids = result.conversations.map((c: any) => c.id)
		expect(ids).not.toContain(conversationOwnedByB)
	})

	test('a leader viewer sees all conversations (unfiltered)', async () => {
		const result = await ConversationService.getConversations(appId, {
			viewerUserId: salesAId,
			viewerRole: 'leader',
		})
		const ids = result.conversations.map((c: any) => c.id)
		expect(ids).toContain(conversationOwnedByA)
		expect(ids).toContain(conversationOwnedByB)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/conversation-role-scoping.test.ts`
Expected: FAIL — `getConversations` doesn't accept `viewerRole` yet and never filters by it, so the first two tests see both conversations.

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/modules/conversation/service.ts`, locate the `getConversations` signature and `where` construction (lines 571–596) and change:

```typescript
	static async getConversations(
		accountId: string,
		filter: ConversationFilter = {},
	) {
```
to accept the new field (add `viewerRole?: string` to the `ConversationFilter` type definition near the top of the file, alongside its existing fields), then replace:
```typescript
		if (status) where.status = status
		if (inboxId && isUuid(inboxId)) where.inbox_id = inboxId
		if (agentId && isUuid(agentId)) where.assignee_id = agentId
		if (priority) where.priority = priority
```
with:
```typescript
		if (status) where.status = status
		if (inboxId && isUuid(inboxId)) where.inbox_id = inboxId
		if (agentId && isUuid(agentId)) where.assignee_id = agentId
		if (priority) where.priority = priority

		if (filter.viewerRole === 'sales' && filter.viewerUserId) {
			where.assignee_id = filter.viewerUserId
		}
```

(This must come *after* the `agentId` assignment so it overrides any caller-supplied `agentId` for a `sales` viewer, per the test above.)

In `apps/backend/src/modules/conversation/index.ts`, the `GET '/'` handler needs the caller's role. Add a role lookup using the already-imported `prisma` (or reuse `requireRole`-style lookup) right after the existing `resolvedAppId` check, then pass it through:

```typescript
	.get(
		'/',
		async ({ resolvedAppId, query, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const viewer = userId
				? await prisma.users.findUnique({ where: { id: userId }, select: { role: true } })
				: null

			const result = await ConversationService.getConversations(resolvedAppId, {
				status: query.status,
				inboxId: query.inboxId,
				agentId: query.agentId,
				priority: query.priority,
				page: query.page ? parseInt(query.page) : 1,
				limit: query.limit ? parseInt(query.limit) : 10,
				viewerUserId: userId,
				viewerRole: viewer?.role ?? undefined,
				dateFrom: query.dateFrom,
				dateTo: query.dateTo,
				labelIds: query.labelIds ? query.labelIds.split(',') : undefined,
				resolvedBy: query.resolvedBy,
				aiAgentId: query.aiAgentId,
				pipelineStageId: query.pipelineStageId,
				channelType: query.channelType,
				provider: query.provider,
			})
			return result
		},
```

Add `import prisma from '../../lib/prisma'` at the top of `apps/backend/src/modules/conversation/index.ts` if it isn't already imported there (check the existing import block first — if `prisma` is already imported for another handler in this file, don't duplicate the import).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/conversation-role-scoping.test.ts`
Expected: PASS (3 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/conversation/index.ts apps/backend/src/modules/conversation/service.ts apps/backend/test/conversation-role-scoping.test.ts
git commit -m "feat: scope conversation list to own assignee for sales-role viewers"
```

---

### Task 6: Row-level scoping for `sales` on orders

**Files:**
- Modify: `apps/backend/src/modules/orders/index.ts` (lines 303–353)
- Test: `apps/backend/test/orders-role-scoping.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `GET /orders` now joins to the order's `conversations` row (already aliased `conv` in this query, confirmed by the existing `conv.inbox_id` filter) and forces `conv.assignee_id = <callerId>` when the caller's role is `sales`.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/test/orders-role-scoping.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import prisma from '../src/lib/prisma'
import { app } from '../src/index'

let appId: string
let salesAId: string
let salesBId: string
let salesAToken: string
let contactId: string
let orderOwnedByA: string
let orderOwnedByB: string

async function createSessionForUser(userId: string): Promise<string> {
	const token = `test-session-${userId}`
	await prisma.session.create({
		data: { id: crypto.randomUUID(), token, userId, expiresAt: new Date(Date.now() + 60_000) },
	})
	return token
}

beforeAll(async () => {
	const appRecord = await prisma.apps.create({
		data: { app_id: `orders-scope-test-${Date.now()}`, app_name: 'Orders Scope Test', business_name: 'Orders Scope Test' },
	})
	appId = appRecord.id

	const salesA = await prisma.users.create({
		data: { name: 'Orders Sales A', email: `orders-sales-a-${Date.now()}@test.local`, role: 'sales', app_id: appId },
	})
	salesAId = salesA.id
	salesAToken = await createSessionForUser(salesAId)
	const salesB = await prisma.users.create({
		data: { name: 'Orders Sales B', email: `orders-sales-b-${Date.now()}@test.local`, role: 'sales', app_id: appId },
	})
	salesBId = salesB.id

	const contact = await prisma.contacts.create({ data: { name: 'Orders Contact', app_id: appId } })
	contactId = contact.id

	const convA = await prisma.conversations.create({
		data: { app_id: appId, contact_id: contactId, assignee_id: salesAId, status: 'open' },
	})
	const convB = await prisma.conversations.create({
		data: { app_id: appId, contact_id: contactId, assignee_id: salesBId, status: 'open' },
	})

	const orderA = await prisma.orders.create({
		data: { app_id: appId, contact_id: contactId, conversation_id: convA.id, order_status: 'pending' },
	})
	orderOwnedByA = orderA.id
	const orderB = await prisma.orders.create({
		data: { app_id: appId, contact_id: contactId, conversation_id: convB.id, order_status: 'pending' },
	})
	orderOwnedByB = orderB.id
})

afterAll(async () => {
	await prisma.orders.deleteMany({ where: { id: { in: [orderOwnedByA, orderOwnedByB] } } })
	await prisma.conversations.deleteMany({ where: { app_id: appId } })
	await prisma.contacts.deleteMany({ where: { id: contactId } })
	await prisma.session.deleteMany({ where: { userId: salesAId } })
	await prisma.users.deleteMany({ where: { id: { in: [salesAId, salesBId] } } })
	await prisma.apps.deleteMany({ where: { id: appId } })
})

describe('orders list row-level scoping', () => {
	test('a sales viewer only sees orders from their own assigned conversations', async () => {
		const response = await app.handle(
			new Request(`http://localhost/orders?appId=${appId}`, {
				headers: { authorization: `Bearer ${salesAToken}` },
			}),
		)
		const body = await response.json()
		const ids = (body.data ?? []).map((o: any) => o.id)
		expect(ids).toContain(orderOwnedByA)
		expect(ids).not.toContain(orderOwnedByB)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/orders-role-scoping.test.ts`
Expected: FAIL — the orders query has no assignee filter today, so both orders come back.

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/modules/orders/index.ts`, add `userId` to the destructured `GET '/'` handler params (alongside `query, orgId, resolvedAppId, set`), then look up the caller's role and push an extra scope clause when it's `sales`. Insert this right after the existing `scopeClause` block (after line 330):

```typescript
			const scopeClause = buildScopeClause(params, 'o', orgId, resolvedAppId)
			if (scopeClause) {
				whereParts.push(scopeClause)
			}

			if (userId) {
				const viewer = await prisma.users.findUnique({
					where: { id: userId },
					select: { role: true },
				})
				if (viewer?.role === 'sales') {
					whereParts.push(`conv.assignee_id = ${addParam(params, userId)}`)
				}
			}
```

Add `import prisma from '../../lib/prisma'` at the top of `apps/backend/src/modules/orders/index.ts` if not already present (check the file's existing imports first).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/orders-role-scoping.test.ts`
Expected: PASS (1 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/orders/index.ts apps/backend/test/orders-role-scoping.test.ts
git commit -m "feat: scope orders list to own assigned conversations for sales-role viewers"
```

---

### Task 7: Row-level scoping for `sales` on customers

**Files:**
- Modify: `apps/backend/src/modules/customer/index.ts`
- Modify: `apps/backend/src/modules/customer/service.ts` (lines 413–451)
- Test: `apps/backend/test/customers-role-scoping.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `CustomerService.listCustomers` accepts a new `viewerRole?: string` and `viewerUserId?: string` on its params; when `viewerRole === 'sales'`, an `EXISTS` subquery against `conversations` restricts results to contacts who have at least one conversation assigned to that viewer.

- [ ] **Step 1: Write the failing test**

```typescript
// apps/backend/test/customers-role-scoping.test.ts
import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import prisma from '../src/lib/prisma'
import { CustomerService } from '../src/modules/customer/service'

let appId: string
let salesAId: string
let salesBId: string
let contactOwnedByA: string
let contactOwnedByB: string

beforeAll(async () => {
	const appRecord = await prisma.apps.create({
		data: { app_id: `customers-scope-test-${Date.now()}`, app_name: 'Customers Scope Test', business_name: 'Customers Scope Test' },
	})
	appId = appRecord.id

	const salesA = await prisma.users.create({
		data: { name: 'Customers Sales A', email: `customers-sales-a-${Date.now()}@test.local`, role: 'sales', app_id: appId },
	})
	salesAId = salesA.id
	const salesB = await prisma.users.create({
		data: { name: 'Customers Sales B', email: `customers-sales-b-${Date.now()}@test.local`, role: 'sales', app_id: appId },
	})
	salesBId = salesB.id

	const contactA = await prisma.contacts.create({ data: { name: 'Contact Owned By A', app_id: appId } })
	contactOwnedByA = contactA.id
	const contactB = await prisma.contacts.create({ data: { name: 'Contact Owned By B', app_id: appId } })
	contactOwnedByB = contactB.id

	await prisma.conversations.create({
		data: { app_id: appId, contact_id: contactOwnedByA, assignee_id: salesAId, status: 'open' },
	})
	await prisma.conversations.create({
		data: { app_id: appId, contact_id: contactOwnedByB, assignee_id: salesBId, status: 'open' },
	})
})

afterAll(async () => {
	await prisma.conversations.deleteMany({ where: { app_id: appId } })
	await prisma.contacts.deleteMany({ where: { id: { in: [contactOwnedByA, contactOwnedByB] } } })
	await prisma.users.deleteMany({ where: { id: { in: [salesAId, salesBId] } } })
	await prisma.apps.deleteMany({ where: { id: appId } })
})

describe('customers list row-level scoping', () => {
	test('a sales viewer only sees customers with a conversation assigned to them', async () => {
		const result = await CustomerService.listCustomers({
			appId,
			viewerRole: 'sales',
			viewerUserId: salesAId,
		})
		const ids = result.data.map((c: any) => c.id)
		expect(ids).toContain(contactOwnedByA)
		expect(ids).not.toContain(contactOwnedByB)
	})

	test('a leader viewer sees all customers (unfiltered)', async () => {
		const result = await CustomerService.listCustomers({
			appId,
			viewerRole: 'leader',
			viewerUserId: salesAId,
		})
		const ids = result.data.map((c: any) => c.id)
		expect(ids).toContain(contactOwnedByA)
		expect(ids).toContain(contactOwnedByB)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/customers-role-scoping.test.ts`
Expected: FAIL — `listCustomers` has no `viewerRole`/`viewerUserId` params and no filter, so the first test also sees `contactOwnedByB`.

- [ ] **Step 3: Write the implementation**

In `apps/backend/src/modules/customer/service.ts`, find `listCustomers` (around line 413) and add `viewerRole` / `viewerUserId` to its params type, then extend the `whereParts` array construction:

```typescript
			const whereParts: Prisma.Sql[] = [
				Prisma.sql`(c.account_id = ${targetAppId}::uuid OR c.app_id = ${targetAppId}::uuid)`,
				Prisma.sql`c.deleted_at IS NULL`,
			]

			if (params.viewerRole === 'sales' && params.viewerUserId) {
				whereParts.push(
					Prisma.sql`EXISTS (
						SELECT 1 FROM conversations conv
						WHERE conv.contact_id = c.id
						AND conv.assignee_id = ${params.viewerUserId}::uuid
					)`,
				)
			}

			if (search) {
				const pattern = `%${search}%`
				whereParts.push(
					Prisma.sql`(
						c.name ILIKE ${pattern}
						OR c.email ILIKE ${pattern}
						OR c.phone_number ILIKE ${pattern}
					)`,
				)
			}
```

In `apps/backend/src/modules/customer/index.ts`, add `userId` to the `GET '/'` handler's destructured params and thread the viewer's role through the same way as Task 5/6 (look up `prisma.users.findUnique({ where: { id: userId }, select: { role: true } })`, then pass `viewerRole: viewer?.role, viewerUserId: userId` into the `CustomerService.listCustomers` call alongside the existing `appId, search, page, perPage, sort, order` fields).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/customers-role-scoping.test.ts`
Expected: PASS (2 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/modules/customer/index.ts apps/backend/src/modules/customer/service.ts apps/backend/test/customers-role-scoping.test.ts
git commit -m "feat: scope customers list to own assigned conversations for sales-role viewers"
```

---

### Task 8: Rebuild frontend role-access as composable, fail-closed tiers

**Files:**
- Modify: `apps/frontend/src/lib/role-access.ts`
- Modify: `apps/frontend/src/lib/role-access.test.ts`

**Interfaces:**
- Consumes: none new.
- Produces: `SALES_PATHS`, `LEADER_PATHS`, `CEO_PATHS`, `SUPERADMIN_PATHS` exported arrays (each tier built from the one below it). `getAllowedPrimaryPathsForRole` now returns `SALES_PATHS` (not `null`/unrestricted) for any role it doesn't recognize — a deliberate fail-closed change from today's fail-open default. Only `superadmin` returns `null` (fully unrestricted). Consumed unchanged by `Sidebar.tsx`, `BottomNav.tsx`, `CommandPalette.tsx`, and `_app.tsx` (no changes needed there — confirmed they all call this one function).

- [ ] **Step 1: Write the failing test**

Replace the contents of `apps/frontend/src/lib/role-access.test.ts` with:

```typescript
// apps/frontend/src/lib/role-access.test.ts
import { describe, expect, test } from 'vitest'
import {
	getAllowedPrimaryPathsForRole,
	isPathAllowedForRole,
	SALES_PATHS,
	LEADER_PATHS,
	CEO_PATHS,
} from './role-access'

describe('role-access: sales/leader/ceo/superadmin', () => {
	test('superadmin is unrestricted', () => {
		expect(getAllowedPrimaryPathsForRole('superadmin')).toBeNull()
	})

	test('ceo is restricted to CEO_PATHS', () => {
		expect(getAllowedPrimaryPathsForRole('ceo')).toEqual(CEO_PATHS)
	})

	test('leader can reach /kelola-tim but not /developers', () => {
		expect(isPathAllowedForRole('/kelola-tim', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/developers', 'leader')).toBe(false)
	})

	test('ceo cannot reach /developers, only superadmin can', () => {
		expect(isPathAllowedForRole('/developers', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/developers', 'superadmin')).toBe(true)
	})

	test('sales cannot reach /kelola-tim', () => {
		expect(isPathAllowedForRole('/kelola-tim', 'sales')).toBe(false)
	})

	test('every tier includes everything the tier below it includes', () => {
		expect(SALES_PATHS.every((p) => LEADER_PATHS.includes(p))).toBe(true)
		expect(LEADER_PATHS.every((p) => CEO_PATHS.includes(p))).toBe(true)
	})

	test('an unrecognized or missing role fails closed to the most restrictive tier', () => {
		expect(getAllowedPrimaryPathsForRole('made-up-role')).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole(null)).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole(undefined)).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole('')).toEqual(SALES_PATHS)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/lib/role-access.test.ts`
Expected: FAIL — `SALES_PATHS`/`LEADER_PATHS`/`CEO_PATHS` aren't exported yet, and the current code returns `null` (unrestricted) for unrecognized roles, not `SALES_PATHS`.

- [ ] **Step 3: Write the implementation**

Replace the contents of `apps/frontend/src/lib/role-access.ts` from the `AppRole` type declaration onward (keep `normalizeAppRole` and `extractNormalizedRole` as-is — they don't change) with:

```typescript
export type AppRole = 'sales' | 'leader' | 'ceo' | 'superadmin' | string

export function normalizeAppRole(role: string | null | undefined): string {
	const normalized = String(role || '')
		.trim()
		.toLowerCase()
	return normalized
}

type AnyRecord = Record<string, unknown> | null | undefined

export function extractNormalizedRole(source: AnyRecord): string {
	if (!source || typeof source !== 'object') return ''

	const roleCandidates: unknown[] = [
		source.role,
		source.app_role,
		source.appRole,
		source.user_role,
		source.userRole,
		source.organizationRole,
		source.memberRole,
		(source.metadata as AnyRecord)?.role,
		(source.user as AnyRecord)?.role,
		((source.user as AnyRecord)?.metadata as AnyRecord)?.role,
	]

	for (const candidate of roleCandidates) {
		if (typeof candidate !== 'string') continue
		const normalized = normalizeAppRole(candidate)
		if (normalized) return normalized
	}

	return ''
}

export const SALES_PATHS = ['/dashboard', '/chat', '/orders', '/customers']

export const LEADER_PATHS = [
	...SALES_PATHS,
	'/kelola-tim',
	'/handover',
	'/conversations',
	'/pipeline',
	'/products',
	'/product-stock',
	'/broadcast',
	'/flows',
	'/ai-agents',
	'/ai',
	'/knowledge',
	'/analytics',
	'/metrics',
	'/templates',
	'/channels/whatsapp',
	'/channels/facebook',
	'/channels/line',
	'/channels/telegram',
	'/channels/livechat',
	'/channels/bot',
	'/channels/custom',
	'/team',
	'/settings',
]

export const CEO_PATHS = [...LEADER_PATHS, '/integration', '/apps', '/help']

export const SUPERADMIN_PATHS = [...CEO_PATHS, '/developers']

/**
 * Returns null when unrestricted, otherwise returns exact allowed top-level paths.
 * An unrecognized or missing role fails CLOSED to SALES_PATHS (the most
 * restrictive tier) rather than falling through to unrestricted — see the
 * Better Auth `role`-field bug fixed earlier, which made every role
 * silently empty and every page silently unrestricted.
 */
export function getAllowedPrimaryPathsForRole(
	role: string | null | undefined,
): string[] | null {
	const normalizedRole = normalizeAppRole(role)

	if (normalizedRole === 'superadmin') return null
	if (normalizedRole === 'ceo') return CEO_PATHS
	if (normalizedRole === 'leader') return LEADER_PATHS
	if (normalizedRole === 'sales') return SALES_PATHS

	return SALES_PATHS
}

export function isPathAllowedForRole(
	pathname: string,
	role: string | null | undefined,
): boolean {
	const allowedPaths = getAllowedPrimaryPathsForRole(role)
	if (!allowedPaths) return true

	return allowedPaths.some(
		(path) => pathname === path || pathname.startsWith(`${path}/`),
	)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/lib/role-access.test.ts`
Expected: PASS (7 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/role-access.ts apps/frontend/src/lib/role-access.test.ts
git commit -m "feat: rebuild role-access as composable sales/leader/ceo/superadmin tiers, fail closed on unknown role"
```

---

### Task 9: Per-tab gating inside Settings

**Files:**
- Modify: `apps/frontend/src/routes/_app/settings.tsx` (lines 1–120 area + wherever `SIDEBAR_NAV_ITEMS` is rendered)

**Interfaces:**
- Consumes: `normalizeAppRole` (existing, `@/lib/role-access`).
- Produces: `SettingsNavItemId` (moved here — this becomes its single source of truth, `settings.tsx` imports it rather than declaring its own copy) and `getVisibleSettingsTabIds(role): SettingsNavItemId[]`. `SIDEBAR_NAV_ITEMS` in `settings.tsx` is filtered by this before being rendered, so a `sales`/`leader` account never sees the `Pakasir`, `WhatsApp`, or `Developer Tools` tab entries, even if they somehow land on `/settings`.

- [ ] **Step 1: Write the failing test**

This is a rendering-gate change inside a large existing page component; add a small pure-function unit test instead of a full component test to keep it fast and isolated. Create:

```typescript
// apps/frontend/src/routes/_app/settings-tab-access.test.ts
import { describe, expect, test } from 'vitest'
import { getVisibleSettingsTabIds } from './settings-tab-access'

describe('getVisibleSettingsTabIds', () => {
	test('sales sees only the personal tabs', () => {
		expect(getVisibleSettingsTabIds('sales')).toEqual([
			'security',
			'notifications',
			'localization',
		])
	})

	test('leader adds general/ai-models/customer-level/labels/teams', () => {
		const tabs = getVisibleSettingsTabIds('leader')
		expect(tabs).toContain('general')
		expect(tabs).toContain('teams')
		expect(tabs).not.toContain('pakasir')
		expect(tabs).not.toContain('developer')
	})

	test('ceo adds pakasir and whatsapp', () => {
		const tabs = getVisibleSettingsTabIds('ceo')
		expect(tabs).toContain('pakasir')
		expect(tabs).toContain('whatsapp')
		expect(tabs).not.toContain('developer')
	})

	test('superadmin sees everything including developer', () => {
		const tabs = getVisibleSettingsTabIds('superadmin')
		expect(tabs).toContain('developer')
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/routes/_app/settings-tab-access.test.ts`
Expected: FAIL — `./settings-tab-access` module doesn't exist yet.

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/routes/_app/settings-tab-access.ts`:

```typescript
import { normalizeAppRole } from '@/lib/role-access'

export type SettingsNavItemId =
	| 'general'
	| 'ai-models'
	| 'customer-level'
	| 'pakasir'
	| 'labels'
	| 'whatsapp'
	| 'security'
	| 'notifications'
	| 'localization'
	| 'developer'
	| 'teams'

const PERSONAL_TABS: SettingsNavItemId[] = ['security', 'notifications', 'localization']
const LEADER_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'general', 'ai-models', 'customer-level', 'labels', 'teams']
const CEO_TABS: SettingsNavItemId[] = [...LEADER_TABS, 'pakasir', 'whatsapp']
const SUPERADMIN_TABS: SettingsNavItemId[] = [...CEO_TABS, 'developer']

export function getVisibleSettingsTabIds(role: string | null | undefined): SettingsNavItemId[] {
	const normalized = normalizeAppRole(role)

	if (normalized === 'superadmin') return SUPERADMIN_TABS
	if (normalized === 'ceo') return CEO_TABS
	if (normalized === 'leader') return LEADER_TABS
	return PERSONAL_TABS
}
```

Then in `apps/frontend/src/routes/_app/settings.tsx`:
- Delete the file's own inline `type SettingsNavItemId = 'general' | 'ai-models' | ... | 'teams'` declaration (currently defined directly in this file) — it now lives solely in `settings-tab-access.ts`.
- Add the import near the other local imports:
```typescript
import { getVisibleSettingsTabIds, type SettingsNavItemId } from './settings-tab-access'
import { extractNormalizedRole } from '@/lib/role-access'
```
Then, inside `SettingsPage()`, after the component resolves the current user (this file already reads `localStorage.getItem('scalechat_user')` elsewhere in the codebase pattern used by `Sidebar.tsx`/`TopBar.tsx` — follow that same pattern here to get `currentRole`), compute:
```typescript
	const visibleTabIds = getVisibleSettingsTabIds(currentRole)
	const visibleNavItems = SIDEBAR_NAV_ITEMS.filter((item) => visibleTabIds.includes(item.id))
```
and render `visibleNavItems` wherever the sidebar tab list currently maps over `SIDEBAR_NAV_ITEMS` for its clickable tab buttons.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/routes/_app/settings-tab-access.test.ts`
Expected: PASS (4 pass).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/routes/_app/settings-tab-access.ts apps/frontend/src/routes/_app/settings-tab-access.test.ts apps/frontend/src/routes/_app/settings.tsx
git commit -m "feat: gate Settings tabs by role (personal/leader/ceo/superadmin tiers)"
```

---

### Task 10: Rename role literals in frontend components, fold Teams into Kelola Tim

**Files:**
- Modify: `apps/frontend/src/components/AgentAssignmentPanel.tsx` (lines 17, 42–43)
- Modify: `apps/frontend/src/components/ChatRoomActionsMenu.tsx` (lines 34, 88–89)
- Modify: `apps/frontend/src/routes/_app/team.tsx` (lines 73, 1786, 1963–1981)
- Modify: `apps/frontend/src/routes/_app/kelola-tim.tsx` (line 25, 111–115, 144–146)
- Modify: `apps/frontend/src/routes/_app/settings.tsx` (remove the `teams` tab and its `AgentsManagementPage` render)

**Interfaces:**
- No new interfaces — this is a mechanical rename plus removing the duplicate Teams UI. `team.tsx`'s `beforeLoad` redirect to `/settings?tab=teams` is removed since that destination tab no longer exists; it now redirects to `/kelola-tim` instead.

- [ ] **Step 1: Update `AgentAssignmentPanel.tsx`**

Replace line 17:
```tsx
	currentUserRole: 'agent' | 'supervisor' | 'admin'
```
with:
```tsx
	currentUserRole: 'sales' | 'leader' | 'ceo' | 'superadmin'
```
Replace lines 42–43:
```tsx
	const canManageAgents =
		currentUserRole === 'supervisor' || currentUserRole === 'admin'
```
with:
```tsx
	const canManageAgents =
		currentUserRole === 'leader' || currentUserRole === 'ceo' || currentUserRole === 'superadmin'
```

- [ ] **Step 2: Update `ChatRoomActionsMenu.tsx`**

Apply the identical two replacements at lines 34 and 88–89 (same prop type, same `canManageAgents` logic).

- [ ] **Step 3: Update `team.tsx`**

Replace the `Agent` interface's role field (line 73):
```tsx
	role: 'admin' | 'agent' | 'supervisor'
```
with:
```tsx
	role: 'sales' | 'leader' | 'ceo' | 'superadmin'
```

Replace the `formData` default (line 1786):
```tsx
		role: initialData?.role || 'agent',
```
with:
```tsx
		role: initialData?.role || 'sales',
```

Replace the role `<select>` (lines 1969–1981):
```tsx
							<select
								value={formData.role}
								onChange={(e) =>
									setFormData({
										...formData,
										role: e.target.value as 'agent' | 'supervisor',
									})
								}
								className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
							>
								<option value="agent">Agent</option>
								<option value="supervisor">Supervisor</option>
							</select>
```
with:
```tsx
							<select
								value={formData.role}
								onChange={(e) =>
									setFormData({
										...formData,
										role: e.target.value as 'sales' | 'leader',
									})
								}
								className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm"
							>
								<option value="sales">Sales</option>
								<option value="leader">Sales Leader</option>
							</select>
```

Change the route's `beforeLoad` redirect target from `/settings?tab=teams` to `/kelola-tim`:
```tsx
export const Route = createFileRoute('/_app/team')({
	component: AgentsManagementPage,
	beforeLoad: () => {
		throw redirect({
			to: '/kelola-tim',
			replace: true,
		})
	},
})
```

- [ ] **Step 4: Add `superadmin` to Kelola Tim's role dropdowns**

In `apps/frontend/src/routes/_app/kelola-tim.tsx`, replace line 25:
```tsx
	const [role, setRole] = useState('sales')
```
stays the same (default for *new* accounts should stay `sales` — most hires are reps, not admins). Add a `superadmin` option to both `<NativeSelect>` blocks (lines 111–115 and 144–146):
```tsx
				<NativeSelect value={role} onChange={(e) => setRole(e.target.value)}>
					<NativeSelectOption value="sales">Sales</NativeSelectOption>
					<NativeSelectOption value="leader">Sales Leader</NativeSelectOption>
					<NativeSelectOption value="ceo">CEO</NativeSelectOption>
					<NativeSelectOption value="superadmin">Superadmin</NativeSelectOption>
				</NativeSelect>
```
(apply the same fourth `<NativeSelectOption>` line to the second occurrence inside the members table's per-row role selector).

- [ ] **Step 5: Remove the duplicate Teams tab from Settings**

In `apps/frontend/src/routes/_app/settings.tsx`:
- Remove the `{ title: 'Teams', icon: Users, id: 'teams' }` entry from `SIDEBAR_NAV_ITEMS`.
- Remove the `case 'teams': return 'teams'` branch from `getInitialActiveNav`.
- Remove the `import { AgentsManagementPage } from '@/routes/_app/team'` import and wherever `<AgentsManagementPage mode="roles" initialTab="teams" />` is rendered in the tab-content switch.

In `apps/frontend/src/routes/_app/settings-tab-access.ts` (Task 9's file — `SettingsNavItemId`'s single source of truth):
- Remove `'teams'` from the `SettingsNavItemId` union type.
- Remove `'teams'` from `LEADER_TABS` — replace:
```typescript
const LEADER_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'general', 'ai-models', 'customer-level', 'labels', 'teams']
```
with:
```typescript
const LEADER_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'general', 'ai-models', 'customer-level', 'labels']
```
and update `settings-tab-access.test.ts`'s `'leader adds general/ai-models/customer-level/labels/teams'` test to drop the `teams` assertion.

- [ ] **Step 6: Manual verification**

```bash
cd apps/frontend && bun run dev
```
Visit `/team` — confirm it redirects to `/kelola-tim`, not a dead `/settings?tab=teams`. Visit `/settings` as a `leader` test account — confirm no "Teams" entry appears in the sidebar and the tab list matches `LEADER_TABS`.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/components/AgentAssignmentPanel.tsx apps/frontend/src/components/ChatRoomActionsMenu.tsx apps/frontend/src/routes/_app/team.tsx apps/frontend/src/routes/_app/kelola-tim.tsx apps/frontend/src/routes/_app/settings.tsx apps/frontend/src/routes/_app/settings-tab-access.ts apps/frontend/src/routes/_app/settings-tab-access.test.ts
git commit -m "feat: rename frontend role literals to sales/leader/ceo/superadmin, fold Teams tab into Kelola Tim"
```

---

### Task 11: Delete dead SaaS-era route scaffolding

**Files:**
- Delete: `apps/frontend/src/routes/_app/billing/`
- Delete: `apps/frontend/src/routes/_app/subscription/`
- Delete: `apps/frontend/src/routes/_app/top-up/`
- Delete: `apps/frontend/src/routes/_app/outbound.tsx`
- Delete: `apps/frontend/src/routes/_app/instagram/`
- Delete: `apps/frontend/src/routes/_app/channels/instagram/`
- Delete: `apps/frontend/src/routes/_app/channels/tiktok/`

**Interfaces:** none — these directories/file contain zero route files (confirmed empty this session) or a single redirect-only file. No other code imports from them (verify with the grep in Step 1 before deleting).

- [ ] **Step 1: Confirm nothing references these paths before deleting**

```bash
cd apps/frontend/src
grep -rn "'/billing'\|\"/billing\"\|'/subscription'\|\"/subscription\"\|'/top-up'\|\"/top-up\"\|'/outbound'\|\"/outbound\"\|'/instagram'\|\"/instagram\"\|'/channels/instagram'\|'/channels/tiktok'" . --include="*.ts" --include="*.tsx"
```
Expected: no output, or only the route files themselves being deleted (if `outbound.tsx`'s own `redirect({ to: '/broadcast' })` shows up as unrelated, that's fine — it's the file being deleted).

- [ ] **Step 2: Delete the dead files/directories**

```bash
git rm -r apps/frontend/src/routes/_app/billing apps/frontend/src/routes/_app/subscription apps/frontend/src/routes/_app/top-up apps/frontend/src/routes/_app/outbound.tsx apps/frontend/src/routes/_app/instagram apps/frontend/src/routes/_app/channels/instagram apps/frontend/src/routes/_app/channels/tiktok
```
(If `git rm -r` errors on an empty directory with no tracked files, use `rm -r` for that specific path instead — empty directories are often not tracked by git at all, so there may be nothing to `git rm`.)

- [ ] **Step 3: Regenerate the TanStack Router route tree and verify the frontend still builds**

```bash
cd apps/frontend && bun run build
```
Expected: build succeeds with no "route not found" or missing-import errors. (TanStack Start's file-based router regenerates its route tree automatically on build/dev — no manual route-tree file to hand-edit.)

- [ ] **Step 4: Commit**

```bash
git add -A apps/frontend/src/routes/_app
git commit -m "chore: delete dead SaaS-era route scaffolding (billing/subscription/top-up/outbound/instagram/tiktok)"
```

---

### Task 12: Rename role values in the dev database and reseed test accounts

**Files:**
- Create: `apps/backend/scripts/rename-legacy-roles.ts`

**Interfaces:**
- Produces: `bun run db:rename-legacy-roles` — a one-time, idempotent script for this dev environment only (no production data exists yet, per the spec). Renames any existing `agent`→`sales`, `supervisor`→`leader`, `admin`→`ceo` role values, then reports how many rows changed.

- [ ] **Step 1: Write the script**

```typescript
// apps/backend/scripts/rename-legacy-roles.ts
import prisma from '../src/lib/prisma'

const RENAME_MAP: Record<string, string> = {
	agent: 'sales',
	supervisor: 'leader',
	admin: 'ceo',
}

async function main() {
	for (const [oldRole, newRole] of Object.entries(RENAME_MAP)) {
		const result = await prisma.users.updateMany({
			where: { role: oldRole },
			data: { role: newRole },
		})
		console.log(`${oldRole} -> ${newRole}: ${result.count} row(s) updated`)
	}
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
```

Add to `apps/backend/package.json` `scripts`:
```json
		"db:rename-legacy-roles": "bun run scripts/rename-legacy-roles.ts"
```

- [ ] **Step 2: Run it and recreate the three test accounts under the new role names**

```bash
cd apps/backend && bun run db:rename-legacy-roles
```
Expected: reports `0` for each mapping if run after this plan's other tasks are already implemented in a fresh dev DB, or the actual count if `admin@test.com`/`supervisor@test.com`/`agent@test.com` (seeded earlier this session under the *old* role values) still exist with old role strings at this point — either way, confirm no errors.

Then recreate the four test accounts (adding `superadmin`) exactly as done earlier this session — write and run a short throwaway script (not committed, matching this session's established pattern) that creates `sales@test.com` / `leader@test.com` / `ceo@test.com` / `superadmin@test.com`, all password `1`, using `syncBetterAuthCredentialAccount` for the Better Auth credential link. Verify each logs in via:
```bash
for role in sales leader ceo superadmin; do
  curl -s -X POST http://localhost:3010/auth/sign-in/email \
    -H 'content-type: application/json' \
    -d "{\"email\":\"$role@test.com\",\"password\":\"1\"}" | python3 -c "import json,sys; d=json.load(sys.stdin); print('$role role:', d['user']['role'])"
done
```
Expected: each prints its own role back, confirming the Better Auth `role` additionalField (fixed earlier this session) still round-trips correctly for all four values.

- [ ] **Step 3: Commit**

```bash
git add apps/backend/scripts/rename-legacy-roles.ts apps/backend/package.json
git commit -m "feat: add idempotent legacy-role rename script for dev database"
```

---

### Task 13: Full-suite verification

**Files:** none modified — verification only.

- [ ] **Step 1: Run the full backend test suite**

```bash
cd apps/backend && bun test
```
Expected: every test added in Tasks 1–7 passes. Pre-existing unrelated failures (webhook-formatter mocks, meta-api fetch mocks — confirmed present before this plan started, tracked separately, not caused by this work) may still appear; confirm the failure count doesn't grow beyond that known baseline.

- [ ] **Step 2: Run the full frontend test suite**

```bash
cd apps/frontend && npx vitest run
```
Expected: all tests pass, including the new `role-access.test.ts` and `settings-tab-access.test.ts`.

- [ ] **Step 3: Manual per-role walkthrough**

Start both dev servers (`bun run dev:backend`, `bun run dev:frontend`), then for each of the four seeded test accounts (`sales@test.com`, `leader@test.com`, `ceo@test.com`, `superadmin@test.com`, password `1`):
1. Log in at `http://localhost:3005/login`.
2. Confirm the sidebar matches the matrix in the spec (`docs/superpowers/specs/2026-07-09-rbac-refactor-design.md`) for that role.
3. Confirm `/settings` shows only the tabs that role should see.
4. From the browser console (or `curl` with that account's session token), call one endpoint above the role's tier directly — e.g. as `sales`, `curl -H "authorization: Bearer <token>" http://localhost:3010/developer_keys` — and confirm a `403`, not just an absent sidebar link.

- [ ] **Step 4: Commit (if any fixups were needed)**

If the manual walkthrough surfaces any small fix, make it, then:
```bash
git add -A
git commit -m "fix: address issues found during RBAC manual verification"
```
