# Lead Source Attribution Design

## Context

This is the first sub-project of a broader "Stage 2: missing features" effort
that follows the RBAC refactor
(`docs/superpowers/specs/2026-07-09-rbac-refactor-design.md`) and the
still-open Stage 1 sidebar/menu redesign. The user's long-term vision for
Stage 2 has four parts: (1) know which ad/promo brought in a lead, (2)
AI-driven auto-assignment of leads to a specific sales rep without a slow
manual-approval wait, (3) AI contacting leads directly via that sales rep's
own WhatsApp number, and (4) persona/history tracking across conversations.
The user chose to design and build part (1) first, as the cheapest and
fastest to show value: once ad referral is captured, you immediately know
which campaign is producing the most/best leads.

Investigation of the current codebase found:

- `extractMessageContent()` in `apps/backend/src/modules/webhook/service.ts`
  parses `text`/`image`/`video`/`audio`/`document`/`interactive`/`button`
  message types but never reads `message.referral` — the object WhatsApp
  Business Cloud API attaches to the first inbound message when a user taps
  a Click-to-WhatsApp (CTWA) ad (`ctwa_clid`, `source_url`, `source_type`,
  `headline`, media info).
- The `contacts` Prisma model already has unused, ready-to-use fields for
  this: `source` (`VarChar(100)`) and `custom_attributes` (`Json`). No schema
  migration is needed.
- There is no admin UI today for managing "campaigns" or promo links, and
  the user explicitly chose not to build one for this iteration (see
  Approach below) — manual campaign links are just plain `wa.me` links with
  a prefilled text code, no new UI required to create them.

## Goals

- Automatically capture which Meta ad (via CTWA `referral`) drove a new
  WhatsApp contact, with no manual step.
- Support a second, non-Meta source: manually distributed `wa.me` links with
  a prefilled promo code as the message text (e.g. shared on Instagram bio,
  printed flyers), detected by pattern-matching the first inbound message.
- Store this once per contact, at first contact creation (first-touch
  attribution).
- Surface the captured source as a small badge on the Chat and Customers
  pages, next to the contact's name.
- Add a "Sumber Leads" section to the Analytics page showing lead counts
  grouped by source/label over a selected date range.

## Non-goals

- No campaign-management admin UI (no CRUD screens for defining promo codes
  or generating trackable links). The user explicitly picked the
  parse-the-first-message approach over building this UI.
- No multi-touch attribution. If an existing contact returns via a different
  ad or promo later, their stored source is **not** updated — only the
  original first-touch value is kept. This is a known, accepted limitation
  for v1.
- No conversion/closing-rate tracking per source (would require joining to
  order/transaction data). Analytics v1 only counts inbound leads per source.
- No changes to the auto-escalation/round-robin distribution engine in
  `webhook/service.ts` — that is Stage 2 sub-project 2 (auto-assign),
  designed separately.

## Data model

No migration required. `contacts.custom_attributes.leadSource` (a JSON
field that already exists and is otherwise unused) carries all attribution
data:

- `meta_ad`: `{ type: 'meta_ad', headline?, sourceUrl?, sourceType?, ctwaClid? }`
- `manual_promo`: `{ type: 'manual_promo', code: string }`
- `organic`: omitted entirely (no `leadSource` key at all)

**Correction made during implementation planning:** the original draft of
this section proposed also writing the category into `contacts.source`.
That column turned out to already be in use as a channel-origin label
(`'whatsapp_webhook'`, `'instagram_webhook'`, `'tiktok_webhook'`, etc.),
written by the existing webhook contact-creation code and read by
`apps/backend/src/modules/customer/service.ts:306` as a fallback display
value. Overwriting it would have silently broken that. `contacts.source` is
therefore left untouched — attribution lives exclusively in
`custom_attributes.leadSource`. A contact with no `leadSource` key (created
before this feature shipped, or genuinely organic) is treated as "no badge"
in the UI, not an error state.

## Capture logic

Runs exactly once, at the point where a brand-new `contacts` row is created
for a first-time inbound WhatsApp message (the existing contact
find-or-create path in the webhook handler). It must **not** re-run on
subsequent messages from a contact that already exists.

Detection order:

1. **Meta ad referral**: if the inbound webhook payload's `message.referral`
   object is present, extract `source_type`, `headline`, `source_url`,
   `ctwa_clid` and set
   `custom_attributes.leadSource = { type: 'meta_ad', headline?, sourceUrl?, sourceType?, ctwaClid? }`.
2. **Manual promo code**: else, if the *entire* text of the first inbound
   message matches a simple pattern — uppercase letters, digits, and
   underscores only, length 3–30 (e.g. `PROMO_LEBARAN`) — treat it as a
   promo code from a manually distributed link and set
   `custom_attributes.leadSource = { type: 'manual_promo', code: <the text> }`.
3. **Organic**: else, leave `leadSource` unset entirely.

The promo-code pattern is intentionally strict (whole-message match, no
spaces, no lowercase) to minimize the chance an ordinary customer message
gets misclassified as a promo code.

## UI: Chat and Customers badge

A small badge rendered next to the contact's name/avatar, sourced from
fields already present on the contact/conversation objects these pages
already fetch (add `source` + `custom_attributes.leadSource` to those
existing response payloads — no new endpoints needed):

| `source` | Badge |
|---|---|
| `meta_ad` | "📢 Iklan: {headline}" (fallback to `sourceType` if no headline) |
| `manual_promo` | "🔗 Promo: {code}" |
| `organic` | no badge, or a subdued "Chat langsung" label |
| `null` | no badge |

## Analytics: "Sumber Leads" section

New section on the Analytics page (already slated for Stage 1 sidebar
wiring for Leader/CEO). Query: count `contacts` grouped by
`custom_attributes.leadSource.type` (defaulting to `'organic'` when absent)
and, for `meta_ad`/`manual_promo`, by their label (`leadSource.headline` /
`leadSource.code`), filtered to the selected date range (by
`contacts.created_at` or equivalent).

Example table shape:

| Sumber | Label | Jumlah Leads |
|---|---|---|
| Iklan Meta | Diskon Lebaran 50% | 42 |
| Promo Manual | PROMO_LEBARAN | 18 |
| Organik | – | 30 |

Access follows the Stage 1 decision already made for Analytics generally:
visible to Leader and CEO (CEO read-only), not visible to Sales.

## Testing

- Unit test the capture-detection function with three cases: payload with
  `referral` present, payload without `referral` but text matching the
  promo-code pattern, and payload with ordinary free-text (must resolve to
  `organic`).
- Manual verification: send a test webhook payload containing a `referral`
  object and confirm the resulting contact row has
  `custom_attributes.leadSource.type = 'meta_ad'` with the expected fields;
  send a message with text `TEST_PROMO` and confirm
  `custom_attributes.leadSource = { type: 'manual_promo', code: 'TEST_PROMO' }`.
