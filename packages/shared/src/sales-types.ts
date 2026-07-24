/**
 * Mirrors the `sales_targets` table (apps/backend/prisma/schema.prisma).
 * period_start/period_end are calendar dates, not a parsed label - any date
 * inside the period resolves to the same canonical start/end
 * (see resolvePeriodRange in sales-targets/service.ts).
 */
export type SalesTargetPeriodType = 'annual' | 'quarterly' | 'monthly'

export interface SalesTarget {
	id: string
	appId: string
	userId: string
	periodType: SalesTargetPeriodType
	periodStart: string
	periodEnd: string
	targetLeads: number
	targetDeals: number
	targetRevenue: number
	metrics?: Record<string, unknown> | null
	setBy?: string | null
	createdAt: string
	updatedAt: string
}

/** Mirrors the `sales_scores` table. Written by a batch worker (W2I.md §13), not per-request. */
export interface SalesScore {
	id: string
	appId: string
	userId: string
	periodStart: string
	periodEnd: string
	totalScore: number
	productScore: number
	conversionScore: number
	responseTimeScore: number
	taskCompletionScore: number
	breakdown?: Record<string, unknown> | null
	computedAt: string
}

/**
 * Mirrors the `sales_persona` table, one row per user (W2I.md §3.1/§4.3).
 * The plan is AI detects this from conversation history and an
 * administrator can override the recommendation - there is no self-report
 * concept. Until the detection agent exists, administrator sets this
 * directly.
 */
export type SalesPersonaType = 'hunter' | 'farmer' | 'closer' | 'advisor' | 'negotiator'
export type SalesExperienceLevel = 'junior' | 'mid' | 'senior' | 'lead'

export interface SalesPersona {
	id: string
	appId: string
	userId: string
	personaType?: SalesPersonaType | null
	productExpertise?: Record<string, number> | null
	experienceYears?: number | null
	experienceLevel?: SalesExperienceLevel | null
	strengths?: string[] | null
	weaknesses?: string[] | null
	createdAt: string
	updatedAt: string
}

/**
 * The 5-tier progression from W2I.md §4.2. Not enforced by the DB
 * (sales_profiles.level and users.sales_level are both plain strings) - this
 * is the reference vocabulary for whichever service ends up validating
 * against it.
 */
export type SalesLevel =
	| 'junior_sales'
	| 'sales_associate'
	| 'senior_sales'
	| 'lead_sales'
	| 'principal_sales'

/**
 * Mirrors the existing `sales_profiles` table (apps/backend/src/modules/
 * sales-profiles/service.ts). This is the routing/capacity profile a leader
 * or administrator manages - not to be confused with SalesPersona above.
 */
export interface SalesProfile {
	userId: string
	appId: string
	productSkills: string[]
	segments: string[]
	level?: string | null
	maxActive: number
	regions: string[]
	languages: string[]
	tags: string[]
	notes?: string | null
	persona?: string | null
	experienceYears?: number | null
	phone?: string | null
	position?: string | null
	joinedAt?: string | null
}
