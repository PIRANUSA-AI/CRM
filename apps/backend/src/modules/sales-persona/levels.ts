import type { SalesLevel } from '@crm/shared/sales-types'

/**
 * The 5-tier progression from W2I.md §4.2. Reference/validation data only -
 * nothing enforces a sales' `users.sales_level` against `maxActiveLeads`
 * automatically. Capacity is still what `sales_profiles.max_active` says;
 * this is what an administrator is guided by when they set it.
 */
export type SalesLevelDefinition = {
	id: SalesLevel
	rank: number
	title: string
	experienceYearsMin: number
	experienceYearsMax: number | null
	productScope: string
	maxActiveLeads: number
	weight: number
}

export const SALES_LEVELS: SalesLevelDefinition[] = [
	{
		id: 'junior_sales',
		rank: 1,
		title: 'Junior Sales',
		experienceYearsMin: 0,
		experienceYearsMax: 1,
		productScope: '1 produk',
		maxActiveLeads: 5,
		weight: 1.0,
	},
	{
		id: 'sales_associate',
		rank: 2,
		title: 'Sales Associate',
		experienceYearsMin: 1,
		experienceYearsMax: 2,
		productScope: '2-3 produk',
		maxActiveLeads: 10,
		weight: 1.2,
	},
	{
		id: 'senior_sales',
		rank: 3,
		title: 'Senior Sales',
		experienceYearsMin: 2,
		experienceYearsMax: 4,
		productScope: '3-5 produk',
		maxActiveLeads: 20,
		weight: 1.5,
	},
	{
		id: 'lead_sales',
		rank: 4,
		title: 'Lead Sales',
		experienceYearsMin: 4,
		experienceYearsMax: 6,
		productScope: 'Semua produk',
		maxActiveLeads: 30,
		weight: 1.8,
	},
	{
		id: 'principal_sales',
		rank: 5,
		title: 'Principal Sales',
		experienceYearsMin: 6,
		experienceYearsMax: null,
		productScope: 'Semua + mentoring',
		maxActiveLeads: 40,
		weight: 2.0,
	},
]

const SALES_LEVEL_IDS = new Set(SALES_LEVELS.map((l) => l.id))

export function isSalesLevel(value: unknown): value is SalesLevel {
	return typeof value === 'string' && SALES_LEVEL_IDS.has(value as SalesLevel)
}
