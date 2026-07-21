/**
 * What a firm does.
 *
 * A fixed list rather than free text, for the reason the company name field
 * demonstrated: left open, the same industry arrives as "arsitektur", "Arsitek",
 * "ARCHITECTURE" and "arch", and none of them can be filtered together.
 *
 * The list is deliberately short and shaped around what PIRANUSA sells — AEC
 * tools to people who design buildings, MFG tools to people who make things.
 * Adding one is a line here; it does not touch the database, since the column
 * stores the id.
 */
export type Industry = {
	id: string
	label: string
}

export const INDUSTRIES: Industry[] = [
	{ id: 'arsitektur', label: 'Arsitektur' },
	{ id: 'konstruksi', label: 'Konstruksi & Kontraktor' },
	{ id: 'interior', label: 'Interior & Desain' },
	{ id: 'konsultan', label: 'Konsultan & Engineering' },
	{ id: 'properti', label: 'Properti & Developer' },
	{ id: 'manufaktur', label: 'Manufaktur' },
	{ id: 'otomotif', label: 'Otomotif & Komponen' },
	{ id: 'fabrikasi', label: 'Fabrikasi & Logam' },
	{ id: 'energi', label: 'Energi & Pertambangan' },
	{ id: 'pendidikan', label: 'Pendidikan' },
	{ id: 'pemerintahan', label: 'Pemerintahan' },
	{ id: 'lainnya', label: 'Lainnya' },
]

const BY_ID = new Map(INDUSTRIES.map((industry) => [industry.id, industry]))

export function isIndustry(value: string | null | undefined): boolean {
	return BY_ID.has(String(value || '').trim().toLowerCase())
}

/** The label for a stored id, or null — an unknown id is shown as unset rather
 *  than echoed back raw, so a bad write cannot leak into the UI as a category. */
export function industryLabel(value: string | null | undefined): string | null {
	return BY_ID.get(String(value || '').trim().toLowerCase())?.label ?? null
}
