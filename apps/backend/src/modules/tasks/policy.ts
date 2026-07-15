import prisma from '../../lib/prisma'
import type { CanonicalRole } from '../../lib/require-role'

export type TaskActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export class TaskAccessError extends Error {}

export async function taskVisibilityScope(actor: TaskActor) {
	if (actor.role === 'sales') return { assignee_id: actor.userId }
	if (actor.role === 'leader') {
		const memberships = await prisma.team_members.findMany({
			where: { user_id: actor.userId },
			select: { team_id: true },
		})
		return {
			OR: [
				{ assignee_id: actor.userId },
				{ team_id: { in: memberships.map(({ team_id }) => team_id) } },
			],
		}
	}
	return {}
}

export async function assertAssignableTask(
	actor: TaskActor,
	assigneeId: string,
	teamId: string | null,
) {
	if (actor.role === 'sales' && assigneeId !== actor.userId) {
		throw new TaskAccessError('Sales hanya dapat membuat task untuk dirinya sendiri')
	}

	const assignee = await prisma.users.findFirst({
		where: { id: assigneeId, app_id: actor.appId, deleted_at: null },
		select: { id: true },
	})
	if (!assignee) throw new TaskAccessError('Assignee tidak berada pada app aktif')

	if (actor.role !== 'leader') return
	if (!teamId && assigneeId === actor.userId) return
	if (!teamId) {
		throw new TaskAccessError('Leader harus memilih team saat memberi task ke sales lain')
	}

	const membership = await prisma.team_members.findFirst({
		where: { team_id: teamId, user_id: actor.userId },
		select: { team_id: true },
	})
	if (!membership) throw new TaskAccessError('Task berada di luar scope team Anda')
}

export function parseFutureDate(value: string) {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) throw new Error('Format waktu tidak valid')
	if (date <= new Date()) throw new Error('Waktu tunda harus berada di masa depan')
	return date
}

export function dueAtFromRecommendation(
	action: string,
	dueInMinutes: number | null,
) {
	const fallbackMinutes: Record<string, number> = {
		reply_now: 30,
		qualify_lead: 60,
		handover_review: 30,
		follow_up: 3 * 24 * 60,
	}
	const requested = Number.isFinite(dueInMinutes)
		? Math.round(dueInMinutes || 0)
		: fallbackMinutes[action] || 24 * 60
	const bounded = Math.max(0, Math.min(30 * 24 * 60, requested))
	return new Date(Date.now() + bounded * 60_000)
}
