import { describe, expect, test } from 'vitest'
import { getVisibleSettingsTabIds } from './-settings-tab-access'

describe('getVisibleSettingsTabIds', () => {
	test('sales sees only the personal tabs', () => {
		expect(getVisibleSettingsTabIds('sales')).toEqual([
			'security',
			'notifications',
			'localization',
		])
	})

	test('leader gets the full operational config set without developer tools', () => {
		const tabs = getVisibleSettingsTabIds('leader')
		expect(tabs).toContain('general')
		expect(tabs).toContain('ai-models')
		expect(tabs).toContain('labels')
		expect(tabs).toContain('whatsapp')
		expect(tabs).not.toContain('developer')
	})

	test('ceo is monitoring-only: personal tabs plus general, nothing operational', () => {
		const tabs = getVisibleSettingsTabIds('ceo')
		expect(tabs).toContain('general')
		expect(tabs).not.toContain('ai-models')
		expect(tabs).not.toContain('whatsapp')
		expect(tabs).not.toContain('developer')
	})

	test('superadmin gets technical/system tabs, not Leader business config', () => {
		const tabs = getVisibleSettingsTabIds('superadmin')
		expect(tabs).toContain('developer')
		expect(tabs).toContain('whatsapp')
		expect(tabs).not.toContain('ai-models')
		expect(tabs).not.toContain('labels')
	})
})
