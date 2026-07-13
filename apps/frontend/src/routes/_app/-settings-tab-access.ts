import { normalizeAppRole } from '@/lib/role-access'

export type SettingsNavItemId =
	| 'general'
	| 'ai-models'
	| 'labels'
	| 'whatsapp'
	| 'security'
	| 'notifications'
	| 'localization'
	| 'developer'

const PERSONAL_TABS: SettingsNavItemId[] = ['security', 'notifications', 'localization']
const SALES_TABS: SettingsNavItemId[] = PERSONAL_TABS
const LEADER_TABS: SettingsNavItemId[] = [
	...PERSONAL_TABS,
	'general',
	'ai-models',
	'labels',
	'whatsapp',
]
const CEO_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'general']
const SUPERADMIN_TABS: SettingsNavItemId[] = [...PERSONAL_TABS, 'developer', 'whatsapp']

export function getVisibleSettingsTabIds(role: string | null | undefined): SettingsNavItemId[] {
	const normalized = normalizeAppRole(role)

	if (normalized === 'superadmin') return SUPERADMIN_TABS
	if (normalized === 'ceo') return CEO_TABS
	if (normalized === 'leader') return LEADER_TABS
	return SALES_TABS
}
