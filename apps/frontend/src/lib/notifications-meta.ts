import { Bell, Bot, Clock8, ListTodo, Smartphone, Sparkles, UserPlus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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

// Where clicking a notification takes the user.
export function notifDestination(item: Pick<NotificationItem, 'type' | 'taskId'>): string {
	switch (item.type) {
		case 'takeover':
			return '/alih-tugas'
		case 'task_urgent':
		case 'task_due':
			return item.taskId ? `/tasks/${item.taskId}` : '/tasks'
		case 'wa_disconnected':
			return '/whatsapp/connect'
		case 'lead_pending':
		case 'ai_draft':
			return '/chat'
		default:
			return '/dashboard'
	}
}
