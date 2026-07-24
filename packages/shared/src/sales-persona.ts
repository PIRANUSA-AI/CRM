// Job-ladder tier, not a personality label - kept in sync with the dropdown
// values already live in kelola-tim/$userId.tsx. Do not add archetype values
// (e.g. "hunter"/"closer") here; persona itself stays free-text prose.
export type SalesExperienceLevel = 'junior' | 'menengah' | 'senior' | 'lead'

export type SalesPersonaSuggestionStatus = 'pending' | 'accepted' | 'dismissed'

export type SalesPersonaSuggestion = {
	persona: string | null
	productExpertise: Record<string, number> | null
	experienceLevel: SalesExperienceLevel | null
	strengths: string[]
	weaknesses: string[]
	rationale: string | null
	status: SalesPersonaSuggestionStatus
	generatedAt: string
}
