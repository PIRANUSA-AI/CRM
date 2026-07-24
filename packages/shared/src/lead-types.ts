/**
 * The lead-qualification profile actually in production, stored at
 * conversations.additional_attributes.lead_need and read/written by
 * apps/backend/src/modules/personal-whatsapp-inbox/ai-reply.ts. This is the
 * canonical definition - both the backend and the frontend client
 * (LeadRoutingDialog.tsx) import this instead of keeping their own copy.
 *
 * Deliberately not W2I.md §5.3's shape (productInterest[]/timeline enum/
 * decisionRole/qualificationScore etc.) - that was drafted before this was
 * built, and what actually ships is simpler and PIRANUSA-specific (segment
 * AEC/MFG, seats = license count).
 */
export type LeadNeedSegment = 'AEC' | 'MFG' | 'other'
export type LeadNeedUrgency = 'high' | 'medium' | 'low'

export interface LeadNeed {
	name: string | null
	company: string | null
	product: string | null
	segment: LeadNeedSegment | null
	useCase: string | null
	seats: number | null
	budget: string | null
	urgency: LeadNeedUrgency | null
	source: string | null
	city: string | null
	notes: string | null
	missing: string[]
	ready: boolean
	updatedBy: 'ai' | 'leader'
	updatedAt: string
}

export interface LeadNeedResult {
	leadNeed: LeadNeed
	assigned: boolean
}

export type LeadNeedPatch = Partial<
	Pick<
		LeadNeed,
		| 'name'
		| 'company'
		| 'product'
		| 'segment'
		| 'useCase'
		| 'seats'
		| 'budget'
		| 'urgency'
		| 'source'
		| 'city'
		| 'notes'
	>
>

/**
 * W2I.md §13/§18 P3 "AI-enhanced lead routing" - NOT implemented anywhere
 * yet. Routing stays purely deterministic (M2: product score 40% + load 30%
 * + fairness 30%, see lead-routing/service.ts dealVisibilityScope and
 * resolveRoutingCandidates). These types exist so a future scoring pass has
 * a fixed shape to target, not because anything produces them today.
 */
export interface LeadScore {
	conversationId: string
	fitScore: number
	urgencyScore: number
	valueScore: number
	computedAt: string
}

export type LeadFit = 'poor' | 'fair' | 'good' | 'excellent'

export interface LeadRecommendation {
	conversationId: string
	recommendedUserId: string
	fit: LeadFit
	reason: string
}
