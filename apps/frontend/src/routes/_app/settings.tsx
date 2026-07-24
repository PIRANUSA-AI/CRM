import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
	User,
	Save,
	Shield,
	Bell,
	Globe,
	Terminal,
	Key,
	Bot,
	Eye,
	Plus,
	Tag,
	Trash2,
	Edit2,
	X,
	MessageCircle,
	UserCircle2,
	type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import {
	playNotificationSound,
	sendBrowserNotification,
} from '@/lib/notifications'
import WhatsAppSettingsManager from '@/components/settings/WhatsAppSettingsManager'
import AIConfigurationManager from '@/components/settings/AIConfigurationManager'
import PersonalAiSettingsManager from '@/components/settings/PersonalAiSettingsManager'
import SalesProfileSelfManager from '@/components/settings/SalesProfileSelfManager'
import ProfileSettingsManager from '@/components/settings/ProfileSettingsManager'
import SecuritySettingsManager from '@/components/settings/SecuritySettingsManager'
import { getVisibleSettingsTabIds, type SettingsNavItemId } from './-settings-tab-access'
import { extractNormalizedRole } from '@/lib/role-access'

export const Route = createFileRoute('/_app/settings')({
	component: SettingsPage,
})

type SettingsNavItem = {
	title: string
	icon: LucideIcon
	id: SettingsNavItemId
}

const SIDEBAR_NAV_ITEMS: SettingsNavItem[] = [
	{ title: 'Profil', icon: User, id: 'general' },
	{ title: 'Data Diri Sales', icon: UserCircle2, id: 'sales-data' },
	{ title: 'AI Balasan', icon: Bot, id: 'ai-replies' },
	{ title: 'AI Models', icon: Bot, id: 'ai-models' },
	{ title: 'Labels', icon: Tag, id: 'labels' },
	{ title: 'WhatsApp', icon: MessageCircle, id: 'whatsapp' },
	{ title: 'Security', icon: Shield, id: 'security' },
	{ title: 'Notifications', icon: Bell, id: 'notifications' },
	{ title: 'Localization', icon: Globe, id: 'localization' },
	{ title: 'Developer Tools', icon: Terminal, id: 'developer' },
]

const getInitialActiveNav = (): SettingsNavItemId => {
	if (typeof window === 'undefined') return 'general'

	const queryNav = new URLSearchParams(window.location.search).get('tab')

	switch (queryNav) {
		case 'general':
			return 'general'
		case 'ai-replies':
			return 'ai-replies'
		case 'ai-models':
			return 'ai-models'
		case 'labels':
			return 'labels'
		case 'whatsapp':
			return 'whatsapp'
		case 'security':
			return 'security'
		case 'notifications':
			return 'notifications'
		case 'localization':
			return 'localization'
		case 'developer':
			return 'developer'
		default:
			return 'general'
	}
}

