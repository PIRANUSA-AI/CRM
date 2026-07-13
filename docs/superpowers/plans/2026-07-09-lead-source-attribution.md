# Lead Source Attribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture which Meta ad or manually-distributed promo link brought in a WhatsApp lead, and surface it in Chat, Customers, and a new "Sumber Leads" Analytics section.

**Architecture:** Capture happens once, server-side, at the moment a brand-new `contacts` row is created in the WhatsApp webhook path (`webhook/service.ts`). The result is written into the existing `contacts.custom_attributes.leadSource` JSON field — `contacts.source` is left untouched because it already holds an unrelated value (`'whatsapp_webhook'` / `'instagram_webhook'` / etc., read by `customer/service.ts`). Two read paths expose it: the conversation contact-detail endpoint (for the Chat header) and the existing Customers DTO (which already returns the whole `custom_attributes` object, so no backend change is needed there). A new `/metrics/lead-sources` endpoint aggregates counts for the Analytics page.

**Tech Stack:** Bun, Elysia, Prisma (Postgres), React (TanStack Router), Recharts. Tests via `bun:test`, run per-file with `bun test <path>`.

## Global Constraints

- No Prisma migration — `contacts.source` and `contacts.custom_attributes` already exist.
- Do NOT change the meaning or value of `contacts.source` (it is already used as a channel-origin string, e.g. `'whatsapp_webhook'`, read by `apps/backend/src/modules/customer/service.ts:306`). Lead-source attribution lives exclusively in `custom_attributes.leadSource`.
- Scope is the official WhatsApp Cloud API inbound path only (`storeIncomingWhatsAppMessage` → `storeNormalizedWhatsAppInboundMessage` in `apps/backend/src/modules/webhook/service.ts`). Do not touch the Instagram or TikTok contact-creation branches, and do not touch the Baileys-bridge WhatsApp branch (`message.received` event handler around line 1860) — it has no ad referral data and is out of scope.
- First-touch only: the capture logic only runs in the `contacts.create` branch (brand-new contact), never on `contacts.update`.
- `/metrics/lead-sources` is Leader/CEO/Superadmin only, per the Stage 1 Analytics access decision — guard with `requireRole(userId, ['leader', 'ceo', 'superadmin'])` from `apps/backend/src/lib/require-role.ts`.
- Follow this repo's established test-export convention: extract pure logic into a plain function, export it via the module's existing `__test__` object, and unit-test through that import — do not hit Prisma/the DB in tests for this feature.
- After each task that touches a module with a `codemap.md`, append a short note to that file's relevant section (`## Flow` / `## Integration`) describing the new behavior — do not rewrite the whole file, just add what's new.

---

### Task 1: Capture lead source on new WhatsApp contacts

