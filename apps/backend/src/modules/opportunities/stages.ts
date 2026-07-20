/**
 * Deal stages.
 *
 * A "prospek" and an "opportunity" are not separate records — they are one deal
 * at different `probability` values. Below the owning team's `deal_threshold`
 * the deal reads as a prospek; at or above it, an opportunity. Keeping this as
 * one field is what stops the two from drifting apart, which is exactly what
 * happened when opportunities were entered by hand alongside the leads they
 * came from.
 *
 * Stages live in code rather than in `pipeline_stages` on purpose: that table
 * is `pipeline_type = 'contact'` and drives the contact lifecycle shown on the
 * Pelanggan page, which is a different axis (who someone is) from this one (how
 * far along a specific sale is).
 */

export type DealStage = {
	id: string
	label: string
	/** Default probability when the sales moves the deal into this stage. */
	probability: number
	/** Closed stages stop appearing as active work. */
	status: 'open' | 'won' | 'lost'
}

export const DEAL_STAGES: DealStage[] = [
	{ id: 'baru', label: 'Baru', probability: 10, status: 'open' },
	{ id: 'kontak', label: 'Kontak awal', probability: 25, status: 'open' },
	{ id: 'kualifikasi', label: 'Kualifikasi', probability: 50, status: 'open' },
	{ id: 'penawaran', label: 'Penawaran', probability: 75, status: 'open' },
	{ id: 'negosiasi', label: 'Negosiasi', probability: 90, status: 'open' },
	{ id: 'menang', label: 'Menang', probability: 100, status: 'won' },
	{ id: 'kalah', label: 'Kalah', probability: 0, status: 'lost' },
]

export const DEFAULT_STAGE_ID = 'baru'
export const DEFAULT_DEAL_THRESHOLD = 50

const STAGE_BY_ID = new Map(DEAL_STAGES.map((stage) => [stage.id, stage]))

export function resolveStage(stageId: string | null | undefined): DealStage {
	const key = String(stageId || '').trim().toLowerCase()
	return STAGE_BY_ID.get(key) || STAGE_BY_ID.get(DEFAULT_STAGE_ID)!
}

export function isDealStage(stageId: string | null | undefined): boolean {
	return STAGE_BY_ID.has(String(stageId || '').trim().toLowerCase())
}

/** Clamp a caller-supplied probability into 0-100, or fall back to the stage's. */
export function resolveProbability(
	stage: DealStage,
	probability: number | null | undefined,
): number {
	if (probability === null || probability === undefined) return stage.probability
	const value = Number(probability)
	if (!Number.isFinite(value)) return stage.probability
	return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * Which side of the threshold a deal sits on. `won`/`lost` deals are closed and
 * belong to neither bucket — surfacing a won deal as an "opportunity" would
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
