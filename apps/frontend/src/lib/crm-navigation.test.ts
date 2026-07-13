import { describe, expect, test } from 'vitest'
import { CRM_NAV_ITEMS, CRM_GROUP_LABELS } from './crm-navigation'

describe('crm-navigation: new orphan-page nav items', () => {
	const byId = (id: string) => CRM_NAV_ITEMS.find((item) => item.id === id)

	test('laporan and sistem groups exist with labels', () => {
		expect(CRM_GROUP_LABELS.laporan).toBe('Laporan')
		expect(CRM_GROUP_LABELS.sistem).toBe('Sistem')
	})

	test('new nav items exist with the correct path and group', () => {
		expect(byId('pipeline')).toMatchObject({ path: '/pipeline', group: 'data' })
		expect(byId('templates')).toMatchObject({ path: '/templates', group: 'outreach' })
		expect(byId('analytics')).toMatchObject({ path: '/analytics', group: 'laporan' })
		expect(byId('metrics')).toMatchObject({ path: '/metrics', group: 'laporan' })
		expect(byId('meta-ads-tracker')).toMatchObject({
			path: '/apps/meta-ads-tracker',
			group: 'laporan',
		})
		expect(byId('integration')).toMatchObject({ path: '/integration', group: 'sistem' })
		expect(byId('developers')).toMatchObject({ path: '/developers', group: 'sistem' })
		expect(byId('help')).toMatchObject({ path: '/help', group: 'sistem' })
	})

	test('every nav item has a unique id and path', () => {
		const ids = CRM_NAV_ITEMS.map((item) => item.id)
		const paths = CRM_NAV_ITEMS.map((item) => item.path)
		expect(new Set(ids).size).toBe(ids.length)
		expect(new Set(paths).size).toBe(paths.length)
	})
})
