import { describe, expect, test } from 'bun:test'
import {
	DEAL_STAGES,
	PIPELINES,
	pipelineOfStage,
	resolvePipeline,
	DEFAULT_DEAL_THRESHOLD,
	dealBucket,
	resolveProbability,
	resolveStage,
} from '../src/modules/opportunities/stages'

describe('resolveStage', () => {
	test('resolves current ids', () => {
		expect(resolveStage('negotiation_po').label).toBe('Negotiation & Waiting PO')
		expect(resolveStage('  WON  ').status).toBe('won')
	})

	test('maps the retired Indonesian ids instead of dropping them to the first stage', () => {
		// The failure this guards: a won deal silently reappearing as a fresh 10%
		// lead because the fallback swallowed an id nobody had migrated yet.
		expect(resolveStage('menang').id).toBe('won')
		expect(resolveStage('kalah').id).toBe('lost')
		expect(resolveStage('negosiasi').id).toBe('negotiation_po')
		expect(resolveStage('kualifikasi').id).toBe('valid_opportunity')
		expect(resolveStage('penawaran').id).toBe('initial_quotation')
		expect(resolveStage('baru').id).toBe('leads_generation')
		expect(resolveStage('kontak').id).toBe('leads_generation')
	})

	test('falls back for genuinely unknown ids', () => {
		expect(resolveStage('entah-apa').id).toBe('leads_generation')
		expect(resolveStage(null).id).toBe('leads_generation')
		expect(resolveStage('').id).toBe('leads_generation')
	})
})

describe('resolveProbability', () => {
	const pending = DEAL_STAGES.find((stage) => stage.id === 'pending')!
	const demo = DEAL_STAGES.find((stage) => stage.id === 'product_demo')!

	test('a stage with a probability sets it', () => {
		expect(resolveProbability(demo, null, 90)).toBe(40)
	})

	test('an explicit probability always wins', () => {
		expect(resolveProbability(demo, 55, 90)).toBe(55)
		expect(resolveProbability(pending, 55, 90)).toBe(55)
	})

	test('Pending keeps the estimate the deal already carried', () => {
		expect(resolveProbability(pending, null, 80)).toBe(80)
		expect(resolveProbability(pending, undefined, 30)).toBe(30)
	})

	test('Pending with nothing to carry starts where a new deal starts', () => {
		expect(resolveProbability(pending, null, null)).toBe(10)
		expect(resolveProbability(pending, null, undefined)).toBe(10)
	})

	test('clamps out-of-range input', () => {
		expect(resolveProbability(demo, 250, null)).toBe(100)
		expect(resolveProbability(demo, -20, null)).toBe(0)
		expect(resolveProbability(demo, Number.NaN, null)).toBe(40)
	})
})

describe('dealBucket', () => {
	test('Valid Opportunity is on the opportunity side of the default threshold', () => {
		// The whole point of moving the threshold to 30: the column named Valid
		// Opportunity must not be counted as a prospek.
		expect(dealBucket(30, 'open', DEFAULT_DEAL_THRESHOLD)).toBe('opportunity')
		expect(dealBucket(20, 'open', DEFAULT_DEAL_THRESHOLD)).toBe('prospek')
	})

	test('closed deals belong to neither bucket', () => {
		expect(dealBucket(100, 'won', DEFAULT_DEAL_THRESHOLD)).toBe('closed')
		expect(dealBucket(0, 'lost', DEFAULT_DEAL_THRESHOLD)).toBe('closed')
	})
})

describe('pipelines', () => {
	test('stage ids are unique across every pipeline', () => {
		// The whole design rests on this: a deal has no pipeline column, so the
		// stage it sits on has to identify its board on its own. A collision would
		// silently file deals onto the wrong one.
		const ids = PIPELINES.flatMap((pipeline) => pipeline.stages.map((stage) => stage.id))
		expect(new Set(ids).size).toBe(ids.length)
	})

	test('a stage names its own pipeline', () => {
		expect(pipelineOfStage('leads_pending')).toBe('leads')
		expect(pipelineOfStage('pending')).toBe('sales')
		expect(pipelineOfStage('leads_confirmed')).toBe('leads')
		expect(pipelineOfStage('won')).toBe('sales')
	})

	test('retired ids and unknown stages stay on the Sales board', () => {
		// resolveStage sends all of these to the first Sales stage, so the board
		// filter has to agree, or they would render nowhere.
		expect(pipelineOfStage('menang')).toBe('sales')
		expect(pipelineOfStage('entah-apa')).toBe('sales')
		expect(pipelineOfStage(null)).toBe('sales')
		expect(pipelineOfStage('')).toBe('sales')
	})

	test('an unknown pipeline falls back to Sales rather than empty', () => {
		expect(resolvePipeline('purchasing').id).toBe('sales')
		expect(resolvePipeline(null).id).toBe('sales')
		expect(resolvePipeline('leads').id).toBe('leads')
	})

	test('the Leads board asserts no probability', () => {
		// Its stages describe whether anyone picked the lead up, not how likely it
		// is to close. A number here would feed the prospek/opportunity split a
		// figure that means nothing on this board.
		const leads = resolvePipeline('leads')
		expect(leads.stages.every((stage) => stage.probability === null)).toBe(true)
		expect(leads.stages.map((stage) => stage.status)).toContain('won')
		expect(leads.stages.map((stage) => stage.status)).toContain('lost')
	})
})
