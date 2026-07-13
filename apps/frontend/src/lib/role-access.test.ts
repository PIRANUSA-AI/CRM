// apps/frontend/src/lib/role-access.test.ts
import { describe, expect, test } from 'vitest'
import {
	getAllowedPrimaryPathsForRole,
	isPathAllowedForRole,
	SALES_PATHS,
	LEADER_PATHS,
	CEO_PATHS,
	SUPERADMIN_PATHS,
} from './role-access'

describe('role-access: sales/leader/ceo/superadmin', () => {
	test('each role gets its own independent path list', () => {
		expect(getAllowedPrimaryPathsForRole('sales')).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole('leader')).toEqual(LEADER_PATHS)
		expect(getAllowedPrimaryPathsForRole('ceo')).toEqual(CEO_PATHS)
		expect(getAllowedPrimaryPathsForRole('superadmin')).toEqual(SUPERADMIN_PATHS)
	})

	test('superadmin is restricted, not unrestricted', () => {
		const allowed = getAllowedPrimaryPathsForRole('superadmin')
		expect(allowed).not.toBeNull()
		expect(isPathAllowedForRole('/chat', 'superadmin')).toBe(false)
		expect(isPathAllowedForRole('/orders', 'superadmin')).toBe(false)
		expect(isPathAllowedForRole('/developers', 'superadmin')).toBe(true)
	})

	test('ceo is monitoring-only: no Leader operational pages', () => {
		expect(isPathAllowedForRole('/broadcast', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/ai-agents', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/chat', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/orders', 'ceo')).toBe(false)
		expect(isPathAllowedForRole('/analytics', 'ceo')).toBe(true)
		expect(isPathAllowedForRole('/kelola-tim', 'ceo')).toBe(true)
	})

	test('leader has the full operational toolset but not developers', () => {
		expect(isPathAllowedForRole('/kelola-tim', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/broadcast', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/analytics', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/developers', 'leader')).toBe(false)
	})

	test('sales is restricted to day-to-day operational pages', () => {
		expect(isPathAllowedForRole('/kelola-tim', 'sales')).toBe(false)
		expect(isPathAllowedForRole('/dashboard', 'sales')).toBe(true)
		expect(isPathAllowedForRole('/chat', 'sales')).toBe(true)
		expect(isPathAllowedForRole('/handover', 'sales')).toBe(true)
	})

	test('help is reachable by every role', () => {
		expect(isPathAllowedForRole('/help', 'sales')).toBe(true)
		expect(isPathAllowedForRole('/help', 'leader')).toBe(true)
		expect(isPathAllowedForRole('/help', 'ceo')).toBe(true)
		expect(isPathAllowedForRole('/help', 'superadmin')).toBe(true)
	})

	test('an unrecognized or missing role fails closed to the most restrictive tier', () => {
		expect(getAllowedPrimaryPathsForRole('made-up-role')).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole(null)).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole(undefined)).toEqual(SALES_PATHS)
		expect(getAllowedPrimaryPathsForRole('')).toEqual(SALES_PATHS)
	})
})
