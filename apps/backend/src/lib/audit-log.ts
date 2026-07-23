import prisma from './prisma'

/**
 * Record one audit trail entry. Fire-and-forget: a failure here must never
 * fail the action being audited (mirrors logEvent() in
 * personal-whatsapp-inbox/takeover.ts), so callers await this without
 * wrapping it in their own try/catch.
 */
export async function recordAuditLog(input: {
	appId: string
	entityType: string
	entityId?: string | null
	action: string
	actorId?: string | null
	metadata?: Record<string, unknown>
}): Promise<void> {
	try {
		await prisma.audit_logs.create({
			data: {
				app_id: input.appId,
				entity_type: input.entityType,
				entity_id: input.entityId || null,
				action: input.action,
				actor_id: input.actorId || null,
				metadata: (input.metadata || {}) as object,
			},
		})
	} catch (error) {
		console.error('[AuditLog] Failed to write audit log:', error)
	}
}
