# Sidebar & Per-Role Page Access Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the nested-superset role/page model with four independent per-role page lists, wire orphan pages into the sidebar per role, delete confirmed dead-code route files, and gate Handover's and Settings' in-page tabs to match.

**Architecture:** Two shared frontend lib files (`role-access.ts`, `crm-navigation.ts`) drive every consumer (`Sidebar.tsx`, `BottomNav.tsx`, `CommandPalette.tsx`, `_app.tsx`'s route guard) — none of those four consumer files need code changes, since they already call the shared functions generically. `settings-tab-access.ts` and a small inline check in `handover.tsx` handle the two in-page tab systems the same way. This is a frontend-only, no-migration change.

**Tech Stack:** React, TanStack Router, `vitest` for tests (run via `bunx vitest run <file>`).

## Global Constraints

- No backend/API/database changes. No Prisma migration.
- No code changes to `Sidebar.tsx`, `BottomNav.tsx`, `CommandPalette.tsx`, or `_app.tsx` — they already consume `getAllowedPrimaryPathsForRole()`/`isPathAllowedForRole()`/`CRM_NAV_ITEMS`/`CRM_GROUP_LABELS` generically; only the underlying data changes.
- `getAllowedPrimaryPathsForRole('superadmin')` currently returns `null` (meaning "unrestricted"). This must change to return `SUPERADMIN_PATHS` like every other role — superadmin is now the most page-restricted role, not the least. This is the single most important behavior change in this plan; verify it explicitly.
- Help (`/help`) is not role-gated — implement this by adding `/help` to all four path arrays (reusing the existing filter mechanism), not by adding a bypass branch to any consumer component.
- Every array's first element must be a page that role can actually reach (the `_app.tsx` guard redirects disallowed navigation to `allowedPaths[0]`) — do not put a page that role can't use first.

---

### Task 1: Restructure `role-access.ts` into four independent per-role path lists

**Files:**
- Modify: `apps/frontend/src/lib/role-access.ts:37-88` (the `SALES_PATHS`/`LEADER_PATHS`/`CEO_PATHS`/`SUPERADMIN_PATHS` constants and the `superadmin` branch of `getAllowedPrimaryPathsForRole`)
- Modify: `apps/frontend/src/lib/role-access.test.ts` (replace outdated superset assertions)

**Interfaces:**
- Produces: `SALES_PATHS`, `LEADER_PATHS`, `CEO_PATHS`, `SUPERADMIN_PATHS: string[]` (no longer nested — each is a standalone array). `getAllowedPrimaryPathsForRole(role): string[] | null` keeps its exact signature; only fail-closed-to-`SALES_PATHS` behavior for unrecognized roles is retained, the `superadmin` special case is removed. Task 4/5 don't consume these directly; Task 3's `crm-navigation.ts` additions are consumed by whichever of these four arrays list that item's path.

- [ ] **Step 1: Update the failing tests first**

Replace the full contents of `apps/frontend/src/lib/role-access.test.ts`:

```typescript
// apps/frontend/src/lib/role-access.test.ts
import { describe, expect, test } from 'vitest'
import {
	getAllowedPrimaryPathsForRole,
	isPathAllowedForRole,
	SALES_PATHS,
	LEADER_PATHS,
	CEO_PATHS,
	SUPERADMIN_PATHS,
} from './role-access'

describe('role-access: sales/leader/ceo/superadmin', () => {
	test('each role gets its own independent path list', () => {
		expect(getAllowedPrimaryPathsForRole('sales')).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole('leader')).toEqual(LEADER_PATHS)
		expect(getAllowedPrimaryPathsForRole('ceo')).toEqual(CEO_PATHS)
		expect(getAllowedPrimaryPathsForRole('superadmin')).toEqual(SUPERADMIN_PATHS)
	})

	test('superadmin is restricted, not unrestricted', () => {
		const allowed = getAllowedPrimaryPathsForRole('superadmin')
		expect(allowed).not.toBeNull()
		expect(isPathAllowedForRole('/chat', 'superadmin')).toBe(false)
		expect(isPathAllowedForRole('/orders', 'superadmin')).toBe(false)
		expect(isPathAllowedForRole('/developers', 'superadmin')).toBe(true)
	})

	test('ceo is monitoring-only: no Leader operational pages', () => {
		expect(isPathAllowedForRole('/broadcast', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/ai-agents', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/chat', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/orders', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/analytics', 'ceo')).toBe(true)
		expect(isPathAllowedForRole('/kelola-tim', 'ceo')).toBe(true)
	})

	test('leader has the full operational toolset but not developers', () => {
		expect(isPathAllowedForRole('/kelola-tim', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/broadcast', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/analytics', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/developers', 'leader')).toBe(false)
	})

	test('sales is restricted to day-to-day operational pages', () => {
		expect(isPathAllowedForRole('/kelola-tim', 'sales')).toBe(false)
		expect(isPathAllowedForRole('/dashboard', 'sales')).toBe(true)
		expect(isPathAllowedForRole('/chat', 'sales')).toBe(true)
		expect(isPathAllowedForRole('/handover', 'sales')).toBe(true)
	})

	test('help is reachable by every role', () => {
		expect(isPathAllowedForRole('/help', 'sales')).toBe(true)
		expect(isPathAllowedForRole('/help', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/help', 'ceo')).toBe(true)
		expect(isPathAllowedForRole('/help', 'superadmin')).toBe(true)
	})

	test('an unrecognized or missing role fails closed to the most restrictive tier', () => {
		expect(getAllowedPrimaryPathsForRole('made-up-role')).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole(null)).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole(undefined)).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole('')).toEqual(SALES_PATHS)
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/frontend && bunx vitest run src/lib/role-access.test.ts`
Expected: FAIL — several assertions contradict the current nested-superset arrays and the current `null` return for superadmin.

- [ ] **Step 3: Replace the path constants and the `superadmin` branch**

In `apps/frontend/src/lib/role-access.ts`, replace lines 37-88 (from `export const SALES_PATHS = ...` through the end of `getAllowedPrimaryPathsForRole`) with:

```typescript
export const SALES_PATHS = ['/dashboard', '/chat', '/handover', '/orders', '/customers', '/settings', '/help']

export const LEADER_PATHS = [
	'/dashboard',
	'/chat',
	'/handover',
	'/orders',
	'/kelola-tim',
	'/customers',
	'/products',
	'/product-stock',
	'/pipeline',
	'/broadcast',
	'/templates',
	'/flows',
	'/ai-agents',
	'/ai',
	'/knowledge',
	'/analytics',
	'/metrics',
	'/apps/meta-ads-tracker',
	'/integration',
	'/channels/whatsapp',
	'/channels/facebook',
	'/channels/line',
	'/channels/telegram',
	'/channels/livechat',
	'/channels/bot',
	'/channels/custom',
	'/settings',
	'/help',
]

export const CEO_PATHS = ['/dashboard', '/kelola-tim', '/analytics', '/metrics', '/settings', '/help']

export const SUPERADMIN_PATHS = ['/kelola-tim', '/developers', '/channels/whatsapp', '/settings', '/help']

/**
 * Returns null when unrestricted, otherwise returns exact allowed top-level paths.
 * An unrecognized or missing role fails CLOSED to SALES_PATHS (the most
 * restrictive tier) rather than falling through to unrestricted — see the
 * Better Auth `role`-field bug fixed earlier, which made every role
 * silently empty and every page silently unrestricted.
 *
 * Each role has its own independent list — CEO and Superadmin are NOT
 * supersets of Leader. CEO is monitoring-only (fewer operational pages
 * than Leader) and Superadmin is technical/IT-only (fewer business pages
 * than CEO), by design.
 */
export function getAllowedPrimaryPathsForRole(
	role: string | null | undefined,
): string[] | null {
	const normalizedRole = normalizeAppRole(role)

	if (normalizedRole === 'superadmin') return SUPERADMIN_PATHS
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

Note `isPathAllowedForRole` is unchanged (kept for context/clarity — no edit needed there beyond what the replacement above already includes).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/frontend && bunx vitest run src/lib/role-access.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/role-access.ts apps/frontend/src/lib/role-access.test.ts
git commit -m "feat(role-access): replace nested-superset role paths with independent per-role lists"
```

---

### Task 2: Restructure `settings-tab-access.ts` into four independent per-role tab lists

**Files:**
- Modify: `apps/frontend/src/routes/_app/settings-tab-access.ts:15-18`
- Modify: `apps/frontend/src/routes/_app/settings-tab-access.test.ts`

**Interfaces:**
- Produces: `getVisibleSettingsTabIds(role): SettingsNavItemId[]` — same signature, independent-list values. Consumed by `apps/frontend/src/routes/_app/settings.tsx:132` (already wired, not modified by this task).

- [ ] **Step 1: Update the failing tests first**

Replace the full contents of `apps/frontend/src/routes/_app/settings-tab-access.test.ts`:

```typescript
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

	test('leader gets the full operational config set, not pakasir or developer', () => {
		const tabs = getVisibleSettingsTabIds('leader')
		expect(tabs).toContain('general')
		expect(tabs).toContain('ai-models')
		expect(tabs).toContain('customer-level')
		expect(tabs).toContain('labels')
		expect(tabs).toContain('whatsapp')
		expect(tabs).not.toContain('pakasir')
		expect(tabs).not.toContain('developer')
	})

	test('ceo is monitoring-only: personal tabs plus general, nothing operational', () => {
		const tabs = getVisibleSettingsTabIds('ceo')
		expect(tabs).toContain('general')
		expect(tabs).not.toContain('ai-models')
		expect(tabs).not.toContain('whatsapp')
		expect(tabs).not.toContain('pakasir')
		expect(tabs).not.toContain('developer')
	})

	test('superadmin gets technical/system tabs, not Leader business config', () => {
		const tabs = getVisibleSettingsTabIds('superadmin')
		expect(tabs).toContain('developer')
		expect(tabs).toContain('whatsapp')
		expect(tabs).toContain('pakasir')
		expect(tabs).not.toContain('ai-models')
		expect(tabs).not.toContain('customer-level')
		expect(tabs).not.toContain('labels')
	})
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd apps/frontend && bunx vitest run src/routes/_app/settings-tab-access.test.ts`
Expected: FAIL — current `CEO_TABS`/`SUPERADMIN_TABS` are supersets of `LEADER_TABS`, so `ceo` currently contains `ai-models` etc. and lacks the new restrictions.

- [ ] **Step 3: Replace the tab constants**

In `apps/frontend/src/routes/_app/settings-tab-access.ts`, replace lines 15-18:

```typescript
const PERSONAL_TABS: SettingsNavItemId[] = ['security', 'notifications', 'localization']
const LEADER_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'general', 'ai-models', 'customer-level', 'labels']
const CEO_TABS: SettingsNavItemId[] = [...LEADER_TABS, 'pakasir', 'whatsapp']
const SUPERADMIN_TABS: SettingsNavItemId[] = [...CEO_TABS, 'developer']
```

with:

```typescript
const PERSONAL_TABS: SettingsNavItemId[] = ['security', 'notifications', 'localization']
const SALES_TABS: SettingsNavItemId[] = PERSONAL_TABS
const LEADER_TABS: SettingsNavItemId[] = [
	...PERSONAL_TABS,
	'general',
	'ai-models',
	'customer-level',
	'labels',
	'whatsapp',
]
const CEO_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'general']
const SUPERADMIN_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'developer', 'whatsapp', 'pakasir']
```

Then update `getVisibleSettingsTabIds` (currently lines 20-27) to use `SALES_TABS` instead of the bare `PERSONAL_TABS` for the default/sales case:

```typescript
export function getVisibleSettingsTabIds(role: string | null | undefined): SettingsNavItemId[] {
	const normalized = normalizeAppRole(role)

	if (normalized === 'superadmin') return SUPERADMIN_TABS
	if (normalized === 'ceo') return CEO_TABS
	if (normalized === 'leader') return LEADER_TABS
	return SALES_TABS
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd apps/frontend && bunx vitest run src/routes/_app/settings-tab-access.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/routes/_app/settings-tab-access.ts apps/frontend/src/routes/_app/settings-tab-access.test.ts
git commit -m "feat(settings): make CEO monitoring-only and Superadmin technical-only in tab access"
```

---

### Task 3: Add new nav groups and orphan-page nav items to `crm-navigation.ts`

**Files:**
- Modify: `apps/frontend/src/lib/crm-navigation.ts` (icon imports at lines 2-16, `CrmNavGroup` type at line 18, `CRM_NAV_ITEMS` array at lines 29-124, `CRM_GROUP_LABELS` at lines 146-151)
- Create: `apps/frontend/src/lib/crm-navigation.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1-2.
- Produces: 9 new entries in `CRM_NAV_ITEMS` (ids: `pipeline`, `templates`, `product-stock`, `analytics`, `metrics`, `meta-ads-tracker`, `integration`, `developers`, `help`) and 2 new `CrmNavGroup` values (`'laporan'`, `'sistem'`). `Sidebar.tsx` (unmodified) filters this array through Task 1's `getAllowedPrimaryPathsForRole()` — an item only becomes visible once both this task adds it AND Task 1's matching path array includes its `path`.

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/lib/crm-navigation.test.ts`:

```typescript
import { describe, expect, test } from 'vitest'
import { CRM_NAV_ITEMS, CRM_GROUP_LABELS } from './crm-navigation'

describe('crm-navigation: new orphan-page nav items', () => {
	const byId = (id: string) => CRM_NAV_ITEMS.find((item) => item.id === id)

	test('laporan and sistem groups exist with labels', () => {
		expect(CRM_GROUP_LABELS.laporan).toBe('Laporan')
		expect(CRM_GROUP_LABELS.sistem).toBe('Sistem')
	})

	test('new nav items exist with the correct path and group', () => {
		expect(byId('pipeline')).toMatchObject({ path: '/pipeline', group: 'data' })
		expect(byId('templates')).toMatchObject({ path: '/templates', group: 'outreach' })
		expect(byId('product-stock')).toMatchObject({ path: '/product-stock', group: 'data' })
		expect(byId('analytics')).toMatchObject({ path: '/analytics', group: 'laporan' })
		expect(byId('metrics')).toMatchObject({ path: '/metrics', group: 'laporan' })
		expect(byId('meta-ads-tracker')).toMatchObject({
			path: '/apps/meta-ads-tracker',
			group: 'laporan',
		})
		expect(byId('integration')).toMatchObject({ path: '/integration', group: 'sistem' })
		expect(byId('developers')).toMatchObject({ path: '/developers', group: 'sistem' })
		expect(byId('help')).toMatchObject({ path: '/help', group: 'sistem' })
	})

	test('every nav item has a unique id and path', () => {
		const ids = CRM_NAV_ITEMS.map((item) => item.id)
		const paths = CRM_NAV_ITEMS.map((item) => item.path)
		expect(new Set(ids).size).toBe(ids.length)
		expect(new Set(paths).size).toBe(paths.length)
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && bunx vitest run src/lib/crm-navigation.test.ts`
Expected: FAIL — none of the 9 new ids exist yet, and `laporan`/`sistem` labels are undefined.

- [ ] **Step 3: Add the new icon imports**

In `apps/frontend/src/lib/crm-navigation.ts`, replace the `lucide-react` import (lines 2-16):

```typescript
import {
	BarChart3,
	BookOpen,
	Boxes,
	Bot,
	Code2,
	FileText,
	HelpCircle,
	Kanban,
	LayoutDashboard,
	Megaphone,
	MessagesSquare,
	Network,
	Package,
	Plug,
	Radio,
	Settings,
	ShoppingCart,
	Shuffle,
	UserCog,
	Users,
	WandSparkles,
} from 'lucide-react'
```

- [ ] **Step 4: Add the new `CrmNavGroup` values**

Change line 18:

```typescript
export type CrmNavGroup = 'operasional' | 'data' | 'outreach' | 'otomasi'
```

to:

```typescript
export type CrmNavGroup = 'operasional' | 'data' | 'outreach' | 'otomasi' | 'laporan' | 'sistem'
```

- [ ] **Step 5: Add the 9 new nav items**

In `apps/frontend/src/lib/crm-navigation.ts`, insert the following entries into `CRM_NAV_ITEMS` right before the closing `]` (after the existing `settings` entry, currently ending at line 123):

```typescript
	{
		id: 'pipeline',
		label: 'Pipeline',
		path: '/pipeline',
		group: 'data',
		icon: Kanban,
	},
	{
		id: 'product-stock',
		label: 'Product Stock',
		path: '/product-stock',
		group: 'data',
		icon: Boxes,
	},
	{
		id: 'templates',
		label: 'Templates',
		path: '/templates',
		group: 'outreach',
		icon: FileText,
	},
	{
		id: 'analytics',
		label: 'Analytics',
		path: '/analytics',
		group: 'laporan',
		icon: BarChart3,
	},
	{
		id: 'metrics',
		label: 'Metrics',
		path: '/metrics',
		group: 'laporan',
		icon: Radio,
	},
	{
		id: 'meta-ads-tracker',
		label: 'Meta Ads Tracker',
		path: '/apps/meta-ads-tracker',
		group: 'laporan',
		icon: Megaphone,
	},
	{
		id: 'integration',
		label: 'Integration',
		path: '/integration',
		group: 'sistem',
		icon: Plug,
	},
	{
		id: 'developers',
		label: 'Developers',
		path: '/developers',
		group: 'sistem',
		icon: Code2,
	},
	{
		id: 'help',
		label: 'Help',
		path: '/help',
		group: 'sistem',
		icon: HelpCircle,
	},
```

- [ ] **Step 6: Add the 2 new group labels**

Change `CRM_GROUP_LABELS` (currently lines 146-151):

```typescript
export const CRM_GROUP_LABELS: Record<CrmNavGroup, string> = {
	operasional: 'Operasional',
	data: 'Data',
	outreach: 'Outreach',
	otomasi: 'Otomasi',
}
```

to:

```typescript
export const CRM_GROUP_LABELS: Record<CrmNavGroup, string> = {
	operasional: 'Operasional',
	data: 'Data',
	outreach: 'Outreach',
	otomasi: 'Otomasi',
	laporan: 'Laporan',
	sistem: 'Sistem',
}
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/frontend && bunx vitest run src/lib/crm-navigation.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 8: Commit**

```bash
git add apps/frontend/src/lib/crm-navigation.ts apps/frontend/src/lib/crm-navigation.test.ts
git commit -m "feat(navigation): wire orphan pages into sidebar with new Laporan/Sistem groups"
```

---

### Task 4: Delete confirmed dead-code route files

**Files:**
- Delete: `apps/frontend/src/routes/_app/apps/index.tsx`
- Delete: `apps/frontend/src/routes/_app/apps/$appSlug.tsx`
- Delete: `apps/frontend/src/routes/_app/conversations/$conversationId.tsx`
- Delete: `apps/frontend/src/routes/_app/team.tsx`

**Interfaces:**
- Consumes: nothing (fully independent of Tasks 1-3, 5).
- Produces: nothing consumed elsewhere — these routes have zero inbound references per the spec's investigation (`apps/index.tsx`/`apps/$appSlug.tsx` are unreferenced SaaS-marketplace leftovers, `conversations/$conversationId.tsx` is a superseded standalone chat view, `team.tsx`'s route unconditionally redirects to `/kelola-tim` before rendering, making its component permanently unreachable).

- [ ] **Step 1: Verify each file is truly unreferenced before deleting**

Run:

```bash
cd /home/deskastudio/Projects/Work/Piranusa/crm-app
grep -rn "apps/\$appSlug\|to=\"/apps\"\|to: '/apps'\|apps/index" apps/frontend/src --include=*.tsx --include=*.ts | grep -v routeTree.gen.ts | grep -v "routes/_app/apps/"
grep -rn "conversations/\$conversationId\|to=\"/conversations\|to: '/conversations'" apps/frontend/src --include=*.tsx --include=*.ts | grep -v routeTree.gen.ts | grep -v "routes/_app/conversations/"
grep -rn "'/team'\|to=\"/team\"\|to: '/team'" apps/frontend/src --include=*.tsx --include=*.ts | grep -v routeTree.gen.ts | grep -v "routes/_app/team.tsx"
```

Expected: no output from any of the three commands (confirms no other file references these routes). If any command prints a match outside the files being deleted, stop and investigate before proceeding — do not delete a file with a live reference.

- [ ] **Step 2: Delete the files**

```bash
git rm apps/frontend/src/routes/_app/apps/index.tsx
git rm apps/frontend/src/routes/_app/apps/\$appSlug.tsx
git rm apps/frontend/src/routes/_app/conversations/\$conversationId.tsx
git rm apps/frontend/src/routes/_app/team.tsx
```

- [ ] **Step 3: Regenerate the route tree and verify the app still builds**

Run: `cd apps/frontend && npx vite build` (or `bun run dev` and confirm the dev server starts cleanly — the TanStack Router Vite plugin regenerates `routeTree.gen.ts` automatically on either)
Expected: build/dev server succeeds with no reference errors to the four deleted routes. `routeTree.gen.ts` no longer contains entries for `/apps/`, `/apps/$appSlug`, `/conversations/$conversationId`, or `/team`.

- [ ] **Step 4: Commit**

```bash
git add -A apps/frontend/src/routeTree.gen.ts
git commit -m "chore: delete dead apps-marketplace, legacy-conversations, and unreachable team routes"
```

---

### Task 5: Gate Handover's tabs by role and do full cross-role verification

**Files:**
- Modify: `apps/frontend/src/routes/_app/handover.tsx` (imports at line 1-7, component state at line 440-450, tab rendering at line 614-627)

**Interfaces:**
- Consumes: `extractNormalizedRole` from `apps/frontend/src/lib/role-access.ts` (unchanged export from Task 1).
- Produces: nothing consumed by other tasks — this is the last task.

- [ ] **Step 1: Add the role-reading state**

In `apps/frontend/src/routes/_app/handover.tsx`, add the import (alongside the existing `@/lib/...` imports at the top of the file):

```typescript
import { extractNormalizedRole } from '@/lib/role-access'
```

Then, in `HandoverPage` (starting at line 440), add a `currentRole` state right after the existing `const [tab, setTab] = useState<HandoverTab>('queue')` line (line 443), following the exact same pattern already used in `apps/frontend/src/routes/_app/settings.tsx:113-130`:

```typescript
	const [currentRole, setCurrentRole] = useState('')

	useEffect(() => {
		if (typeof localStorage === 'undefined') return
		const stored = localStorage.getItem('scalechat_user')
		if (!stored) return
		try {
			const parsed = JSON.parse(stored) as any
			const candidate =
				parsed && typeof parsed.user === 'object' && parsed.user
					? parsed.user
					: parsed
			if (!candidate || typeof candidate !== 'object') return
			setCurrentRole(extractNormalizedRole(candidate))
		} catch {
			// ignore invalid local storage
		}
	}, [])
```

- [ ] **Step 2: Filter the tabs shown to Sales**

In `apps/frontend/src/routes/_app/handover.tsx`, the tab-button row currently reads (around line 614-627):

```tsx
			<div className="flex w-fit items-center rounded-lg border border-border bg-card p-1">
				{tabs.map((item) => (
```

Change it to compute a filtered list right before that block (immediately after the `tabs` useMemo, currently ending around line 555) and render that instead:

```typescript
	const visibleTabs = currentRole === 'sales' ? tabs.filter((item) => item.id === 'queue') : tabs
```

```tsx
			<div className="flex w-fit items-center rounded-lg border border-border bg-card p-1">
				{visibleTabs.map((item) => (
```

Sales' `tab` state already defaults to `'queue'` (line 443, unchanged), so there is no way for a Sales user to reach a hidden tab — no additional reset effect is needed.

- [ ] **Step 3: Manual verification — Sales sees only Queue**

Run the app (`bun run dev` at the repo root), log in as `lukman@piranusa.com` / `123` (a seeded sales account), open Handover. Confirm only one tab button ("Active Queue · N") is visible, and the Rules/Roster/Logs tabs and their content are not reachable.

- [ ] **Step 4: Manual verification — Leader sees all tabs**

Log in as `beni@piranusa.com` / `123` (seeded leader account), open Handover. Confirm all four tabs (Active Queue, Escalation Rules, CS Roster, Handover Logs) are visible and switchable.

- [ ] **Step 5: Full cross-role sidebar verification**

Log in as each of the remaining seeded accounts and confirm the sidebar exactly matches the mapping table in `docs/superpowers/specs/2026-07-10-sidebar-role-redesign-design.md`:

- `kristian@piranusa.com` / `123` (ceo): sidebar shows only Dashboard, Kelola Tim (read-only), Analytics, Metrics, Settings, Help. Confirm navigating directly to `/chat` or `/broadcast` by URL redirects away (per the `_app.tsx` guard).
- `superadmin@piranusa.com` / `123` (superadmin): sidebar shows only Kelola Tim, Developers, Settings, Help — notably NOT Dashboard, Chat, or any business-operational page. Confirm `/developers` reaches all four sub-pages (Webhooks, API Tools, Messages sent by API, API Documentation) via the existing hub links.
- `nurhayati@piranusa.com` / `123` (sales): sidebar shows Dashboard, Inbox, Handover, Orders, Customers, Settings, Help only.

Confirm all three URLs for the deleted routes (`/apps`, `/apps/anything`, `/conversations/anything`, `/team`) return a 404/not-found page for every role.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/routes/_app/handover.tsx
git commit -m "feat(handover): restrict Sales to the Queue tab only"
```
