import type { LucideIcon } from 'lucide-react'
import {
	BarChart3,
	BookOpen,
	Bot,
	Code2,
	FileText,
	HelpCircle,
	Kanban,
	LayoutDashboard,
	ListTodo,
	Megaphone,
	MessagesSquare,
	Network,
	Plug,
	Radio,
	Settings,
	Shuffle,
	Upload,
	UserCog,
	Users,
	WandSparkles,
} from 'lucide-react'

export type CrmNavGroup = 'operasional' | 'data' | 'outreach' | 'otomasi' | 'laporan' | 'sistem'

export type CrmNavItem = {
	id: string
	label: string
	path: string
	group: CrmNavGroup
	icon: LucideIcon
	badge?: string
}

export const CRM_NAV_ITEMS: CrmNavItem[] = [
	{
		id: 'dashboard',
		label: 'Dasbor',
		path: '/dashboard',
		group: 'operasional',
		icon: LayoutDashboard,
	},
	{
		id: 'inbox',
		label: 'Kotak Masuk',
		path: '/chat',
		group: 'operasional',
		icon: MessagesSquare,
	},
	{
		id: 'tasks',
		label: 'Daftar Tugas',
		path: '/tasks',
		group: 'operasional',
		icon: ListTodo,
	},
	{
		id: 'handover',
		label: 'Alih Tugas',
		path: '/handover',
		group: 'operasional',
		icon: Shuffle,
	},
	{
		id: 'customers',
		label: 'Pelanggan',
		path: '/customers',
		group: 'data',
		icon: Users,
	},
	{
		// Visible only to ceo/leader: getAllowedPrimaryPathsForRole() (role-access.ts)
		// excludes '/kelola-tim' for every other role, and Sidebar.tsx filters
		// CRM_NAV_ITEMS against that allow-list.
		id: 'kelola-tim',
		label: 'Kelola Tim',
		path: '/kelola-tim',
		group: 'operasional',
		icon: UserCog,
	},
	{
		id: 'broadcast',
		label: 'Siaran',
		path: '/broadcast',
		group: 'outreach',
		icon: Megaphone,
	},
	{
		id: 'workflow',
		label: 'Alur Kerja',
		path: '/flows',
		group: 'otomasi',
		icon: Network,
	},
	{
		id: 'ai-agents',
		label: 'Agen AI',
		path: '/ai-agents',
		group: 'otomasi',
		icon: Bot,
	},
	{
		id: 'ai-playground',
		label: 'Lab AI',
		path: '/ai',
		group: 'otomasi',
		icon: WandSparkles,
	},
	{
		id: 'knowledge',
		label: 'Basis Pengetahuan',
		path: '/knowledge',
		group: 'otomasi',
		icon: BookOpen,
	},
	{
		id: 'settings',
		label: 'Pengaturan',
		path: '/settings',
		group: 'sistem',
		icon: Settings,
	},
	{
		id: 'pipeline',
		label: 'Pipeline',
		path: '/pipeline',
		group: 'data',
		icon: Kanban,
	},
	{
		id: 'templates',
		label: 'Templat',
		path: '/templates',
		group: 'outreach',
		icon: FileText,
	},
	{
		id: 'analytics',
		label: 'Analitik',
		path: '/analytics',
		group: 'laporan',
		icon: BarChart3,
	},
	{
		id: 'metrics',
		label: 'Metrik',
		path: '/metrics',
		group: 'laporan',
		icon: Radio,
	},
	{
		id: 'meta-ads-tracker',
		label: 'Meta Ads Tracker',
		path: '/apps/meta-ads-tracker',
		group: 'laporan',
		icon: Megaphone,
	},
	{
		id: 'import',
		label: 'Import Data',
		path: '/import',
		group: 'sistem',
		icon: Upload,
	},
	{
		id: 'integration',
		label: 'Integrasi',
		path: '/integration',
		group: 'sistem',
		icon: Plug,
	},
	{
		id: 'developers',
		label: 'Pengembang',
		path: '/developers',
		group: 'sistem',
		icon: Code2,
	},
	{
		id: 'help',
		label: 'Bantuan',
		path: '/help',
		group: 'sistem',
		icon: HelpCircle,
	},
]

const CRM_EXTRA_ALLOWED_PATHS = ['/channels/whatsapp']

export const CRM_ALLOWED_PATHS = [
	...CRM_NAV_ITEMS.map((item) => item.path),
	...CRM_EXTRA_ALLOWED_PATHS,
]

export function normalizeCrmPath(pathname: string): string {
	if (!pathname) return '/'
	if (pathname === '/') return '/'
	return pathname.replace(/\/+$/, '') || '/'
}

export function isCrmAllowedPath(pathname: string): boolean {
	const normalized = normalizeCrmPath(pathname)
	return CRM_ALLOWED_PATHS.some(
		(path) => normalized === path || normalized.startsWith(`${path}/`),
	)
}

export const CRM_GROUP_LABELS: Record<CrmNavGroup, string> = {
	operasional: 'Operasional',
	data: 'Data',
	outreach: 'Outreach',
	otomasi: 'Otomasi',
	laporan: 'Laporan',
	sistem: 'Sistem',
}
