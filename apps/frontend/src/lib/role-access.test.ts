// apps/frontend/src/lib/role-access.test.ts
import { describe, expect, test } from 'vitest'
import {
	getAllowedPrimaryPathsForRole,
	isPathAllowedForRole,
	isSupervisorRole,
	isMultiTeamRole,
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

	// Regression: /pipeline was added for leaders only while the sidebar entry
	// for /opportunity was removed, which left a sales with no route to their own
	// deals at all — the nav item was gone and /opportunity redirected to a page
	// they were not allowed on. Asserting the constants against themselves (the
	// test above) cannot catch a missing path, so name the pages explicitly.
	test('sales can reach the pages they work in every day', () => {
		for (const path of [
			'/chat',
			'/tasks',
			'/pipeline',
			'/opportunity',
			'/prospek',
			'/customers',
			'/alih-tugas',
			'/notifikasi',
		]) {
			expect(isPathAllowedForRole(path, 'sales')).toBe(true)
		}
	})

	test('sales stays out of leadership pages', () => {
		expect(isPathAllowedForRole('/kelola-tim', 'sales')).toBe(false)
		expect(isPathAllowedForRole('/sales-profiles', 'sales')).toBe(false)
		expect(isPathAllowedForRole('/broadcast', 'sales')).toBe(false)
	})

	test('administrator reaches every page a leader does', () => {
		for (const path of LEADER_PATHS) {
			expect(isPathAllowedForRole(path, 'administrator')).toBe(true)
		}
	})

	test('supervisor vs multi-team is the difference between leader and administrator', () => {
		// Both see more than their own work…
		expect(isSupervisorRole('leader')).toBe(true)
		expect(isSupervisorRole('administrator')).toBe(true)
		expect(isSupervisorRole('sales')).toBe(false)
		// …but only the administrator tier spans every team.
		expect(isMultiTeamRole('administrator')).toBe(true)
		expect(isMultiTeamRole('leader')).toBe(false)
		expect(isMultiTeamRole('sales')).toBe(false)
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
		expect(isPathAllowedForRole('/alih-tugas', 'sales')).toBe(true)
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
