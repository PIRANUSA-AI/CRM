/**
 * The normaliser decides which company names are the same firm. A bug here does
 * not throw. It silently merges two real customers into one row, or splits one
 * customer across two. Both are only noticed once a leader is looking at a
 * number that is wrong, so the boundaries are pinned here instead.
 */
import { describe, expect, test } from 'bun:test'
import { displayCompanyName, normalizeCompanyName } from '../src/lib/company'

describe('normalizeCompanyName', () => {
	test('collapses casing, punctuation and spacing', () => {
		const expected = 'maju jaya'
		for (const variant of ['PT Maju Jaya', 'pt. maju jaya', 'PT.  MAJU-JAYA', 'Pt Maju  Jaya']) {
			expect(normalizeCompanyName(variant)).toBe(expected)
		}
	})

	test('strips legal forms from either end', () => {
		expect(normalizeCompanyName('CV Teknik Jaya')).toBe('teknik jaya')
		expect(normalizeCompanyName('Teknik Jaya, CV')).toBe('teknik jaya')
		expect(normalizeCompanyName('PT Sentosa Tbk')).toBe('sentosa')
	})

	test('keeps genuinely different firms apart', () => {
		// The case that decided against fuzzy matching: one is not the other.
		expect(normalizeCompanyName('PT Maju')).not.toBe(normalizeCompanyName('PT Maju Jaya'))
		expect(normalizeCompanyName('Interior Pro')).not.toBe(normalizeCompanyName('Interior Luxe'))
	})

	test('returns empty for input that is not a name', () => {
		// Callers must read this as "no company given" and leave company_id null,
		// rather than creating a row with a blank name that every future blank
		// then joins onto.
		for (const junk of ['', '   ', '-', '.', 'PT', 'CV', null, undefined]) {
			expect(normalizeCompanyName(junk)).toBe('')
		}
	})

	test('does not strip a legal form that is the whole name', () => {
		// "PT" alone normalises away entirely (above), but a firm actually called
		// "Persero Baja" keeps its first word because dropping it would leave
		// "baja". A different, much broader match.
		expect(normalizeCompanyName('Persero Baja')).toBe('baja')
		expect(normalizeCompanyName('Baja')).toBe('baja')
	})
})

describe('displayCompanyName', () => {
	test('squashes whitespace but keeps the legal form', () => {
		// What a leader reads should still say PT, only the dedupe key drops it.
		expect(displayCompanyName('  PT   Maju  Jaya ')).toBe('PT Maju Jaya')
	})
})
