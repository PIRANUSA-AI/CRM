export type LeadNeedSegment = 'AEC' | 'MFG' | 'other'
export type LeadNeedUrgency = 'high' | 'medium' | 'low'

export type LeadNeed = {
	name: string | null
	company: string | null
	product: string | null
	segment: LeadNeedSegment | null
	useCase: string | null
	seats: number | null
	budget: string | null
	urgency: LeadNeedUrgency | null
	timeline: string | null
	painPoints: string[]
	decisionRole: string | null
	source: string | null
	city: string | null
	notes: string | null
	missing: string[]
	ready: boolean
	updatedBy: 'ai' | 'leader'
	updatedAt: string
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
		| 'timeline'
		| 'painPoints'
		| 'decisionRole'
		| 'source'
		| 'city'
		| 'notes'
	>
>
