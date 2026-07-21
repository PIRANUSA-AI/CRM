/**
 * Deal stages.
 *
 * A "prospek" and an "opportunity" are not separate records. They are one deal
 * at different `probability` values. Below the owning team's `deal_threshold`
 * the deal reads as a prospek; at or above it, an opportunity. Keeping this as
 * one field is what stops the two from drifting apart, which is exactly what
 * happened when opportunities were entered by hand alongside the leads they
 * came from.
 *
 * Stages live in code rather than in `pipeline_stages` on purpose: that table
 * is `pipeline_type = 'contact'` and drives the contact lifecycle shown on the
 * Kontak page, which is a different axis (who someone is) from this one (how
 * far along a specific sale is).
 */

export type DealStage = {
	id: string
	label: string
	/**
	 * Default probability when the sales moves the deal into this stage, or null
	 * for a stage that makes no claim about how likely the sale is. Only Pending
	 * is null: parking a deal because the customer went quiet says nothing about
	 * whether it will close, so the estimate it already carried is kept.
	 */
	probability: number | null
	/** Closed stages stop appearing as active work. */
	status: 'open' | 'won' | 'lost'
}

/**
 * Labels are the English ones the team already used in Qontak, kept verbatim so
 * nobody has to relearn the board they read every morning.
 */
export const DEAL_STAGES: DealStage[] = [
	{ id: 'leads_generation', label: 'Leads Generation', probability: 10, status: 'open' },
	{ id: 'initial_quotation', label: 'Initial Quotation', probability: 20, status: 'open' },
	{ id: 'valid_opportunity', label: 'Valid Opportunity', probability: 30, status: 'open' },
	{ id: 'product_demo', label: 'Product Demo', probability: 40, status: 'open' },
	{ id: 'pending', label: 'Pending', probability: null, status: 'open' },
	{ id: 'budget_timeframe', label: 'Budget & Time Frame', probability: 60, status: 'open' },
	{ id: 'negotiation_po', label: 'Negotiation & Waiting PO', probability: 80, status: 'open' },
	{ id: 'won', label: 'Won', probability: 100, status: 'won' },
	{ id: 'lost', label: 'Lost', probability: 0, status: 'lost' },
]

export const DEFAULT_STAGE_ID = 'leads_generation'

/**
 * Where a prospek becomes an opportunity. 30 rather than the old 50 because the
 * stage at 30 is now literally called Valid Opportunity, leaving the threshold
 * above it would have the board and the counter calling the same deal two
 * different things.
 */
export const DEFAULT_DEAL_THRESHOLD = 30

const STAGE_BY_ID = new Map(DEAL_STAGES.map((stage) => [stage.id, stage]))

/**
 * The Indonesian ids these stages replaced. resolveStage falls back to the first
 * stage for anything it does not recognise, so without this a row still saying
 * 'menang' would quietly reappear on the board as a fresh 10% lead. Kept for
 * rows written by anything that has not been redeployed yet, and for imports of
 * older exports.
 */
const STAGE_ALIASES: Record<string, string> = {
	baru: 'leads_generation',
	kontak: 'leads_generation',
	kualifikasi: 'valid_opportunity',
	penawaran: 'initial_quotation',
	negosiasi: 'negotiation_po',
	menang: 'won',
	kalah: 'lost',
}

export function resolveStage(stageId: string | null | undefined): DealStage {
	const key = String(stageId || '').trim().toLowerCase()
	const resolved = STAGE_BY_ID.get(key) || STAGE_BY_ID.get(STAGE_ALIASES[key] || '')
	return resolved || STAGE_BY_ID.get(DEFAULT_STAGE_ID)!
}

export function isDealStage(stageId: string | null | undefined): boolean {
	return STAGE_BY_ID.has(String(stageId || '').trim().toLowerCase())
}

/**
 * Clamp a caller-supplied probability into 0-100, or fall back to the stage's.
 *
 * `current` is the probability the deal already has, and is what a stage with no
 * probability of its own falls back to, dragging a deal into Pending must not
 * reset the estimate the sales made, and must not invent one either.
 */
export function resolveProbability(
	stage: DealStage,
	probability: number | null | undefined,
	current?: number | null,
): number {
	const value = Number(probability)
	if (probability !== null && probability !== undefined && Number.isFinite(value)) {
		return Math.max(0, Math.min(100, Math.round(value)))
	}
	if (stage.probability !== null) return stage.probability
	// Guarded on null before the cast: Number(null) is 0 and passes isFinite, so
	// a deal whose probability was never set would be parked at 0%, which reads
	// as "hopeless" rather than "not estimated yet".
	if (current !== null && current !== undefined) {
		const carried = Number(current)
		if (Number.isFinite(carried)) return Math.max(0, Math.min(100, Math.round(carried)))
	}
	// A deal created straight into Pending has nothing to carry over, so it
	// starts where a brand new deal starts.
	return STAGE_BY_ID.get(DEFAULT_STAGE_ID)!.probability ?? 0
}

/**
 * Which side of the threshold a deal sits on. `won`/`lost` deals are closed and
 * belong to neither bucket, surfacing a won deal as an "opportunity" would
 * double-count it against the pipeline the leader is trying to read.
 */
export type DealBucket = 'prospek' | 'opportunity' | 'closed'

export function dealBucket(
	probability: number,
	status: string,
	threshold: number = DEFAULT_DEAL_THRESHOLD,
): DealBucket {
	if (status === 'won' || status === 'lost') return 'closed'
	return probability >= threshold ? 'opportunity' : 'prospek'
}
