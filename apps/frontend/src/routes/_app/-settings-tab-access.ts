import { normalizeAppRole } from '@/lib/role-access'

export type SettingsNavItemId =
	| 'general'
	| 'ai-replies'
	| 'ai-models'
	| 'labels'
	| 'whatsapp'
	| 'security'
	| 'notifications'
	| 'localization'
	| 'developer'
	| 'sales-data'

const PERSONAL_TABS: SettingsNavItemId[] = ['general', 'ai-replies', 'security', 'notifications', 'localization']
// sales_profiles rows only exist for sales/leader - not part of PERSONAL_TABS
// since ceo/superadmin have nothing to fill in here.
const SALES_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'sales-data']
const LEADER_TABS: SettingsNavItemId[] = [
	...PERSONAL_TABS,
	'sales-data',
	'ai-models',
	'labels',
	'whatsapp',
]
const CEO_TABS: SettingsNavItemId[] = [...PERSONAL_TABS]
const SUPERADMIN_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'developer', 'whatsapp']

export function getVisibleSettingsTabIds(role: string | null | undefined): SettingsNavItemId[] {
	const normalized = normalizeAppRole(role)

	if (normalized === 'superadmin') return SUPERADMIN_TABS
	if (normalized === 'ceo') return CEO_TABS
	if (normalized === 'leader') return LEADER_TABS
	return SALES_TABS
}