function SettingsPage() {
	const navigate = useNavigate()
	const [activeNav, setActiveNav] =
		useState<SettingsNavItemId>(getInitialActiveNav)
	const [currentRole, setCurrentRole] = useState('')

	useEffect(() => {
		if (typeof localStorage === 'undefined') return
		const stored = localStorage.getItem('crm_user')
		if (!stored) return
		try {
			const parsed = JSON.parse(stored) as any
			const candidate =
				parsed && typeof parsed.user === 'object' && parsed.user
					? parsed.user
					: parsed
			if (!candidate || typeof candidate !== 'object') return
			setCurrentRole(extractNormalizedRole(candidate))
		} catch {
			// ignore invalid local storage
		}
	}, [])

	const visibleTabIds = getVisibleSettingsTabIds(currentRole)
	const visibleNavItems = SIDEBAR_NAV_ITEMS.filter((item) =>
		visibleTabIds.includes(item.id),
	)

	useEffect(() => {
		if (typeof window === 'undefined') return

		const nextUrl = new URL(window.location.href)
		const tab = nextUrl.searchParams.get('tab')
		if (!tab) return

		if (tab === 'ai-personas') {
			navigate({ to: '/ai-agents', replace: true })
			return
		}

		const knownTab = SIDEBAR_NAV_ITEMS.some((item) => item.id === tab)
		if (knownTab) return

		nextUrl.searchParams.delete('tab')
		window.history.replaceState({}, '', nextUrl.toString())
	}, [navigate])

	const setActiveSection = (id: SettingsNavItemId) => {
		setActiveNav(id)

		if (typeof window !== 'undefined') {
			const nextUrl = new URL(window.location.href)

			if (id === 'general') {
				nextUrl.searchParams.delete('tab')
			} else {
				nextUrl.searchParams.set('tab', id)
			}

			window.history.replaceState({}, '', nextUrl.toString())
		}
	}

	useEffect(() => {
		if (visibleTabIds.includes(activeNav)) return
		const firstVisibleTab = visibleNavItems[0]?.id
		if (firstVisibleTab) setActiveSection(firstVisibleTab)
	}, [activeNav, currentRole])

	// Notification State
	const [soundEnabled, setSoundEnabled] = useState(() => {
		const stored = localStorage.getItem('crm_sound_enabled')
		return stored === null ? true : stored === 'true'
	})
	const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
		const stored = localStorage.getItem('crm_notifications_enabled')
		return stored === null ? true : stored === 'true'
	})

	// Labels State
	const appId =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('crm_app_id') ||
				localStorage.getItem('crm_org_slug') ||
				''
			: ''
	const [labels, setLabels] = useState<any[]>([])
	const [labelsLoading, setLabelsLoading] = useState(false)
	const [showLabelModal, setShowLabelModal] = useState(false)
	const [editingLabel, setEditingLabel] = useState<any>(null)

	const [labelForm, setLabelForm] = useState({
		title: '',
		color: '#10B981',
		description: '',
	})

	const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3005'

	const fetchLabels = async () => {
		setLabelsLoading(true)
		try {
			const token = localStorage.getItem('crm_token')
			const res = await fetch(`${API_BASE}/api/labels`, {
				headers: { Authorization: `Bearer ${token}`, 'X-App-Id': appId },
			})
			const data = await res.json()
			console.log('[Labels] API Response:', data)
			// API returns: { success: true, data: { labels: [...], metadata: {...} } }
			let labelsData: any[] = []
			if (Array.isArray(data)) {
				labelsData = data
			} else if (data.data?.labels && Array.isArray(data.data.labels)) {
				labelsData = data.data.labels
			} else if (data.payload && Array.isArray(data.payload)) {
				labelsData = data.payload
			} else if (data.labels && Array.isArray(data.labels)) {
				labelsData = data.labels
			}
			console.log('[Labels] Parsed labels:', labelsData)
			setLabels(labelsData)
		} catch (error) {
			console.error('Failed to fetch labels:', error)
			setLabels([])
		} finally {
			setLabelsLoading(false)
		}
	}

	const saveLabel = async () => {
		try {
			const token = localStorage.getItem('crm_token')
			const method = editingLabel ? 'PUT' : 'POST'
			const url = editingLabel
				? `${API_BASE}/api/labels/${editingLabel.id}`
				: `${API_BASE}/api/labels`

			await fetch(url, {
				method,
				headers: {
					Authorization: `Bearer ${token}`,
					'X-App-Id': appId,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(labelForm),
			})
			setShowLabelModal(false)
			setEditingLabel(null)
			setLabelForm({ title: '', color: '#10B981', description: '' })
			fetchLabels()
		} catch (error) {
			console.error('Failed to save label:', error)
		}
	}

	// Delete confirmation modal state
	const [showDeleteModal, setShowDeleteModal] = useState(false)
	const [deletingLabel, setDeletingLabel] = useState<any>(null)
	const [isDeleting, setIsDeleting] = useState(false)

	const confirmDeleteLabel = (label: any) => {
		setDeletingLabel(label)
		setShowDeleteModal(true)
	}

	const deleteLabel = async () => {
		if (!deletingLabel) return
		setIsDeleting(true)
		try {
			const token = localStorage.getItem('crm_token')
			await fetch(`${API_BASE}/api/labels/${deletingLabel.id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}`, 'X-App-Id': appId },
			})
			setShowDeleteModal(false)
			setDeletingLabel(null)
			fetchLabels()
		} catch (error) {
			console.error('Failed to delete label:', error)
		} finally {
			setIsDeleting(false)
		}
	}

	useEffect(() => {
		if (activeNav === 'labels') {
			fetchLabels()
		}
	}, [activeNav])

	return (
		<div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
			<div className="flex flex-1 flex-col overflow-auto px-4 pb-8 pt-4 lg:flex-row lg:space-x-12 lg:px-8 lg:pt-6">
				<div className="mb-4 lg:hidden">
					<label htmlFor="settings-section" className="mb-1.5 block text-xs font-semibold text-muted-foreground">Bagian pengaturan</label>
					<select
						id="settings-section"
						value={activeNav}
						onChange={(event) => setActiveSection(event.target.value as SettingsNavItemId)}
						className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm font-semibold text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
					>
						{visibleNavItems.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
					</select>
				</div>

				{/* Sidebar Nav */}
				<aside className="mb-8 hidden shrink-0 lg:block lg:w-1/5 lg:mb-0">
					<nav className="flex flex-col space-y-1">
						{visibleNavItems.map((item) => (
							<button
								key={item.id}
								onClick={() => setActiveSection(item.id)}
								className={`flex items-center gap-3 px-4 py-2.5 rounded-lg text-sm font-bold transition-all whitespace-nowrap lg:w-full ${
									activeNav === item.id
										? 'bg-emerald-50 text-emerald-700'
										: 'text-gray-500 hover:text-gray-900 hover:bg-gray-50'
								}`}
							>
								<item.icon size={18} />
								{item.title}
							</button>
						))}
					</nav>
				</aside>

				{/* Content Area */}
				<div className="w-full min-w-0 flex-1 max-w-4xl">
					<div className="space-y-6">
						{/* ========== PROFILE SECTION ========== */}
						{activeNav === 'general' && visibleTabIds.includes('general') && (
							<ProfileSettingsManager />
						)}

						{/* ========== LABELS SECTION ========== */}
						{activeNav === 'labels' && visibleTabIds.includes('labels') && (
							<div className="space-y-6">
								<Card className="border-gray-100 shadow-sm overflow-hidden">
									<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
										<div className="flex items-center justify-between">
											<div className="flex items-center gap-2">
												<Tag size={20} className="text-emerald-600" />
												<CardTitle className="text-lg font-bold">
													Manage Labels
												</CardTitle>
											</div>
											<Button
												onClick={() => {
													setEditingLabel(null)
													setLabelForm({
														title: '',
														color: '#10B981',
														description: '',
													})
													setShowLabelModal(true)
												}}
												className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-9 px-4"
											>
												<Plus size={16} className="mr-2" />
												Add Label
											</Button>
										</div>
										<CardDescription>
											Create and manage labels to organize your conversations
										</CardDescription>
									</CardHeader>
									<CardContent className="p-6">
										{labelsLoading ? (
											<div className="flex items-center justify-center py-12">
												<div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
											</div>
										) : labels.length === 0 ? (
											<div className="flex flex-col items-center justify-center py-12 text-center">
												<Tag size={48} className="text-gray-300 mb-4" />
												<h4 className="font-bold text-gray-900 mb-1">
													No Labels Yet
												</h4>
												<p className="text-sm text-gray-500 max-w-sm">
													Create labels to categorize and organize your
													conversations.
												</p>
											</div>
										) : (
											<div className="space-y-3">
												{labels.map((label: any) => (
													<div
														key={label.id}
														className="flex items-center justify-between p-4 border border-gray-100 rounded-xl hover:bg-gray-50 transition-colors"
													>
														<div className="flex items-center gap-3">
															<div
																className="w-8 h-8 rounded-lg flex items-center justify-center"
																style={{
																	backgroundColor: `${label.color || '#10B981'}20`,
																}}
															>
																<div
																	className="w-3 h-3 rounded-full"
																	style={{
																		backgroundColor: label.color || '#10B981',
																	}}
																></div>
															</div>
															<div>
																<p className="font-bold text-gray-900">
																	{label.name || label.title}
																</p>
																{label.description && (
																	<p className="text-xs text-gray-500">
																		{label.description}
																	</p>
																)}
															</div>
														</div>
														<div className="flex items-center gap-2">
															<Button
																variant="outline"
																size="sm"
																onClick={() => {
																	setEditingLabel(label)
																	setLabelForm({
																		title: label.name || label.title,
																		color: label.color || '#10B981',
																		description: label.description || '',
																	})
																	setShowLabelModal(true)
																}}
																className="h-8 px-2"
															>
																<Edit2 size={14} />
															</Button>
															<Button
																variant="outline"
																size="sm"
																onClick={() => confirmDeleteLabel(label)}
																className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50"
															>
																<Trash2 size={14} />
															</Button>
														</div>
													</div>
												))}
											</div>
										)}
									</CardContent>
								</Card>

								{/* Label Modal */}
								{showLabelModal && (
									<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
										<div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
											<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
												<h3 className="text-lg font-bold text-gray-900">
													{editingLabel ? 'Edit Label' : 'Create New Label'}
												</h3>
												<button
													onClick={() => setShowLabelModal(false)}
													className="p-2 hover:bg-gray-100 rounded-lg"
												>
													<X size={20} className="text-gray-400" />
												</button>
											</div>
											<div className="p-6 space-y-4">
												<div className="grid gap-2">
													<label className="text-xs font-black uppercase tracking-widest text-gray-400">
														Label Name
													</label>
													<Input
														value={labelForm.title}
														onChange={(e) =>
															setLabelForm({
																...labelForm,
																title: e.target.value,
															})
														}
														placeholder="e.g. VIP Customer, Urgent, Follow Up"
														className="h-10 rounded-lg border-gray-200"
													/>
												</div>
												<div className="grid gap-2">
													<label className="text-xs font-black uppercase tracking-widest text-gray-400">
														Color
													</label>
													<div className="flex items-center gap-3">
														<input
															type="color"
															value={labelForm.color}
															onChange={(e) =>
																setLabelForm({
																	...labelForm,
																	color: e.target.value,
																})
															}
															className="w-12 h-10 rounded-lg border border-gray-200 cursor-pointer"
														/>
														<div className="flex gap-2">
															{[
																'#EF4444',
																'#F59E0B',
																'#10B981',
																'#3B82F6',
																'#8B5CF6',
																'#EC4899',
																'#6366F1',
																'#14B8A6',
															].map((color) => (
																<button
																	key={color}
																	onClick={() =>
																		setLabelForm({ ...labelForm, color })
																	}
																	className={`w-8 h-8 rounded-lg transition-all ${labelForm.color === color ? 'ring-2 ring-offset-2 ring-gray-400' : ''}`}
																	style={{ backgroundColor: color }}
																/>
															))}
														</div>
													</div>
												</div>
												<div className="grid gap-2">
													<label className="text-xs font-black uppercase tracking-widest text-gray-400">
														Description (Optional)
													</label>
													<Input
														value={labelForm.description}
														onChange={(e) =>
															setLabelForm({
																...labelForm,
																description: e.target.value,
															})
														}
														placeholder="Brief description of this label"
														className="h-10 rounded-lg border-gray-200"
													/>
												</div>
												<div className="flex gap-3 pt-2">
													<Button
														variant="outline"
														onClick={() => setShowLabelModal(false)}
														className="flex-1"
													>
														Cancel
													</Button>
													<Button
														onClick={saveLabel}
														disabled={!labelForm.title.trim()}
														className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white font-bold"
													>
														<Save size={16} className="mr-2" />
														{editingLabel ? 'Update Label' : 'Create Label'}
													</Button>
												</div>
											</div>
										</div>
									</div>
								)}

								{/* Delete Confirmation Modal */}
								{showDeleteModal && deletingLabel && (
									<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
										<div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
											<div className="p-6 text-center">
												<div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
													<Trash2 size={32} className="text-red-600" />
												</div>
												<h3 className="text-lg font-bold text-gray-900 mb-2">
													Delete Label
												</h3>
												<p className="text-sm text-gray-500 mb-4">
													Are you sure you want to delete{' '}
													<strong className="text-gray-900">
														"{deletingLabel.name || deletingLabel.title}"
													</strong>
													? This action cannot be undone.
												</p>
												<div className="flex gap-3">
													<Button
														variant="outline"
														onClick={() => {
															setShowDeleteModal(false)
															setDeletingLabel(null)
														}}
														disabled={isDeleting}
														className="flex-1"
													>
														Cancel
													</Button>
													<Button
														onClick={deleteLabel}
														disabled={isDeleting}
														className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
													>
														{isDeleting ? (
															<>
																<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
																Deleting...
															</>
														) : (
															<>
																<Trash2 size={16} className="mr-2" />
																Delete Label
															</>
														)}
													</Button>
												</div>
											</div>
										</div>
									</div>
								)}
							</div>
						)}

						{/* ========== SECURITY SECTION ========== */}
						{activeNav === 'security' && visibleTabIds.includes('security') && (
							<SecuritySettingsManager />
						)}

						{/* ========== NOTIFICATIONS SECTION ========== */}
						{activeNav === 'notifications' && (
							<div className="space-y-6">
								<Card className="border-gray-100 shadow-sm overflow-hidden">
									<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
										<div className="flex items-center gap-2">
											<Bell size={20} className="text-emerald-600" />
											<CardTitle className="text-lg font-bold">
												Notification Preferences
											</CardTitle>
										</div>
										<CardDescription>
											Manage how you are notified of new messages
										</CardDescription>
									</CardHeader>
									<CardContent className="p-6 space-y-6">
										<div className="flex items-center justify-between">
											<div className="space-y-0.5">
												<label className="text-sm font-bold text-gray-900">
													Sound Notifications
												</label>
												<p className="text-xs text-gray-500">
													Play a sound when a new message arrives
												</p>
											</div>
											<div className="flex items-center gap-4">
												{soundEnabled && (
													<Button
														variant="outline"
														size="sm"
														className="h-8 text-xs"
														onClick={() => playNotificationSound(true)}
													>
														Test Sound
													</Button>
												)}
												<button
													onClick={() => {
														const newState = !soundEnabled
														setSoundEnabled(newState)
														localStorage.setItem(
															'crm_sound_enabled',
															String(newState),
														)
													}}
													className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
														soundEnabled ? 'bg-emerald-500' : 'bg-gray-200'
													}`}
												>
													<span
														className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
															soundEnabled ? 'translate-x-6' : 'translate-x-1'
														}`}
													/>
												</button>
											</div>
										</div>

										<div className="flex items-center justify-between">
											<div className="space-y-0.5">
												<label className="text-sm font-bold text-gray-900">
													Desktop Notifications
												</label>
												<p className="text-xs text-gray-500">
													Receive browser notifications when the tab is hidden
												</p>
											</div>
											<div className="flex items-center gap-4">
												{notificationsEnabled && (
													<Button
														variant="outline"
														size="sm"
														className="h-8 text-xs"
														onClick={() =>
															sendBrowserNotification(
																'Test Notification',
																'This is how your notifications will appear.',
															)
														}
													>
														Test
													</Button>
												)}
												<button
													onClick={async () => {
														if (!notificationsEnabled) {
															const perm =
																await Notification.requestPermission()
															if (perm === 'granted') {
																setNotificationsEnabled(true)
																localStorage.setItem(
																	'crm_notifications_enabled',
																	'true',
																)
															} else {
																alert(
																	'Permission denied. Please enable notifications in your browser settings.',
																)
															}
														} else {
															setNotificationsEnabled(false)
															localStorage.setItem(
																'crm_notifications_enabled',
																'false',
															)
														}
													}}
													className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
														notificationsEnabled
															? 'bg-emerald-500'
															: 'bg-gray-200'
													}`}
												>
													<span
														className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
															notificationsEnabled
																? 'translate-x-6'
																: 'translate-x-1'
														}`}
													/>
												</button>
											</div>
										</div>

										<div className="flex items-center justify-between">
											<div className="space-y-0.5">
												<label className="text-sm font-bold text-gray-900">
													Email Notifications
												</label>
												<p className="text-xs text-gray-500">
													Receive email summaries of unread messages
												</p>
											</div>
											<button className="relative inline-flex h-6 w-11 items-center rounded-full transition-colors bg-gray-200">
												<span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-1" />
											</button>
										</div>

										<p className="text-xs text-emerald-600 bg-emerald-50 p-2 rounded">
											<strong>Pro Tip:</strong> Enabling desktop notifications
											ensures you never miss a message even when minimized.
										</p>
									</CardContent>
								</Card>
							</div>
						)}

						{/* ========== LOCALIZATION SECTION ========== */}
						{activeNav === 'localization' && (
							<div className="space-y-6">
								<Card className="border-gray-100 shadow-sm overflow-hidden">
									<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
										<div className="flex items-center gap-2">
											<Globe size={20} className="text-emerald-600" />
											<CardTitle className="text-lg font-bold">
												Language & Region
											</CardTitle>
										</div>
										<CardDescription>
											Set your preferred language and timezone
										</CardDescription>
									</CardHeader>
									<CardContent className="p-6 space-y-4">
										<div className="grid gap-2">
											<label className="text-xs font-black uppercase tracking-widest text-gray-400">
												Language
											</label>
											<select className="h-10 px-3 rounded-lg border border-gray-200 text-sm">
												<option value="en">English</option>
												<option value="id">Bahasa Indonesia</option>
												<option value="zh">中文</option>
											</select>
										</div>
										<div className="grid gap-2">
											<label className="text-xs font-black uppercase tracking-widest text-gray-400">
												Timezone
											</label>
											<select className="h-10 px-3 rounded-lg border border-gray-200 text-sm">
												<option value="Asia/Jakarta">Asia/Jakarta (WIB)</option>
												<option value="Asia/Singapore">Asia/Singapore</option>
												<option value="America/New_York">
													America/New_York (EST)
												</option>
											</select>
										</div>
										<div className="grid gap-2">
											<label className="text-xs font-black uppercase tracking-widest text-gray-400">
												Date Format
											</label>
											<select className="h-10 px-3 rounded-lg border border-gray-200 text-sm">
												<option value="DD/MM/YYYY">DD/MM/YYYY</option>
												<option value="MM/DD/YYYY">MM/DD/YYYY</option>
												<option value="YYYY-MM-DD">YYYY-MM-DD</option>
											</select>
										</div>
										<Button className="mt-2 bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-10 px-6">
											<Save size={18} className="mr-2" />
											Save Preferences
										</Button>
									</CardContent>
								</Card>
							</div>
						)}

						{/* ========== SALES DATA SECTION ========== */}
						{activeNav === 'sales-data' &&
							visibleTabIds.includes('sales-data') && <SalesProfileSelfManager />}

						{/* ========== AI MODELS SECTION ========== */}
						{activeNav === 'ai-replies' &&
							visibleTabIds.includes('ai-replies') && <PersonalAiSettingsManager />}

						{/* ========== AI MODELS SECTION ========== */}
						{activeNav === 'ai-models' &&
							visibleTabIds.includes('ai-models') && <AIConfigurationManager />}

						{/* ========== WHATSAPP SECTION ========== */}
						{activeNav === 'whatsapp' &&
							visibleTabIds.includes('whatsapp') && <WhatsAppSettingsManager />}

						{/* ========== DEVELOPER TOOLS SECTION ========== */}
						{activeNav === 'developer' && visibleTabIds.includes('developer') && (
							<div className="space-y-6">
								<Card className="border-gray-100 shadow-sm overflow-hidden">
									<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
										<div className="flex items-center gap-2">
											<Key size={20} className="text-emerald-600" />
											<CardTitle className="text-lg font-bold">
												API Keys
											</CardTitle>
										</div>
										<CardDescription>
											Manage your API credentials
										</CardDescription>
									</CardHeader>
									<CardContent className="p-6 space-y-4">
										<div className="grid gap-2">
											<label className="text-xs font-black uppercase tracking-widest text-gray-400">
												App ID
											</label>
											<div className="flex gap-2">
												<Input
													value="app_demo_placeholder"
													readOnly
													className="h-10 rounded-lg border-gray-200 bg-gray-50 font-mono text-xs"
												/>
												<Button variant="outline" size="sm" className="h-10">
													Copy
												</Button>
											</div>
										</div>
										<div className="grid gap-2">
											<label className="text-xs font-black uppercase tracking-widest text-gray-400">
												API Secret
											</label>
											<div className="flex gap-2">
												<Input
													type="password"
													value="secret_demo_placeholder"
													readOnly
													className="h-10 rounded-lg border-gray-200 bg-gray-50 font-mono text-xs"
												/>
												<Button variant="outline" size="sm" className="h-10">
													<Eye size={16} />
												</Button>
												<Button variant="outline" size="sm" className="h-10">
													Copy
												</Button>
											</div>
										</div>
										<Button
											variant="outline"
											className="text-orange-600 border-orange-200 hover:bg-orange-50"
										>
											Regenerate Secret
										</Button>
									</CardContent>
								</Card>

								<Card className="border-gray-100 shadow-sm overflow-hidden">
									<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
										<div className="flex items-center gap-2">
											<Terminal size={20} className="text-emerald-600" />
											<CardTitle className="text-lg font-bold">
												Webhooks
											</CardTitle>
										</div>
										<CardDescription>
											Configure webhook endpoints for events
										</CardDescription>
									</CardHeader>
									<CardContent className="p-6">
										<div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed border-gray-100 rounded-xl">
											<Terminal size={40} className="text-gray-300 mb-4" />
											<h4 className="font-bold text-gray-900">
												No Webhooks Configured
											</h4>
											<p className="text-sm text-gray-500 max-w-xs mt-2">
												Add a webhook endpoint to receive real-time events.
											</p>
											<Button
												variant="outline"
												className="mt-4 font-bold border-gray-200 hover:bg-gray-50"
											>
												Add Webhook
											</Button>
										</div>
									</CardContent>
								</Card>
							</div>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