**Files:**
- Modify: `apps/backend/src/modules/webhook/service.ts` (add helper near `extractMessageContent`, line 584-662; wire into `storeNormalizedWhatsAppInboundMessage`'s create branch, currently lines 4509-4525; add to `__test__` export at line 5216-5220)
- Modify: `apps/backend/src/modules/webhook/codemap.md` (append one line to `## Flow`)
- Create: `apps/backend/test/webhook-lead-source.test.ts`

**Interfaces:**
- Produces: `resolveLeadSourceForNewContact(params: { referral?: unknown; firstMessageText: string }): WhatsAppLeadSource` where
  `WhatsAppLeadSource = { type: 'meta_ad'; headline?: string; sourceType?: string; sourceUrl?: string; ctwaClid?: string } | { type: 'manual_promo'; code: string } | { type: 'organic' }`.
  Task 3 and Task 2 both read the `custom_attributes.leadSource` JSON this produces (shape: same as `WhatsAppLeadSource`, minus the `type: 'organic'` case which is simply omitted/absent).

- [ ] **Step 1: Write the failing test**

Create `apps/backend/test/webhook-lead-source.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { __test__ } from '../src/modules/webhook/service'

const { resolveLeadSourceForNewContact } = __test__

describe('resolveLeadSourceForNewContact', () => {
	it('captures Meta CTWA ad referral when present', () => {
		const result = resolveLeadSourceForNewContact({
			referral: {
				source_type: 'ad',
				source_url: 'https://fb.me/abc123',
				headline: 'Diskon Lebaran 50%',
				ctwa_clid: 'clid-xyz',
			},
			firstMessageText: 'Halo, saya mau tanya produknya',
		})

		expect(result).toEqual({
			type: 'meta_ad',
			headline: 'Diskon Lebaran 50%',
			sourceType: 'ad',
			sourceUrl: 'https://fb.me/abc123',
			ctwaClid: 'clid-xyz',
		})
	})

	it('detects a manual promo code when the whole message matches the pattern', () => {
		const result = resolveLeadSourceForNewContact({
			referral: undefined,
			firstMessageText: 'PROMO_LEBARAN',
		})

		expect(result).toEqual({ type: 'manual_promo', code: 'PROMO_LEBARAN' })
	})

	it('falls back to organic for ordinary free-text messages', () => {
		const result = resolveLeadSourceForNewContact({
			referral: undefined,
			firstMessageText: 'Halo, apakah masih ada stok?',
		})

		expect(result).toEqual({ type: 'organic' })
	})

	it('ignores an empty referral object and falls back to text detection', () => {
		const result = resolveLeadSourceForNewContact({
			referral: {},
			firstMessageText: 'TEST_CODE',
		})

		expect(result).toEqual({ type: 'manual_promo', code: 'TEST_CODE' })
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/webhook-lead-source.test.ts`
Expected: FAIL — `__test__.resolveLeadSourceForNewContact` is undefined (function doesn't exist yet).

- [ ] **Step 3: Add the helper function**

In `apps/backend/src/modules/webhook/service.ts`, immediately after the closing brace of `extractMessageContent` (currently ends at line 662), insert:

```typescript
type WhatsAppLeadSource =
	| {
			type: 'meta_ad'
			headline?: string
			sourceType?: string
			sourceUrl?: string
			ctwaClid?: string
	  }
	| { type: 'manual_promo'; code: string }
	| { type: 'organic' }

const MANUAL_PROMO_CODE_PATTERN = /^[A-Z0-9_]{3,30}$/

function resolveLeadSourceForNewContact(params: {
	referral?: unknown
	firstMessageText: string
}): WhatsAppLeadSource {
	const referral = asRecord(params.referral)
	if (Object.keys(referral).length > 0) {
		return {
			type: 'meta_ad',
			...(asString(referral.headline) ? { headline: asString(referral.headline)! } : {}),
			...(asString(referral.source_type)
				? { sourceType: asString(referral.source_type)! }
				: {}),
			...(asString(referral.source_url) ? { sourceUrl: asString(referral.source_url)! } : {}),
			...(asString(referral.ctwa_clid) ? { ctwaClid: asString(referral.ctwa_clid)! } : {}),
		}
	}

	const text = params.firstMessageText.trim()
	if (MANUAL_PROMO_CODE_PATTERN.test(text)) {
		return { type: 'manual_promo', code: text }
	}

	return { type: 'organic' }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/webhook-lead-source.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Wire the helper into contact creation**

In `apps/backend/src/modules/webhook/service.ts`, inside `storeNormalizedWhatsAppInboundMessage`, the `contacts.create` branch currently reads (around line 4509-4525):

```typescript
			: await prisma.contacts.create({
					data: {
						identifier: deterministicIdentifier,
						name: message.contactName,
						phone_number: senderWaId,
						whatsapp_id: senderWaId,
						channel_type: 'whatsapp',
						app_id: channel.app_id,
						first_contact_at: messageAt,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						source: 'whatsapp_webhook',
						additional_attributes: nextContactAdditionalAttributes as any,
						created_at: messageAt,
					},
				})
```

Change it to:

```typescript
			: await prisma.contacts.create({
					data: {
						identifier: deterministicIdentifier,
						name: message.contactName,
						phone_number: senderWaId,
						whatsapp_id: senderWaId,
						channel_type: 'whatsapp',
						app_id: channel.app_id,
						first_contact_at: messageAt,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						source: 'whatsapp_webhook',
						additional_attributes: nextContactAdditionalAttributes as any,
						custom_attributes: {
							leadSource: resolveLeadSourceForNewContact({
								referral: asRecord(message.rawPayload).referral,
								firstMessageText: message.content,
							}),
						} as any,
						created_at: messageAt,
					},
				})
```

Do not modify the `contacts.update` branch above it — this only runs for brand-new contacts.

- [ ] **Step 6: Export the helper for testing**

In `apps/backend/src/modules/webhook/service.ts`, the existing `__test__` export (currently at line 5216-5220):

```typescript
export const __test__ = {
	extractStatusTimelineTexts,
	splitAssistantTextForDelivery,
	isConversationHandoffActive,
}
```

Add `resolveLeadSourceForNewContact`:

```typescript
export const __test__ = {
	extractStatusTimelineTexts,
	splitAssistantTextForDelivery,
	isConversationHandoffActive,
	resolveLeadSourceForNewContact,
}
```

- [ ] **Step 7: Run the full test file again**

Run: `cd apps/backend && bun test test/webhook-lead-source.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 8: Update the module codemap**

In `apps/backend/src/modules/webhook/codemap.md`, append a sentence to the `## Flow` section:

```markdown

New WhatsApp contacts are tagged with a lead source at creation time (never
updated afterward): `message.referral` (Meta Click-to-WhatsApp ads) or a
promo code detected in the first message text is written to
`contacts.custom_attributes.leadSource`. See
`resolveLeadSourceForNewContact` in `service.ts`.
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/webhook/service.ts apps/backend/src/modules/webhook/codemap.md apps/backend/test/webhook-lead-source.test.ts
git commit -m "feat(webhook): capture WhatsApp lead source on new contacts"
```

---

### Task 2: Analytics aggregation endpoint (`/metrics/lead-sources`)

**Files:**
- Modify: `apps/backend/src/modules/metrics/service.ts` (add `summarizeLeadSources` helper + `MetricsService.getLeadSources`, add to `__test__` export at line 1272-1280)
- Modify: `apps/backend/src/modules/metrics/index.ts` (add `GET /lead-sources` route)
- Modify: `apps/backend/src/modules/metrics/codemap.md` (currently an empty template — fill it in)
- Create: `apps/backend/test/metrics-lead-sources.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1 directly at the type level — reads the same `custom_attributes.leadSource` JSON shape Task 1 writes (`{ type: 'meta_ad' | 'manual_promo'; headline?; sourceType?; code? }` or absent for organic).
- Produces: `type LeadSourceRow = { source: 'meta_ad' | 'manual_promo' | 'organic'; label: string; count: number }` and `MetricsService.getLeadSources(appId: string, period?: string): Promise<LeadSourceRow[]>`. Task 6 (frontend) consumes this exact `LeadSourceRow` shape via the new `/metrics/lead-sources` HTTP response `{ data: LeadSourceRow[] }`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/test/metrics-lead-sources.test.ts`:

```typescript
import { describe, expect, it } from 'bun:test'
import { __test__ } from '../src/modules/metrics/service'

const { summarizeLeadSources } = __test__

describe('summarizeLeadSources', () => {
	it('groups meta_ad contacts by headline and counts them', () => {
		const rows = summarizeLeadSources([
			{ custom_attributes: { leadSource: { type: 'meta_ad', headline: 'Diskon Lebaran' } } },
			{ custom_attributes: { leadSource: { type: 'meta_ad', headline: 'Diskon Lebaran' } } },
			{ custom_attributes: { leadSource: { type: 'meta_ad', headline: 'Promo Ramadan' } } },
		])

		expect(rows).toEqual([
			{ source: 'meta_ad', label: 'Diskon Lebaran', count: 2 },
			{ source: 'meta_ad', label: 'Promo Ramadan', count: 1 },
		])
	})

	it('groups manual_promo contacts by code and treats missing leadSource as organic', () => {
		const rows = summarizeLeadSources([
			{ custom_attributes: { leadSource: { type: 'manual_promo', code: 'PROMO_LEBARAN' } } },
			{ custom_attributes: {} },
			{ custom_attributes: null },
		])

		expect(rows).toEqual([
			{ source: 'manual_promo', label: 'PROMO_LEBARAN', count: 1 },
			{ source: 'organic', label: '-', count: 2 },
		])
	})

	it('returns an empty array for no contacts', () => {
		expect(summarizeLeadSources([])).toEqual([])
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/metrics-lead-sources.test.ts`
Expected: FAIL — `__test__.summarizeLeadSources` is undefined.

- [ ] **Step 3: Add the type and pure grouping helper**

In `apps/backend/src/modules/metrics/service.ts`, near the other row types (after `DashboardVolumeRow`, around line 36), add:

```typescript
type LeadSourceRow = {
	source: 'meta_ad' | 'manual_promo' | 'organic'
	label: string
	count: number
}
```

Then, near `resolveDashboardRange` (after line 243), add the pure grouping function:

```typescript
function summarizeLeadSources(
	contacts: Array<{ custom_attributes: unknown }>,
): LeadSourceRow[] {
	const counts = new Map<string, LeadSourceRow>()

	for (const contact of contacts) {
		const customAttributes =
			contact.custom_attributes && typeof contact.custom_attributes === 'object'
				? (contact.custom_attributes as Record<string, unknown>)
				: {}
		const leadSource =
			customAttributes.leadSource && typeof customAttributes.leadSource === 'object'
				? (customAttributes.leadSource as Record<string, unknown>)
				: {}
		const source: LeadSourceRow['source'] =
			leadSource.type === 'meta_ad' || leadSource.type === 'manual_promo'
				? leadSource.type
				: 'organic'
		const label =
			source === 'meta_ad'
				? (typeof leadSource.headline === 'string' && leadSource.headline) ||
					(typeof leadSource.sourceType === 'string' && leadSource.sourceType) ||
					'Iklan Meta'
				: source === 'manual_promo'
					? (typeof leadSource.code === 'string' && leadSource.code) || '-'
					: '-'

		const key = `${source}::${label}`
		const existing = counts.get(key)
		if (existing) {
			existing.count += 1
		} else {
			counts.set(key, { source, label, count: 1 })
		}
	}

	return Array.from(counts.values()).sort((a, b) => b.count - a.count)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/metrics-lead-sources.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Add the service method**

In `apps/backend/src/modules/metrics/service.ts`, inside `export abstract class MetricsService`, insert this method right after `getDashboard` ends and before `static async getAIMetrics(appId: string) {` (currently line 788):

```typescript
	static async getLeadSources(appId: string, period: string = '7d'): Promise<LeadSourceRow[]> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return []

		const range = resolveDashboardRange(period)
		const contacts = await prisma.contacts.findMany({
			where: {
				app_id: targetAppId,
				channel_type: 'whatsapp',
				deleted_at: null,
				created_at: { gte: range.currentStart, lte: range.currentEnd },
			},
			select: { custom_attributes: true },
		})

		return summarizeLeadSources(contacts)
	}

```

- [ ] **Step 6: Export the helper for testing**

In `apps/backend/src/modules/metrics/service.ts`, the existing `__test__` export (currently line 1272-1280) — add `summarizeLeadSources`:

```typescript
export const __test__ = {
	buildDashboardPayload,
	buildFunnel,
	buildVolume,
	metricValue,
	normalizeDashboardPeriod,
	resolveDashboardRange,
	summarizeLeadSources,
	toNumber,
}
```

(Keep whatever other entries already exist in this object — only add `summarizeLeadSources`.)

- [ ] **Step 7: Add the route**

In `apps/backend/src/modules/metrics/index.ts`, add the import:

```typescript
import { requireRole } from '../../lib/require-role'
```

Then add a new route after the `/dashboard` route (after line 57, before `.get('/ai', ...)`):

```typescript
	.get(
		'/lead-sources',
		async ({ resolvedAppId, integrationAuthError, userId, query, set }) => {
			if (integrationAuthError) {
				set.status = 401
				return { error: integrationAuthError }
			}
			const guard = await requireRole(userId, ['leader', 'ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const rows = await MetricsService.getLeadSources(resolvedAppId, query.period)
			return { data: rows }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				period: t.Optional(
					t.Union([t.Literal('today'), t.Literal('7d'), t.Literal('30d')]),
				),
			}),
		},
	)
```

- [ ] **Step 8: Manual verification**

Run: `cd apps/backend && bun run dev` (or your existing dev process), then:

```bash
curl -s "http://localhost:3010/metrics/lead-sources?period=30d" -H "Authorization: Bearer <a leader/ceo/superadmin token>"
```

Expected: `{"data":[...]}` (array, possibly empty if no WhatsApp contacts exist yet in the 30d window). Confirm a `sales`-role token gets `403`.

- [ ] **Step 9: Fill in the metrics codemap**

`apps/backend/src/modules/metrics/codemap.md` is currently an empty template. Replace it with:

```markdown
# apps/backend/src/modules/metrics/

## Responsibility

Aggregated reporting for the Analytics dashboard: message/customer/agent
summary cards, AI evaluation metrics, and lead-source attribution.

## Design

Stateless service (`MetricsService`, static methods) over Prisma
aggregate/groupBy queries, scoped by `resolveAppId`. Date ranges are
resolved once per request via `resolveDashboardRange`/`resolveSummaryRange`
against Asia/Jakarta day boundaries. Pure helper functions (row-building,
grouping) are separated from the DB-fetching methods and exported via
`__test__` so they can be unit tested without hitting Postgres.

## Flow

Routes (`/metrics/summary`, `/metrics/dashboard`, `/metrics/ai`,
`/metrics/lead-sources`) validate `appId`/`period` query params and delegate
to the matching `MetricsService` method, returning `{ data: ... }`.
`getLeadSources` fetches `whatsapp` contacts created in the selected range
and groups them by `custom_attributes.leadSource` (written by the webhook
module at contact-creation time) via `summarizeLeadSources`.

## Integration

Reads `contacts`, `conversations`, `messages`, and AI evaluation tables via
Prisma. `/metrics/lead-sources` is gated to `leader`/`ceo`/`superadmin` via
`requireRole` (`../../lib/require-role`). Consumed by the frontend
`analytics.tsx` page through `apps/frontend/src/lib/api.ts`'s `metrics`
client.
```

- [ ] **Step 10: Commit**

```bash
git add apps/backend/src/modules/metrics/service.ts apps/backend/src/modules/metrics/index.ts apps/backend/src/modules/metrics/codemap.md apps/backend/test/metrics-lead-sources.test.ts
git commit -m "feat(metrics): add /metrics/lead-sources aggregation endpoint"
```

---

### Task 3: Expose lead source on the conversation contact-detail endpoint

**Files:**
- Modify: `apps/backend/src/modules/conversation/service.ts` (type at line 45-75; Prisma select at line 791; return construction around line 1287)
- Modify: `apps/backend/src/modules/conversation/codemap.md` (append one line to `## Flow`)
- Create: `apps/backend/test/conversation-lead-source.test.ts`

**Interfaces:**
- Consumes: reads the same `custom_attributes.leadSource` JSON Task 1 writes.
- Produces: adds `lead_source: { type: 'meta_ad'; headline?: string; sourceType?: string } | { type: 'manual_promo'; code: string } | null` to `ConversationContactDetail` (and thus to the `GET /conversations/:id/contact-detail` response). Task 4 (Chat header badge) consumes this field.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/test/conversation-lead-source.test.ts`. This tests the pure extraction function you'll add in Step 3 — check the existing `__contactDetailInternals` export in `apps/backend/src/modules/conversation/service.ts` (around line 527) for the naming convention before writing this:

```typescript
import { describe, expect, it } from 'bun:test'
import { __contactDetailInternals } from '../src/modules/conversation/service'

const { resolveContactLeadSource } = __contactDetailInternals

describe('resolveContactLeadSource', () => {
	it('passes through a meta_ad lead source', () => {
		expect(
			resolveContactLeadSource({ leadSource: { type: 'meta_ad', headline: 'Promo A' } }),
		).toEqual({ type: 'meta_ad', headline: 'Promo A' })
	})

	it('passes through a manual_promo lead source', () => {
		expect(
			resolveContactLeadSource({ leadSource: { type: 'manual_promo', code: 'PROMO_A' } }),
		).toEqual({ type: 'manual_promo', code: 'PROMO_A' })
	})

	it('returns null for organic or missing lead source', () => {
		expect(resolveContactLeadSource({ leadSource: { type: 'organic' } })).toBeNull()
		expect(resolveContactLeadSource({})).toBeNull()
		expect(resolveContactLeadSource(null)).toBeNull()
	})

	it('returns null when manual_promo is missing its code', () => {
		expect(
			resolveContactLeadSource({ leadSource: { type: 'manual_promo' } }),
		).toBeNull()
	})
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && bun test test/conversation-lead-source.test.ts`
Expected: FAIL — `__contactDetailInternals.resolveContactLeadSource` is undefined.

- [ ] **Step 3: Add the type and extraction helper**

In `apps/backend/src/modules/conversation/service.ts`, add to the `ConversationContactDetail` type (currently lines 45-75) — insert `lead_source` as a sibling of `customer`:

```typescript
export type ConversationContactDetail = {
	conversation: {
		id: string
		contact_id: string | null
		inbox_id: string | null
		pipeline_id: string | null
		stage_id: string | null
		status: string | null
		channel_type: string | null
	}
	lead_source:
		| { type: 'meta_ad'; headline?: string; sourceType?: string }
		| { type: 'manual_promo'; code: string }
		| null
	customer: {
		id: string | null
		name: string | null
		email: string | null
		phone_number: string | null
		avatar_url: string | null
		is_vip: boolean
		repeat_orders: number
		lifetime_value: number
	} | null
	// ...unchanged fields below (badges, ai_summary, live_signals, etc.)
```

Then add the extraction function near the other exported helpers used by `__contactDetailInternals` (find that export block around line 527 and add both the function definition above it and the key inside it):

```typescript
function resolveContactLeadSource(
	customAttributes: Record<string, unknown> | null | undefined,
):
	| { type: 'meta_ad'; headline?: string; sourceType?: string }
	| { type: 'manual_promo'; code: string }
	| null {
	const record = customAttributes && typeof customAttributes === 'object' ? customAttributes : {}
	const leadSource =
		record.leadSource && typeof record.leadSource === 'object'
			? (record.leadSource as Record<string, unknown>)
			: {}

	if (leadSource.type === 'meta_ad') {
		return {
			type: 'meta_ad',
			...(typeof leadSource.headline === 'string' ? { headline: leadSource.headline } : {}),
			...(typeof leadSource.sourceType === 'string'
				? { sourceType: leadSource.sourceType }
				: {}),
		}
	}

	if (leadSource.type === 'manual_promo' && typeof leadSource.code === 'string') {
		return { type: 'manual_promo', code: leadSource.code }
	}

	return null
}
```

Add `resolveContactLeadSource` to the `__contactDetailInternals` export object (around line 527) alongside its existing entries (e.g. `buildHeuristicSummary`, `resolveBuyingStageSignal`, etc. — keep those, just add this one).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && bun test test/conversation-lead-source.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Select `custom_attributes` in `getConversationById`**

In `apps/backend/src/modules/conversation/service.ts`, the `contacts.select` block inside `getConversationById` (currently lines 784-793, the *second* of the two near-identical blocks — the one inside `static async getConversationById`, NOT the one inside `getConversations`) currently reads:

```typescript
					contacts: {
						select: {
							id: true,
							name: true,
							phone_number: true,
							whatsapp_id: true,
							email: true,
							avatar_url: true,
							identifier: true,
							window_expires_at: true,
							meta: true,
							metadata: true,
							instagram_igsid: true,
						},
					},
```

Add `custom_attributes: true`:

```typescript
					contacts: {
						select: {
							id: true,
							name: true,
							phone_number: true,
							whatsapp_id: true,
							email: true,
							avatar_url: true,
							identifier: true,
							window_expires_at: true,
							meta: true,
							metadata: true,
							instagram_igsid: true,
							custom_attributes: true,
						},
					},
```

Do not touch the other, near-identical `contacts.select` block inside `getConversations` (the conversation list) — that one is out of scope for this task.

- [ ] **Step 6: Populate `lead_source` in the returned object**

In `getContactDetail`, right before the `return {` statement (currently around line 1287), compute the value:

```typescript
		const contactCustomAttributes = asRecord(contactRecord.custom_attributes)
		const leadSource = resolveContactLeadSource(contactCustomAttributes)
```

Then add `lead_source: leadSource,` as a top-level key of the returned object (sibling of `conversation:` and `customer:`):

```typescript
		return {
			conversation: {
				id: asString(conversationRecord.id) || conversationId,
				contact_id: asString(conversationRecord.contact_id),
				inbox_id: asString(conversationRecord.inbox_id),
				pipeline_id: asString(conversationRecord.pipeline_id),
				stage_id: asString(conversationRecord.stage_id),
				status: asString(conversationRecord.status),
				channel_type: asString(conversationRecord.channel_type),
			},
			lead_source: leadSource,
			customer: {
				// ...unchanged
```

- [ ] **Step 7: Manual verification**

Run: `cd apps/backend && bun run dev`, then hit an existing conversation:

```bash
curl -s "http://localhost:3010/conversations/<a real conversation id>/contact-detail" -H "Authorization: Bearer <token>"
```

Expected: response JSON now includes a top-level `lead_source` key (`null` for contacts created before this feature shipped, or an object for new ones once Task 1 is live).

- [ ] **Step 8: Update the module codemap**

In `apps/backend/src/modules/conversation/codemap.md`, append to `## Flow`:

```markdown

`getContactDetail` also surfaces `lead_source` (the ad/promo attribution
captured by the webhook module at contact-creation time), read from
`contacts.custom_attributes.leadSource` via `resolveContactLeadSource`.
```

- [ ] **Step 9: Commit**

```bash
git add apps/backend/src/modules/conversation/service.ts apps/backend/src/modules/conversation/codemap.md apps/backend/test/conversation-lead-source.test.ts
git commit -m "feat(conversation): expose lead_source on contact-detail endpoint"
```

---

### Task 4: Shared frontend badge formatter + Chat header badge

**Files:**
- Create: `apps/frontend/src/lib/lead-source.ts`
- Modify: `apps/frontend/src/lib/api.ts` (add `lead_source` to `ConversationContactDetailResponse`, line 119-138)
- Modify: `apps/frontend/src/routes/_app/chat.tsx` (render badge near line 3036-3040)
- Modify: `apps/frontend/src/lib/codemap.md` (append one line to `## Data & Control Flow`)

**Interfaces:**
- Produces: `formatLeadSourceBadge(leadSource: unknown): string | null` — pure function, no dependencies. Task 5 also imports this exact function from `apps/frontend/src/lib/lead-source.ts`.
- Consumes: `contactDetail?.lead_source` (added to `ConversationContactDetailResponse` by this task, matching the backend shape Task 3 produces).

- [ ] **Step 1: Create the shared formatter with its test**

Create `apps/frontend/src/lib/lead-source.test.ts`, following the same `vitest` convention as the existing `apps/frontend/src/lib/role-access.test.ts`:

```typescript
import { describe, expect, it } from 'vitest'
import { formatLeadSourceBadge } from './lead-source'

describe('formatLeadSourceBadge', () => {
	it('formats a meta_ad lead source using the headline', () => {
		expect(formatLeadSourceBadge({ type: 'meta_ad', headline: 'Diskon Lebaran' })).toBe(
			'📢 Iklan: Diskon Lebaran',
		)
	})

	it('falls back to sourceType when headline is missing', () => {
		expect(formatLeadSourceBadge({ type: 'meta_ad', sourceType: 'ad' })).toBe('📢 Iklan: ad')
	})

	it('formats a manual_promo lead source using the code', () => {
		expect(formatLeadSourceBadge({ type: 'manual_promo', code: 'PROMO_LEBARAN' })).toBe(
			'🔗 Promo: PROMO_LEBARAN',
		)
	})

	it('returns null for organic, null, undefined, or malformed input', () => {
		expect(formatLeadSourceBadge(null)).toBeNull()
		expect(formatLeadSourceBadge(undefined)).toBeNull()
		expect(formatLeadSourceBadge({ type: 'organic' })).toBeNull()
		expect(formatLeadSourceBadge('not an object')).toBeNull()
		expect(formatLeadSourceBadge({ type: 'manual_promo' })).toBeNull()
	})
})
```

(If `role-access.test.ts` uses a different runner/import than `vitest`, match that file's actual imports instead — it is the ground truth for this repo's frontend test setup, not this plan.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && bunx vitest run src/lib/lead-source.test.ts`
Expected: FAIL — cannot find module `./lead-source`.

- [ ] **Step 3: Implement the formatter**

Create `apps/frontend/src/lib/lead-source.ts`:

```typescript
export function formatLeadSourceBadge(leadSource: unknown): string | null {
	if (!leadSource || typeof leadSource !== 'object') return null
	const record = leadSource as Record<string, unknown>

	if (record.type === 'meta_ad') {
		const headline = typeof record.headline === 'string' ? record.headline : null
		const sourceType = typeof record.sourceType === 'string' ? record.sourceType : null
		return `📢 Iklan: ${headline || sourceType || 'Meta Ads'}`
	}

	if (record.type === 'manual_promo' && typeof record.code === 'string') {
		return `🔗 Promo: ${record.code}`
	}

	return null
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && bunx vitest run src/lib/lead-source.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Add `lead_source` to the response type**

In `apps/frontend/src/lib/api.ts`, `ConversationContactDetailResponse` (currently lines 119-138) currently reads:

```typescript
export interface ConversationContactDetailResponse {
	conversation: {
		id: string
		contact_id: string | null
		inbox_id: string | null
		pipeline_id: string | null
		stage_id: string | null
		status: string | null
		channel_type: string | null
	}
	customer: {
		// ...
	} | null
```

Add `lead_source` as a sibling of `customer`:

```typescript
export interface ConversationContactDetailResponse {
	conversation: {
		id: string
		contact_id: string | null
		inbox_id: string | null
		pipeline_id: string | null
		stage_id: string | null
		status: string | null
		channel_type: string | null
	}
	lead_source:
		| { type: 'meta_ad'; headline?: string; sourceType?: string }
		| { type: 'manual_promo'; code: string }
		| null
	customer: {
		// ...unchanged
	} | null
```

- [ ] **Step 6: Render the badge in the Chat header**

In `apps/frontend/src/routes/_app/chat.tsx`:

1. Add the import near the top (alongside other `@/lib/...` imports):

```typescript
import { formatLeadSourceBadge } from '@/lib/lead-source'
```

2. Near `const detailCustomer = contactDetail?.customer || null` (line 2081), add:

```typescript
	const leadSourceBadge = formatLeadSourceBadge(contactDetail?.lead_source)
```

3. In the JSX around line 3036-3040, the existing block reads:

```tsx
										<p className="truncate text-sm font-semibold text-[var(--ocm-text)]">
											{displayName || 'Pelanggan'}
										</p>
										{detailBadges?.vip ? (
											<span className="ocm-tag !text-[10px]">VIP</span>
										) : null}
```

Add the lead-source badge right after the VIP badge:

```tsx
										<p className="truncate text-sm font-semibold text-[var(--ocm-text)]">
											{displayName || 'Pelanggan'}
										</p>
										{detailBadges?.vip ? (
											<span className="ocm-tag !text-[10px]">VIP</span>
										) : null}
										{leadSourceBadge ? (
											<span className="ocm-tag !text-[10px]">{leadSourceBadge}</span>
										) : null}
```

- [ ] **Step 7: Manual verification**

Run the app (`bun run dev` at the repo root, or per this project's `run` skill), open Chat, open a conversation whose contact has a seeded `custom_attributes.leadSource` (or send yourself a test webhook payload with a `referral` object per Task 1's manual verification). Confirm the badge appears next to the contact name in the chat header, and that older contacts (no `leadSource`) show no badge and no error.

- [ ] **Step 8: Update the frontend lib codemap**

In `apps/frontend/src/lib/codemap.md`, add a bullet to `## Data & Control Flow`:

```markdown
- `lead-source.ts` formats the `custom_attributes.leadSource` ad/promo attribution (from the backend webhook/contact-detail modules) into a display badge string, used by Chat and Customer detail
```

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/lib/lead-source.ts apps/frontend/src/lib/lead-source.test.ts apps/frontend/src/lib/api.ts apps/frontend/src/routes/_app/chat.tsx apps/frontend/src/lib/codemap.md
git commit -m "feat(chat): show lead source badge in conversation header"
```

---

### Task 5: Customer detail page badge

**Files:**
- Modify: `apps/frontend/src/routes/_app/customers/$customerId.tsx` (badge JSX near line 238-249)

**Interfaces:**
- Consumes: `formatLeadSourceBadge` from `apps/frontend/src/lib/lead-source.ts` (Task 4) and `customer.custom_attributes?.leadSource`, which is already present in the API response today (`CustomerDTO.custom_attributes` in `apps/backend/src/modules/customer/service.ts` already returns the full parsed JSON object — no backend change needed for this task).

- [ ] **Step 1: Add the import and computed badge**

In `apps/frontend/src/routes/_app/customers/$customerId.tsx`, add the import near the top:

```typescript
import { formatLeadSourceBadge } from '@/lib/lead-source'
```

Find where `customer` is available in the component (it's already used throughout, e.g. `customer.avatar_url`, `customer.name`) and add, near the top of the render logic:

```typescript
	const leadSourceBadge = formatLeadSourceBadge(customer.custom_attributes?.leadSource)
```

- [ ] **Step 2: Render the badge**

The badges row currently reads (around lines 238-249):

```tsx
								<span
									className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
										customer.is_window_active
											? 'bg-emerald-50 text-emerald-600 border-emerald-100'
											: 'bg-gray-50 text-gray-400 border-gray-100'
									}`}
								>
									{customer.is_window_active
										? '● Window Active'
										: '○ Window Expired'}
								</span>
							</div>
```

Add the lead-source badge right before the closing `</div>`:

```tsx
								<span
									className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
										customer.is_window_active
											? 'bg-emerald-50 text-emerald-600 border-emerald-100'
											: 'bg-gray-50 text-gray-400 border-gray-100'
									}`}
								>
									{customer.is_window_active
										? '● Window Active'
										: '○ Window Expired'}
								</span>
								{leadSourceBadge ? (
									<span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border bg-blue-50 text-blue-600 border-blue-100">
										{leadSourceBadge}
									</span>
								) : null}
							</div>
```

- [ ] **Step 3: Manual verification**

Open a customer detail page (`/customers/:id`) for a contact that has `custom_attributes.leadSource` set (from Task 1's manual test, or a manually seeded record). Confirm the badge renders next to the pipeline-stage/window badges, and that customers without a lead source show no badge and no console error.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/routes/_app/customers/\$customerId.tsx
git commit -m "feat(customers): show lead source badge on customer detail page"
```

---

### Task 6: "Sumber Leads" Analytics section

**Files:**
- Modify: `apps/frontend/src/lib/api.ts` (add `LeadSourceRow` type + `metrics.getLeadSources`, near line 1080-1110)
- Modify: `apps/frontend/src/routes/_app/analytics.tsx` (state/fetch near line 73-127; new section after line 500)

**Interfaces:**
- Consumes: `GET /metrics/lead-sources` (Task 2), response shape `{ data: LeadSourceRow[] }` where `LeadSourceRow = { source: 'meta_ad' | 'manual_promo' | 'organic'; label: string; count: number }`.

- [ ] **Step 1: Add the API client method**

In `apps/frontend/src/lib/api.ts`, add near the other type exports (e.g. right before `export const metrics = {` around line 1080):

```typescript
export type LeadSourceRow = {
	source: 'meta_ad' | 'manual_promo' | 'organic'
	label: string
	count: number
}
```

Inside the `metrics` object (currently lines 1080-1110ish, following the exact pattern of `getRouting`/`getAgents` which use `apiRequest` directly because these endpoints aren't wired into the generated treaty types), add:

```typescript
	// Note: Backend doesn't have /metrics/lead-sources wired to treaty types yet
	getLeadSources: (period?: string) => {
		const normalizedPeriod = normalizeMetricsDashboardPeriod(period)
		return apiRequest<{ data: LeadSourceRow[] }>(
			`/metrics/lead-sources?period=${encodeURIComponent(normalizedPeriod)}`,
		)
	},
```

- [ ] **Step 2: Fetch lead sources in the Analytics page**

In `apps/frontend/src/routes/_app/analytics.tsx`:

1. Add the import:

```typescript
import { metrics, type LeadSourceRow } from '@/lib/api'
```

(This replaces the existing `import { metrics } from '@/lib/api'` at line 13 — merge into one import.)

2. Add state near the other `useState` calls (line 74-77):

```typescript
	const [leadSources, setLeadSources] = useState<LeadSourceRow[]>([])
```

3. In `loadData` (currently lines 83-127), fetch it alongside the dashboard call. Change:

```typescript
	const loadData = async () => {
		setLoading(true)
		try {
			const res: any = await metrics.getDashboard(timeRange)
```

to:

```typescript
	const loadData = async () => {
		setLoading(true)
		try {
			const [res, leadSourcesRes]: [any, any] = await Promise.all([
				metrics.getDashboard(timeRange),
				metrics.getLeadSources(timeRange),
			])
			setLeadSources(Array.isArray(leadSourcesRes?.data) ? leadSourcesRes.data : [])
```

Leave the rest of the existing `if (res && res.success && res.data) { ... }` block unchanged — it still operates on `res` exactly as before.

- [ ] **Step 3: Render the "Sumber Leads" section**

In `apps/frontend/src/routes/_app/analytics.tsx`, the "Agent Performance" card currently closes right before the end of the `data ?` branch (around line 500-501):

```tsx
								) : (
									<div className="py-12 text-center text-gray-400">
										<Users size={32} className="mx-auto mb-2 opacity-50" />
										<p className="font-medium">No agent data available</p>
									</div>
								)}
							</div>
						</div>
					) : (
```

Insert a new card between the closing `</div>` of "Agent Performance" and the closing `</div>` of the `space-y-6` wrapper:

```tsx
								) : (
									<div className="py-12 text-center text-gray-400">
										<Users size={32} className="mx-auto mb-2 opacity-50" />
										<p className="font-medium">No agent data available</p>
									</div>
								)}
							</div>

							{/* Lead Sources */}
							<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm overflow-hidden">
								<div className="flex items-center gap-2 mb-8">
									<TrendingUp size={20} className="text-emerald-500" />
									<h3 className="text-lg font-bold text-gray-900">
										Sumber Leads
									</h3>
								</div>
								{leadSources.length > 0 ? (
									<div className="overflow-x-auto -mx-6">
										<table className="w-full min-w-[500px] text-left">
											<thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-gray-400">
												<tr>
													<th className="px-6 py-4">Sumber</th>
													<th className="px-6 py-4">Label</th>
													<th className="px-6 py-4 text-center">Jumlah Leads</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-gray-50">
												{leadSources.map((row, i) => (
													<tr
														key={`${row.source}-${row.label}-${i}`}
														className="hover:bg-gray-50/50 transition-colors"
													>
														<td className="px-6 py-4 font-bold text-gray-900">
															{row.source === 'meta_ad'
																? 'Iklan Meta'
																: row.source === 'manual_promo'
																	? 'Promo Manual'
																	: 'Organik'}
														</td>
														<td className="px-6 py-4 text-gray-600">
															{row.label}
														</td>
														<td className="px-6 py-4 text-center font-bold text-gray-600">
															{row.count}
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								) : (
									<div className="py-12 text-center text-gray-400">
										<TrendingUp size={32} className="mx-auto mb-2 opacity-50" />
										<p className="font-medium">No lead source data available</p>
									</div>
								)}
							</div>
						</div>
					) : (
```

- [ ] **Step 4: Manual verification**

Run the app, log in as `leader` or `ceo`, navigate directly to `/analytics` (it isn't wired into the sidebar yet — that's the separate, still-pending Stage 1 sidebar redesign). Confirm the "Sumber Leads" table renders with data matching the WhatsApp contacts created during Task 1's manual test. Then log in as `sales` and confirm the section either doesn't load or shows an empty/error state gracefully (the endpoint returns 403 — since the rest of the page's `loadData` doesn't currently gate by role either, this is consistent with existing behavior, not a regression).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/lib/api.ts apps/frontend/src/routes/_app/analytics.tsx
git commit -m "feat(analytics): add Sumber Leads section"
```
