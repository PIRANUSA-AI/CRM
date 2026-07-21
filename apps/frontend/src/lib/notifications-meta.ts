import { Bell, Bot, Clock8, ListTodo, Smartphone, Sparkles, UserPlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { useNavigate } from '@tanstack/react-router'
import type { NotificationItem } from '@/lib/api'

// Shared notification presentation + routing, used by both the TopBar bell
// dropdown and the full /notifikasi page so they stay in sync.

const NOTIF_ICON: Record<string, LucideIcon> = {
	takeover: Bot,
	lead_pending: UserPlus,
	task_urgent: ListTodo,
	task_due: Clock8,
	ai_draft: Sparkles,
	wa_disconnected: Smartphone,
}

export function notifIcon(type: string): LucideIcon {
	return NOTIF_ICON[type] || Bell
}

export const NOTIF_LABEL: Record<string, string> = {
	takeover: 'Ambil alih',
	lead_pending: 'Lead baru',
	task_urgent: 'Tugas mendesak',
	task_due: 'Jatuh tempo',
	ai_draft: 'Draf AI',
	wa_disconnected: 'WhatsApp',
}

export function notifLabel(type: string): string {
	return NOTIF_LABEL[type] || 'Notifikasi'
}

type NotifTarget = Pick<NotificationItem, 'type' | 'taskId' | 'conversationId'>

// Where clicking a notification takes the user. This navigates rather than
// returning a path because the interesting destinations are parameterised
// a lead notification has to carry its conversation id through as a search
// param, and building those by hand at each call site is how the bell ended up
// dropping them and landing everyone on an empty inbox.
export function notifNavigate(
	navigate: ReturnType<typeof useNavigate>,
	item: NotifTarget,
): void {
	switch (item.type) {
		case 'takeover':
			void navigate({ to: '/alih-tugas' })
			return
		case 'task_urgent':
		case 'task_due':
			void (item.taskId
				? navigate({ to: '/tasks/$taskId', params: { taskId: item.taskId } })
				: navigate({ to: '/tasks' }))
			return
		case 'wa_disconnected':
			void navigate({ to: '/whatsapp/connect' })
			return
		case 'lead_pending':
		case 'ai_draft':
			// A lead notification comes in two shapes. The leader's ("perlu
			// keputusan") carries a conversation in their own inbox, so open it
			// without `c` the inbox opens with nothing selected, which is the
			// complaint this fixes. The sales' ("di-assign ke kamu") deliberately
			// has no conversation, because the lead's chat lives in the leader's
			// inbox and the personal inbox is scoped per owner; that one carries a
			// task, which is where the sales reads the briefing and starts their
			// own chat.
			if (item.conversationId) {
				void navigate({ to: '/chat', search: { c: item.conversationId } })
				return
			}
			void (item.taskId
				? navigate({ to: '/tasks/$taskId', params: { taskId: item.taskId } })
				: navigate({ to: '/chat', search: {} }))
			return
		default:
			void navigate({ to: '/dashboard' })
	}
}
