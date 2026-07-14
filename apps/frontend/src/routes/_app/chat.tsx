import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useAppContext } from '@/routes/_app'
import {
	AlertCircle,
	ArrowLeft,
	Ban,
	Check,
	CheckCheck,
	CheckSquare,
	Copy,
	Download,
	FileText,
	Inbox,
	ImageIcon,
	Info,
	LayoutDashboard,
	Menu,
	MessageCircle,
	Mic,
	Paperclip,
	Plus,
	Phone,
	RefreshCw,
	Reply,
	Search,
	SendHorizontal,
	Smile,
	Square,
	Sticker,
	Trash2,
	Undo2,
	UserCheck,
	Video,
	UserRound,
	Smartphone,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { API_BASE, readApiResponse } from '@/lib/api'
import { connectSocket, joinApp } from '@/lib/socket'
import { cn } from '@/lib/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export const Route = createFileRoute('/_app/chat')({
	component: PersonalWhatsappInbox,
})

type Conversation = {
	id: string
	contactId: string | null
	workflow: 'ai' | 'handover' | 'human'
	name: string
	phone: string
	avatarUrl: string | null
	source: string | null
	preview: string
	lastMessageAt: string | null
	unread: number
}

type ChatMessage = {
	id: string
	external_id: string | null
	content: string | null
	content_type: string | null
	content_attributes: {
		media?: { url?: string; mime_type?: string; file_name?: string; filename?: string; purpose?: string }
		quote?: { message_id?: string; external_id?: string; content?: string | null; content_type?: string | null; sender_type?: string | null }
	} | null
	message_type: string
	sender_type: string | null
	status: string | null
	reply_to_message_id: string | null
	created_at: string | null
}

type MediaPurpose = 'attachment' | 'voice' | 'gif' | 'sticker'
type OutboundMedia = { url: string; kind: 'image' | 'video' | 'audio' | 'document' | 'voice' | 'gif' | 'sticker'; mimeType: string; fileName: string }
type PendingAttachment = { id: string; file: File; purpose: MediaPurpose; previewUrl: string | null }

type Diagnostic = {
	connection: string
	storedMessages: number
	lastSeenAt?: string | null
}

type LeadRegistration = {
	id: string
	status: 'pending' | 'blocked'
	name: string
	phone: string
	avatarUrl: string | null
	conversationId: string | null
	preview: string
	lastMessageAt: string | null
	source: string
}

type InboxFilter = 'all' | 'ai' | 'handover' | 'human' | 'unread' | 'pending' | 'blocked'

function authHeaders() {
	const token = localStorage.getItem('crm_token')
	const appId = localStorage.getItem('crm_app_id')
	return {
		...(token ? { Authorization: `Bearer ${token}` } : {}),
		...(appId ? { 'X-App-Id': appId } : {}),
	}
}

function formatTime(value: string | null) {
	if (!value) return ''
	return new Intl.DateTimeFormat('id-ID', {
		hour: '2-digit',
		minute: '2-digit',
	}).format(new Date(value))
}

function formatListTime(value: string | null) {
	if (!value) return ''
	const date = new Date(value)
	const now = new Date()
	if (date.toDateString() === now.toDateString()) return formatTime(value)
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
	}).format(date)
}

function formatCopyTimestamp(value: string | null) {
	if (!value) return 'Waktu tidak diketahui'
	return new Intl.DateTimeFormat('id-ID', {
		day: '2-digit',
		month: '2-digit',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).format(new Date(value))
}

function storedUserName() {
	try {
		const raw = localStorage.getItem('crm_user')
		const parsed = raw ? JSON.parse(raw) : null
		const user = parsed?.user && typeof parsed.user === 'object' ? parsed.user : parsed
		return String(user?.name || user?.email?.split('@')?.[0] || 'Sales').trim()
	} catch {
		return 'Sales'
	}
}

function PersonalWhatsappInbox() {
	const navigate = useNavigate()
	const [conversations, setConversations] = useState<Conversation[]>([])
	const [pendingLeads, setPendingLeads] = useState<LeadRegistration[]>([])
	const [blockedLeads, setBlockedLeads] = useState<LeadRegistration[]>([])
	const [messages, setMessages] = useState<ChatMessage[]>([])
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null)
	const [query, setQuery] = useState('')
	const [filter, setFilter] = useState<InboxFilter>('all')
	const [menuOpen, setMenuOpen] = useState(false)
	const [newChatOpen, setNewChatOpen] = useState(false)
	const [newContactName, setNewContactName] = useState('')
	const [newPhoneNumber, setNewPhoneNumber] = useState('')
	const [voiceTranscript, setVoiceTranscript] = useState('')
	const [recording, setRecording] = useState(false)
	const [transcribing, setTranscribing] = useState(false)
	const [creatingChat, setCreatingChat] = useState(false)
	const [newChatError, setNewChatError] = useState<string | null>(null)
	const [draft, setDraft] = useState('')
	const [sendingMessage, setSendingMessage] = useState(false)
	const [composerError, setComposerError] = useState<string | null>(null)
	const [deleteTarget, setDeleteTarget] = useState<ChatMessage | null>(null)
	const [bulkDeleteIds, setBulkDeleteIds] = useState<string[]>([])
	const [deletingMessage, setDeletingMessage] = useState(false)
	const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set())
	const [contextMenu, setContextMenu] = useState<{ x: number; y: number; message: ChatMessage } | null>(null)
	const [replyTarget, setReplyTarget] = useState<ChatMessage | null>(null)
	const [dragActive, setDragActive] = useState(false)
	const [uploadingMedia, setUploadingMedia] = useState(false)
	const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([])
	const [profileOpen, setProfileOpen] = useState(false)
	const [voiceRecording, setVoiceRecording] = useState(false)
	const [contactPresence, setContactPresence] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [repairing, setRepairing] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [leadActionId, setLeadActionId] = useState<string | null>(null)
	const [leadActionError, setLeadActionError] = useState<string | null>(null)
	const recorderRef = useRef<MediaRecorder | null>(null)
	const recorderTimeoutRef = useRef<number | null>(null)
	const voiceRecorderRef = useRef<MediaRecorder | null>(null)
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const mediaPurposeRef = useRef<MediaPurpose>('attachment')
	const presenceIdleRef = useRef<number | null>(null)
	const lastPresenceSentRef = useRef(0)
	const dragDepthRef = useRef(0)
	const profileSyncRequestedRef = useRef(false)
	const selectedPhone = conversations.find((item) => item.id === selectedId)?.phone || ''
	const selectedName = conversations.find((item) => item.id === selectedId)?.name || 'Kontak'
	const connected = diagnostic?.connection === 'connected'
	const currentUserName = useMemo(storedUserName, [])

	const loadConversations = useCallback(async () => {
		try {
			setError(null)
			const response = await fetch(
				`${API_BASE}/personal-whatsapp-inbox/conversations`,
				{ headers: authHeaders() },
			)
			const payload = (await readApiResponse(response)) as {
				data?: Conversation[]
				diagnostic?: Diagnostic
				error?: string
			}
			if (!response.ok) throw new Error(payload.error || 'Gagal membuka kotak masuk')
			setConversations(payload.data || [])
			setDiagnostic(payload.diagnostic || null)
			if (!profileSyncRequestedRef.current && payload.diagnostic?.connection === 'connected') {
				profileSyncRequestedRef.current = true
				void fetch(`${API_BASE}/personal-whatsapp-inbox/sync-profiles`, {
					method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ force: false }),
				}).catch(() => undefined)
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal membuka kotak masuk')
		} finally {
			setLoading(false)
		}
	}, [])

	const loadLeadLists = useCallback(async () => {
		const loadStatus = async (status: 'pending' | 'blocked') => {
			const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/leads?status=${status}`, { headers: authHeaders() })
			const payload = (await readApiResponse(response)) as { data?: LeadRegistration[]; error?: string }
			if (!response.ok) throw new Error(payload.error || 'Daftar keputusan lead belum dapat dimuat')
			return payload.data || []
		}
		try {
			const [pending, blocked] = await Promise.all([loadStatus('pending'), loadStatus('blocked')])
			setPendingLeads(pending)
			setBlockedLeads(blocked)
		} catch (reason) {
			setLeadActionError(reason instanceof Error ? reason.message : 'Daftar keputusan lead belum dapat dimuat')
		}
	}, [])

	const loadMessages = useCallback(async (conversationId: string) => {
		const response = await fetch(
			`${API_BASE}/personal-whatsapp-inbox/${conversationId}/messages`,
			{ headers: authHeaders() },
		)
		const payload = (await readApiResponse(response)) as { data?: ChatMessage[] }
		if (response.ok) setMessages(payload.data || [])
	}, [])

	const markRead = useCallback(async (conversationId: string) => {
		setConversations((current) => current.map((item) => (
			item.id === conversationId ? { ...item, unread: 0 } : item
		)))
		const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/${conversationId}/read`, {
			method: 'POST',
			headers: authHeaders(),
		})
		if (response.ok) {
			setConversations((current) => current.map((item) => (
				item.id === conversationId ? { ...item, unread: 0 } : item
			)))
		}
	}, [])

	const repairAndRefresh = useCallback(async () => {
		setRepairing(true)
		try {
			await fetch(`${API_BASE}/personal-whatsapp-inbox/repair-queue`, {
				method: 'POST',
				headers: authHeaders(),
			})
			await Promise.all([loadConversations(), loadLeadLists()])
			if (selectedId) await loadMessages(selectedId)
		} finally {
			setRepairing(false)
		}
	}, [loadConversations, loadLeadLists, loadMessages, selectedId])

	useEffect(() => {
		void Promise.all([loadConversations(), loadLeadLists()])
	}, [loadConversations, loadLeadLists])

	useEffect(() => {
		if (window.location.search) {
			window.history.replaceState(window.history.state, '', '/chat')
		}
	}, [])

	useEffect(() => {
		if (selectedId) {
			void Promise.all([loadMessages(selectedId), markRead(selectedId)])
		}
		else setMessages([])
		setSelectedMessageIds(new Set())
		setContextMenu(null)
		setReplyTarget(null)
		setProfileOpen(false)
		setPendingAttachments((current) => {
			for (const attachment of current) if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
			return []
		})
	}, [selectedId, loadMessages, markRead])

	useEffect(() => {
		if (!contextMenu) return
		const close = () => setContextMenu(null)
		window.addEventListener('click', close)
		window.addEventListener('resize', close)
		return () => {
			window.removeEventListener('click', close)
			window.removeEventListener('resize', close)
		}
	}, [contextMenu])

	useEffect(() => {
		const socket = connectSocket()
		const appId = localStorage.getItem('crm_app_id')
		if (appId) joinApp(appId)
		const refresh = () => {
			void Promise.all([loadConversations(), loadLeadLists()])
			if (selectedId) void Promise.all([loadMessages(selectedId), markRead(selectedId)])
		}
		const handlePresence = (payload: { phone?: string; presence?: string }) => {
			const incoming = String(payload.phone || '').replace(/\D/g, '')
			const selected = selectedPhone.replace(/\D/g, '')
			if (incoming && selected && incoming === selected) setContactPresence(String(payload.presence || 'unavailable'))
		}
		const handleStatus = (payload: { message_id?: string; status?: string }) => {
			if (!payload.message_id || !payload.status) return
			setMessages((current) => current.map((message) => message.id === payload.message_id ? { ...message, status: payload.status || message.status } : message))
		}
		const handleMessageCreated = (payload: { message: ChatMessage; conversation: { id: string } }) => {
			if (payload.conversation?.id === selectedId) {
				setMessages((current) => {
					const exists = current.some((m) => m.id === payload.message.id)
					return exists ? current : [...current, payload.message]
				})
			}
			void Promise.all([loadConversations(), loadLeadLists()])
		}
		socket.on('message:created', handleMessageCreated)
		socket.on('message:deleted', refresh)
		socket.on('message:restored', refresh)
		socket.on('whatsapp:presence', handlePresence)
		socket.on('message:status_updated', handleStatus)
		socket.on('contact:profile_updated', loadConversations)
		socket.on('message:revoked', refresh)
		socket.on('personal-lead:updated', refresh)
		return () => {
			socket.off('message:created', handleMessageCreated)
			socket.off('message:deleted', refresh)
			socket.off('message:restored', refresh)
			socket.off('whatsapp:presence', handlePresence)
			socket.off('message:status_updated', handleStatus)
			socket.off('contact:profile_updated', loadConversations)
			socket.off('message:revoked', refresh)
			socket.off('personal-lead:updated', refresh)
		}
	}, [loadConversations, loadLeadLists, loadMessages, markRead, selectedId, selectedPhone])

	const pollingRef = useRef<number | null>(null)
	useEffect(() => {
		if (!selectedId) return
		if (connected) {
			if (pollingRef.current) { window.clearInterval(pollingRef.current); pollingRef.current = null }
			return
		}
		pollingRef.current = window.setInterval(() => {
			void loadMessages(selectedId)
		}, 5_000)
		return () => { if (pollingRef.current) { window.clearInterval(pollingRef.current); pollingRef.current = null } }
	}, [connected, loadMessages, selectedId])

	const updateLeadStatus = useCallback(async (
		lead: LeadRegistration,
		action: 'confirm' | 'reject' | 'unblock',
	) => {
		setLeadActionId(lead.id)
		setLeadActionError(null)
		try {
			const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/leads/${lead.id}/${action}`, {
				method: 'POST',
				headers: authHeaders(),
			})
			const payload = (await readApiResponse(response)) as { error?: string }
			if (!response.ok) throw new Error(payload.error || 'Status lead belum dapat diperbarui')
			await Promise.all([loadConversations(), loadLeadLists()])
			if ((action === 'confirm' || action === 'unblock') && lead.conversationId) {
				setFilter('all')
				setSelectedId(lead.conversationId)
			}
		} catch (reason) {
			setLeadActionError(reason instanceof Error ? reason.message : 'Status lead belum dapat diperbarui')
		} finally {
			setLeadActionId(null)
		}
	}, [loadConversations, loadLeadLists])

	const publishPresence = useCallback((presence: 'composing' | 'recording' | 'paused') => {
		if (!selectedId || !connected) return
		void fetch(`${API_BASE}/personal-whatsapp-inbox/${selectedId}/presence`, {
			method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ presence }),
		}).catch(() => undefined)
	}, [connected, selectedId])

	useEffect(() => {
		if (!draft.trim()) {
			if (presenceIdleRef.current) window.clearTimeout(presenceIdleRef.current)
			publishPresence('paused')
			return
		}
		if (Date.now() - lastPresenceSentRef.current > 1_500) {
			lastPresenceSentRef.current = Date.now()
			publishPresence('composing')
		}
		if (presenceIdleRef.current) window.clearTimeout(presenceIdleRef.current)
		presenceIdleRef.current = window.setTimeout(() => publishPresence('paused'), 2_500)
		return () => { if (presenceIdleRef.current) window.clearTimeout(presenceIdleRef.current) }
	}, [draft, publishPresence])

	useEffect(() => {
		if (voiceRecording) publishPresence('recording')
		else publishPresence('paused')
	}, [publishPresence, voiceRecording])

	useEffect(() => () => {
		if (recorderTimeoutRef.current) window.clearTimeout(recorderTimeoutRef.current)
		const recorder = recorderRef.current
		if (recorder?.state === 'recording') recorder.stop()
		recorder?.stream.getTracks().forEach((track) => track.stop())
		const voiceRecorder = voiceRecorderRef.current
		if (voiceRecorder?.state === 'recording') voiceRecorder.stop()
		voiceRecorder?.stream.getTracks().forEach((track) => track.stop())
	}, [])

	const transcribeRecording = useCallback(async (blob: Blob) => {
		setTranscribing(true)
		setNewChatError(null)
		try {
			const formData = new FormData()
			formData.append('audio', blob, `nomor.${blob.type.includes('ogg') ? 'ogg' : 'webm'}`)
			formData.append('language', 'id')
			const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/transcribe-number`, {
				method: 'POST',
				headers: authHeaders(),
				body: formData,
			})
			const payload = (await readApiResponse(response)) as {
				data?: { transcript?: string; phoneNumber?: string | null }
				error?: string
			}
			if (!response.ok) throw new Error(payload.error || 'Suara belum dapat diproses')
			setVoiceTranscript(payload.data?.transcript || '')
			if (payload.data?.phoneNumber) setNewPhoneNumber(payload.data.phoneNumber)
			else setNewChatError('Nomornya belum terbaca utuh. Coba ucapkan digit satu per satu atau koreksi manual.')
		} catch (reason) {
			setNewChatError(reason instanceof Error ? reason.message : 'Suara belum dapat diproses')
		} finally {
			setTranscribing(false)
		}
	}, [])

	const toggleRecording = useCallback(async () => {
		if (recording) {
			recorderRef.current?.stop()
			return
		}
		setNewChatError(null)
		setVoiceTranscript('')
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
				? 'audio/webm;codecs=opus'
				: MediaRecorder.isTypeSupported('audio/ogg;codecs=opus') ? 'audio/ogg;codecs=opus' : ''
			const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
			const chunks: BlobPart[] = []
			recorder.ondataavailable = (event) => {
				if (event.data.size) chunks.push(event.data)
			}
			recorder.onstop = () => {
				if (recorderTimeoutRef.current) window.clearTimeout(recorderTimeoutRef.current)
				recorderTimeoutRef.current = null
				stream.getTracks().forEach((track) => track.stop())
				setRecording(false)
				const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
				if (blob.size) void transcribeRecording(blob)
			}
			recorderRef.current = recorder
			recorder.start()
			setRecording(true)
			recorderTimeoutRef.current = window.setTimeout(() => {
				if (recorder.state === 'recording') recorder.stop()
			}, 20_000)
		} catch {
			setNewChatError('Mikrofon belum bisa diakses. Izinkan akses mikrofon di browser lalu coba lagi.')
		}
	}, [recording, transcribeRecording])

	const createConversation = useCallback(async () => {
		setCreatingChat(true)
		setNewChatError(null)
		try {
			const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/start`, {
				method: 'POST',
				headers: { ...authHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ phoneNumber: newPhoneNumber, name: newContactName || undefined }),
			})
			const payload = (await readApiResponse(response)) as { data?: { id?: string }; error?: string }
			if (!response.ok || !payload.data?.id) throw new Error(payload.error || 'Percakapan belum dapat dibuat')
			await loadConversations()
			setSelectedId(payload.data.id)
			setNewChatOpen(false)
			setNewContactName('')
			setNewPhoneNumber('')
			setVoiceTranscript('')
		} catch (reason) {
			setNewChatError(reason instanceof Error ? reason.message : 'Percakapan belum dapat dibuat')
		} finally {
			setCreatingChat(false)
		}
	}, [loadConversations, newContactName, newPhoneNumber])

	const sendOutbound = useCallback(async (content: string, media?: OutboundMedia) => {
		if (!selectedId || (!content.trim() && !media) || sendingMessage) return false
		setSendingMessage(true)
		setComposerError(null)
		try {
			const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/${selectedId}/messages`, {
				method: 'POST',
				headers: { ...authHeaders(), 'Content-Type': 'application/json' },
				body: JSON.stringify({ content: content.trim(), media, replyToMessageId: replyTarget?.id }),
			})
			const payload = (await readApiResponse(response)) as { error?: string }
			if (!response.ok) throw new Error(payload.error || 'Pesan belum dapat dikirim')
			await Promise.all([loadMessages(selectedId), loadConversations()])
			setReplyTarget(null)
			return true
		} catch (reason) {
			setComposerError(reason instanceof Error ? reason.message : 'Pesan belum dapat dikirim')
			return false
		} finally {
			setSendingMessage(false)
		}
	}, [loadConversations, loadMessages, replyTarget, selectedId, sendingMessage])

	const sendTextMessage = useCallback(async () => {
		if (await sendOutbound(draft)) setDraft('')
	}, [draft, sendOutbound])

	const uploadMedia = useCallback(async (file: File, purpose: MediaPurpose): Promise<OutboundMedia> => {
		if (file.size > 25 * 1024 * 1024) {
			throw new Error(`${file.name}: ukuran file maksimal 25 MB.`)
		}
		const formData = new FormData()
		formData.append('file', file)
		formData.append('platform', 'whatsapp')
		formData.append('purpose', purpose)
		const response = await fetch(`${API_BASE}/media/upload`, { method: 'POST', headers: authHeaders(), body: formData })
		const payload = (await readApiResponse(response)) as { data?: { url: string; type: string; mimeType: string; fileName: string }; error?: string }
		if (!response.ok || !payload.data) throw new Error(payload.error || 'Media belum dapat diunggah')
		const kind: OutboundMedia['kind'] = purpose === 'voice' || purpose === 'gif' || purpose === 'sticker'
			? purpose
			: payload.data.type === 'image' || payload.data.type === 'video' || payload.data.type === 'audio' ? payload.data.type : 'document'
		return { url: payload.data.url, kind, mimeType: payload.data.mimeType, fileName: payload.data.fileName }
	}, [])

	const uploadAndSend = useCallback(async (file: File, purpose: MediaPurpose) => {
		setUploadingMedia(true)
		setComposerError(null)
		try {
			const media = await uploadMedia(file, purpose)
			await sendOutbound(purpose === 'sticker' || purpose === 'voice' ? '' : draft, media)
		} catch (reason) {
			setComposerError(reason instanceof Error ? reason.message : 'Media belum dapat dikirim')
		} finally {
			setUploadingMedia(false)
		}
	}, [draft, sendOutbound, uploadMedia])

	const addDraftFiles = useCallback((files: File[], purpose: MediaPurpose) => {
		const accepted = files.filter((file) => file.size <= 25 * 1024 * 1024).slice(0, 10)
		if (accepted.length !== files.length) setComposerError('Sebagian file dilewati. Maksimal 10 file, masing-masing 25 MB.')
		setPendingAttachments((current) => [
			...current,
			...accepted.slice(0, Math.max(0, 10 - current.length)).map((file) => ({
				id: crypto.randomUUID(),
				file,
				purpose: file.type === 'image/gif' && purpose === 'attachment' ? 'gif' : purpose,
				previewUrl: file.type.startsWith('image/') || file.type.startsWith('video/') ? URL.createObjectURL(file) : null,
			})),
		])
	}, [])

	const removeDraftAttachment = useCallback((id: string) => {
		setPendingAttachments((current) => {
			const removed = current.find((attachment) => attachment.id === id)
			if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl)
			return current.filter((attachment) => attachment.id !== id)
		})
	}, [])

	const sendDraftMessage = useCallback(async () => {
		if (!pendingAttachments.length) {
			await sendTextMessage()
			return
		}
		if (!selectedId || sendingMessage || uploadingMedia) return
		setSendingMessage(true)
		setUploadingMedia(true)
		setComposerError(null)
		try {
			for (let index = 0; index < pendingAttachments.length; index += 1) {
				const attachment = pendingAttachments[index]
				const media = await uploadMedia(attachment.file, attachment.purpose)
				const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/${selectedId}/messages`, {
					method: 'POST',
					headers: { ...authHeaders(), 'Content-Type': 'application/json' },
					body: JSON.stringify({ content: index === 0 ? draft.trim() : '', media, replyToMessageId: index === 0 ? replyTarget?.id : undefined }),
				})
				const payload = (await readApiResponse(response)) as { error?: string }
				if (!response.ok) throw new Error(payload.error || 'Lampiran belum dapat dikirim')
			}
			for (const attachment of pendingAttachments) if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl)
			setPendingAttachments([])
			setDraft('')
			setReplyTarget(null)
			await Promise.all([loadMessages(selectedId), loadConversations()])
		} catch (reason) {
			setComposerError(reason instanceof Error ? reason.message : 'Lampiran belum dapat dikirim')
		} finally {
			setSendingMessage(false)
			setUploadingMedia(false)
		}
	}, [draft, loadConversations, loadMessages, pendingAttachments, replyTarget, selectedId, sendTextMessage, sendingMessage, uploadMedia, uploadingMedia])

	const pickMedia = useCallback((purpose: MediaPurpose, accept: string) => {
		mediaPurposeRef.current = purpose
		if (!fileInputRef.current) return
		fileInputRef.current.accept = accept
		fileInputRef.current.click()
	}, [])

	const toggleVoiceNote = useCallback(async () => {
		if (voiceRecording) {
			voiceRecorderRef.current?.stop()
			return
		}
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const preferredType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
				? 'audio/webm;codecs=opus'
				: MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
					? 'audio/ogg;codecs=opus'
					: ''
			const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
			const chunks: BlobPart[] = []
			recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
			recorder.onstop = () => {
				stream.getTracks().forEach((track) => track.stop())
				setVoiceRecording(false)
				const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
				const extension = blob.type.includes('ogg') ? 'ogg' : 'webm'
				if (blob.size) void uploadAndSend(new File([blob], `voice-${Date.now()}.${extension}`, { type: blob.type }), 'voice')
			}
			voiceRecorderRef.current = recorder
			recorder.start()
			setVoiceRecording(true)
		} catch {
			setComposerError('Mikrofon belum bisa diakses. Izinkan mikrofon lalu coba lagi.')
		}
	}, [uploadAndSend, voiceRecording])

	const deleteMessage = useCallback(async () => {
		const ids = bulkDeleteIds.length ? bulkDeleteIds : deleteTarget ? [deleteTarget.id] : []
		if (!selectedId || !ids.length || deletingMessage) return
		setDeletingMessage(true)
		try {
			const bulk = ids.length > 1
			const response = await fetch(`${API_BASE}/personal-whatsapp-inbox/${selectedId}/messages${bulk ? '/bulk-delete' : `/${ids[0]}`}`, {
				method: 'DELETE',
				headers: bulk ? { ...authHeaders(), 'Content-Type': 'application/json' } : authHeaders(),
				...(bulk ? { body: JSON.stringify({ messageIds: ids }) } : {}),
			})
			const payload = (await readApiResponse(response)) as { error?: string }
			if (!response.ok) throw new Error(payload.error || 'Pesan belum dapat dihapus')
			setMessages((current) => current.filter((message) => !ids.includes(message.id)))
			setDeleteTarget(null)
			setBulkDeleteIds([])
			setSelectedMessageIds(new Set())
			await loadConversations()
		} catch (reason) {
			setComposerError(reason instanceof Error ? reason.message : 'Pesan belum dapat dihapus')
		} finally {
			setDeletingMessage(false)
		}
	}, [bulkDeleteIds, deleteTarget, deletingMessage, loadConversations, selectedId])

	const toggleMessageSelection = useCallback((messageId: string) => {
		setSelectedMessageIds((current) => {
			const next = new Set(current)
			if (next.has(messageId)) next.delete(messageId)
			else next.add(messageId)
			return next
		})
	}, [])

	const copyMessages = useCallback(async (ids: Iterable<string>) => {
		const selected = new Set(ids)
		const text = messages.filter((message) => selected.has(message.id)).map((message) => {
			const sender = message.message_type === 'outgoing' || message.sender_type === 'user' ? currentUserName : selectedName
			return `[${formatCopyTimestamp(message.created_at)}] ${sender}: ${message.content || `[${message.content_type || 'media'}]`}`
		}).join('\n')
		if (text) await navigator.clipboard.writeText(text)
		setContextMenu(null)
	}, [currentUserName, messages, selectedName])

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase()
		if (filter === 'pending' || filter === 'blocked') return []
		return conversations.filter((item) => {
			const matchesFilter = filter === 'all' || (filter === 'unread' ? item.unread > 0 : item.workflow === filter)
			const matchesQuery = !needle || `${item.name} ${item.phone} ${item.preview}`.toLowerCase().includes(needle)
			return matchesFilter && matchesQuery
		})
	}, [conversations, filter, query])

	const filterCounts = useMemo(() => ({
		all: conversations.length,
		ai: conversations.filter((item) => item.workflow === 'ai').length,
		handover: conversations.filter((item) => item.workflow === 'handover').length,
		human: conversations.filter((item) => item.workflow === 'human').length,
		unread: conversations.filter((item) => item.unread > 0).length,
		pending: pendingLeads.length,
		blocked: blockedLeads.length,
	}), [blockedLeads.length, conversations, pendingLeads.length])
	const leadQueue = useMemo(() => {
		const source = filter === 'pending' ? pendingLeads : filter === 'blocked' ? blockedLeads : []
		const needle = query.trim().toLowerCase()
		return needle ? source.filter((lead) => `${lead.name} ${lead.phone} ${lead.preview}`.toLowerCase().includes(needle)) : source
	}, [blockedLeads, filter, pendingLeads, query])

	const active = conversations.find((item) => item.id === selectedId) || null
	const visibleMessages = messages.filter((message) => message.content_type !== 'reaction')
	const singleSelectedMessage = selectedMessageIds.size === 1
		? messages.find((message) => selectedMessageIds.has(message.id)) || null
		: null
	const reactionsByTarget = messages.reduce<Record<string, string[]>>((result, message) => {
		if (message.content_type === 'reaction' && message.reply_to_message_id && message.content) {
			result[message.reply_to_message_id] = [...(result[message.reply_to_message_id] || []), message.content]
		}
		return result
	}, {})
	const filters = [
		['all', 'Semua percakapan'],
		['pending', 'Perlu keputusan'],
		['blocked', 'Nomor diblokir'],
		['ai', 'Ditangani AI'],
		['handover', 'Menunggu handover'],
		['human', 'Ditangani sales'],
		['unread', 'Belum dibaca'],
	] as const

	return (
		<div className="relative flex h-full min-h-0 w-full overflow-hidden bg-background text-foreground">
			<aside
				className={cn(
					'relative flex w-full shrink-0 flex-col bg-background md:w-[370px] md:border-r md:border-border lg:w-[410px]',
					active && 'hidden md:flex',
				)}
			>
				<header className="border-b border-border px-3 py-2.5 md:px-4">
					<div className="flex items-center gap-2">
						<Popover open={menuOpen} onOpenChange={setMenuOpen}>
							<PopoverTrigger
								className="relative grid size-9 shrink-0 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								aria-label="Buka navigasi dan filter percakapan"
							>
								<Menu className="size-5" />
								{pendingLeads.length > 0 ? (
									<span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white">
										{Math.min(pendingLeads.length, 99)}
									</span>
								) : filter !== 'all' ? <span className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-primary" /> : null}
							</PopoverTrigger>
							<PopoverContent align="start" sideOffset={8} className="w-[min(18rem,calc(100vw-2rem))] gap-1 p-1.5">
								<button
									onClick={() => {
										setMenuOpen(false)
										void navigate({ to: '/dashboard' })
									}}
									className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								>
									<LayoutDashboard className="size-4 text-muted-foreground" />
									Kembali ke dashboard
								</button>
								<div className="my-1 h-px bg-border" />
								<p className="px-3 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Tampilkan</p>
								{filters.map(([id, label]) => (
									<button
										key={id}
									onClick={() => {
										setFilter(id)
										if (id === 'pending' || id === 'blocked') setSelectedId(null)
											setMenuOpen(false)
										}}
										className={cn(
											'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
											filter === id && 'bg-muted font-medium text-foreground',
										)}
									>
										<span className="min-w-0 flex-1 truncate">{label}</span>
										<span className="text-xs tabular-nums text-muted-foreground">{filterCounts[id]}</span>
										<Check className={cn('size-4 text-primary', filter === id ? 'opacity-100' : 'opacity-0')} />
									</button>
								))}
							</PopoverContent>
						</Popover>
						<label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted px-3 md:max-w-[280px] focus-within:ring-2 focus-within:ring-ring">
							<Search className="size-4 text-muted-foreground" />
							<input
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
								placeholder="Cari percakapan"
							/>
						</label>
						<button
							onClick={() => void repairAndRefresh()}
							disabled={repairing}
							className="grid size-9 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
							aria-label="Perbaiki antrean dan muat ulang"
						>
							<RefreshCw className={cn('size-4', repairing && 'animate-spin')} />
						</button>
					</div>
				</header>

				<div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
					{loading ? (
						<ListSkeleton />
					) : error ? (
						<State icon={AlertCircle} title="Kotak masuk belum dapat dibuka" body={error} />
					) : filter === 'pending' || filter === 'blocked' ? (
						<div className="divide-y divide-border/70">
							{leadActionError && <p className="px-4 py-3 text-sm text-destructive" role="alert">{leadActionError}</p>}
							{leadQueue.length ? leadQueue.map((lead) => (
								<LeadDecisionRow
									key={lead.id}
									lead={lead}
									busy={leadActionId === lead.id}
									onConfirm={() => void updateLeadStatus(lead, 'confirm')}
									onReject={() => void updateLeadStatus(lead, 'reject')}
									onUnblock={() => void updateLeadStatus(lead, 'unblock')}
								/>
							)) : (
								<State
									icon={filter === 'pending' ? UserCheck : Ban}
									title={query ? 'Tidak ada hasil' : filter === 'pending' ? 'Tidak ada keputusan tertunda' : 'Tidak ada nomor diblokir'}
									body={query ? 'Coba cari dengan nama atau nomor lain.' : filter === 'pending' ? 'Nomor yang belum kamu simpan akan menunggu di sini tanpa dibalas AI.' : 'Nomor yang kamu tolak tetap tersimpan untuk audit dan bisa dibuka lagi.'}
								/>
							)}
						</div>
					) : filtered.length === 0 ? (
						query ? (
							<State icon={Search} title="Tidak ada hasil" body="Coba cari dengan nama atau nomor lain." />
						) : connected ? (
							<State icon={Inbox} title="Belum ada percakapan" body="Belum ada nomor tersimpan. Gunakan tombol +, atau buka Perlu keputusan saat nomor baru menghubungi kamu." />
						) : (
							<WhatsappOnboarding />
						)
					) : (
						filtered.map((item) => (
							<button
								key={item.id}
								onClick={() => setSelectedId(item.id)}
								className={cn(
									'group flex w-full gap-2.5 px-4 py-2.5 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
									selectedId === item.id && 'bg-muted hover:bg-muted',
								)}
							>
								<Avatar conversation={item} />
								<div className="min-w-0 flex-1 border-b border-border/70 pb-2.5 group-last:border-0">
									<div className="flex items-baseline justify-between gap-3">
										<p className="truncate text-sm font-semibold text-foreground">{item.name}</p>
										<time className="shrink-0 text-xs text-muted-foreground">{formatListTime(item.lastMessageAt)}</time>
									</div>
									<div className="mt-1 flex items-center gap-2">
										<p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{item.preview}</p>
										{item.unread > 0 && (
											<span className="grid min-w-5 place-items-center rounded-full bg-primary px-1.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
												{item.unread}
											</span>
										)}
									</div>
									<div className="mt-1 flex items-center justify-between gap-2">
										<p className="min-w-0 truncate text-xs text-muted-foreground/80">{item.phone}</p>
										<WorkflowBadge workflow={item.workflow} />
									</div>
								</div>
							</button>
						))
					)}
				</div>
				<button
					onClick={() => setNewChatOpen(true)}
					className="absolute bottom-4 right-4 grid size-12 place-items-center rounded-full bg-primary text-primary-foreground shadow-[0_4px_8px_rgb(15_23_42/0.2)] transition-transform hover:scale-[1.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 motion-reduce:transform-none"
					aria-label="Mulai percakapan baru"
				>
					<Plus className="size-5" />
				</button>
			</aside>

			<main
				className={cn('relative min-w-0 flex-1 flex-col bg-muted/30', active ? 'flex' : 'hidden md:flex')}
				onDragEnter={(event) => {
					if (!active || !connected) return
					event.preventDefault()
					dragDepthRef.current += 1
					setDragActive(true)
				}}
				onDragOver={(event) => {
					if (!active || !connected) return
					event.preventDefault()
					event.dataTransfer.dropEffect = 'copy'
				}}
				onDragLeave={(event) => {
					if (!active || !connected) return
					event.preventDefault()
					dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
					if (dragDepthRef.current === 0) setDragActive(false)
				}}
				onDrop={(event) => {
					event.preventDefault()
					dragDepthRef.current = 0
					setDragActive(false)
					if (!active || !connected || uploadingMedia || sendingMessage) return
					const files = Array.from(event.dataTransfer.files || [])
					if (files.length) addDraftFiles(files, 'attachment')
				}}
			>
				{active ? (
					<>
						<header className="flex h-[64px] shrink-0 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
							{selectedMessageIds.size ? (
								<>
									<button onClick={() => setSelectedMessageIds(new Set())} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Batalkan pilihan"><X className="size-5" /></button>
									<p className="min-w-0 flex-1 text-sm font-semibold">{selectedMessageIds.size} dipilih</p>
									{singleSelectedMessage?.content_type !== 'revoked' && singleSelectedMessage && (
										<button onClick={() => { setReplyTarget(singleSelectedMessage); setSelectedMessageIds(new Set()) }} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Balas pesan terpilih"><Reply className="size-4" /></button>
									)}
									<button onClick={() => setSelectedMessageIds(new Set(visibleMessages.map((message) => message.id)))} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Pilih semua pesan"><CheckSquare className="size-4" /></button>
									<button onClick={() => void copyMessages(selectedMessageIds)} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted" aria-label="Salin pesan terpilih"><Copy className="size-4" /></button>
									<button onClick={() => setBulkDeleteIds([...selectedMessageIds])} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Hapus pesan terpilih"><Trash2 className="size-4" /></button>
								</>
							) : (
								<>
									<button
										onClick={() => setSelectedId(null)}
										className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
										aria-label="Kembali ke daftar percakapan"
									>
										<ArrowLeft className="size-5" />
									</button>
									<button type="button" onClick={() => setProfileOpen(true)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Lihat profil ${active.name}`}>
										<Avatar conversation={active} size="sm" />
										<div className="min-w-0 flex-1">
											<h2 className="truncate text-sm font-semibold text-foreground">{active.name}</h2>
											<p className={cn('truncate text-xs', contactPresence === 'composing' || contactPresence === 'recording' ? 'font-medium text-primary' : 'text-muted-foreground')}>
												{contactPresence === 'composing' ? 'sedang mengetik…' : contactPresence === 'recording' ? 'sedang merekam audio…' : active.phone}
											</p>
										</div>
										<Info className="mr-1 size-4 shrink-0 text-muted-foreground" />
									</button>
								</>
							)}
						</header>

						<div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-3 py-4 md:px-6">
							<div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-1.5">
								{messages.length === 0 ? (
									<State icon={MessageCircle} title="Belum ada pesan tersimpan" body="Pesan pertama dari kontak ini akan muncul otomatis." />
								) : (
									visibleMessages.map((message) => (
									<MessageBubble
											key={message.id}
											message={message}
											selected={selectedMessageIds.has(message.id)}
											selectionMode={selectedMessageIds.size > 0}
										reactions={reactionsByTarget[message.id] || []}
										quotedMessage={messages.find((candidate) => candidate.id === message.reply_to_message_id) || null}
											onSelect={() => toggleMessageSelection(message.id)}
											onContextMenu={(x, y) => setContextMenu({ x, y, message })}
										/>
									))
								)}
							</div>
						</div>

						<footer className="shrink-0 border-t border-border bg-background px-3 py-3 md:px-6">
							<form
								onSubmit={(event) => {
									event.preventDefault()
									void sendDraftMessage()
								}}
								className="mx-auto max-w-3xl"
							>
								<input
									ref={fileInputRef}
									type="file"
									multiple
									className="sr-only"
									onChange={(event) => {
										const files = Array.from(event.target.files || [])
										if (files.length) addDraftFiles(files, mediaPurposeRef.current)
										event.currentTarget.value = ''
									}}
								/>
								{pendingAttachments.length > 0 && (
									<div className="scrollbar-hidden mb-2 flex gap-2 overflow-x-auto overscroll-x-contain pb-1">
										{pendingAttachments.map((attachment) => <AttachmentDraft key={attachment.id} attachment={attachment} onRemove={() => removeDraftAttachment(attachment.id)} />)}
										<button type="button" onClick={() => pickMedia('attachment', 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip')} className="grid size-20 shrink-0 place-items-center rounded-xl border border-dashed border-input text-muted-foreground hover:border-primary hover:text-primary" aria-label="Tambah lampiran lain"><Plus className="size-5" /></button>
									</div>
								)}
								{replyTarget && (
									<div className="mb-2 flex items-center gap-3 rounded-lg bg-accent px-3 py-2">
										<div className="min-w-0 flex-1">
											<p className="text-xs font-semibold text-primary">{replyTarget.message_type === 'outgoing' || replyTarget.sender_type === 'user' ? 'Kamu' : active.name}</p>
											<p className="truncate text-xs text-muted-foreground">{replyTarget.content || `[${replyTarget.content_type || 'media'}]`}</p>
										</div>
										<button type="button" onClick={() => setReplyTarget(null)} className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground" aria-label="Batalkan balasan"><X className="size-4" /></button>
									</div>
								)}
								<div className="flex items-end gap-2">
									<Popover>
										<PopoverTrigger
											disabled={!connected || uploadingMedia || sendingMessage}
											className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
											aria-label="Lampirkan media"
										>
											<Paperclip className={cn('size-4', uploadingMedia && 'animate-pulse')} />
										</PopoverTrigger>
										<PopoverContent align="start" side="top" className="w-56 p-1.5">
											<MediaOption icon={ImageIcon} label="Foto atau gambar" onClick={() => pickMedia('attachment', 'image/*')} />
											<MediaOption icon={Video} label="Video" onClick={() => pickMedia('attachment', 'video/*')} />
											<MediaOption icon={FileText} label="Dokumen" onClick={() => pickMedia('attachment', '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip')} />
											<MediaOption icon={Sticker} label="Buat sticker" onClick={() => pickMedia('sticker', 'image/*')} />
											<MediaOption icon={Video} label="Kirim sebagai GIF" onClick={() => pickMedia('gif', 'image/gif,video/*')} />
										</PopoverContent>
									</Popover>
									<Popover>
										<PopoverTrigger className="grid size-11 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Pilih emoji">
											<Smile className="size-4" />
										</PopoverTrigger>
										<PopoverContent align="start" side="top" className="w-64 p-2">
											<div className="grid grid-cols-8 gap-1">
												{['😀','😂','🥰','😍','😊','🙏','👍','👏','🎉','❤️','🔥','✨','😅','😭','🤔','👌','💪','🙌','📌','✅','❌','👀','💯','🤝'].map((emoji) => (
													<button key={emoji} type="button" onClick={() => setDraft((current) => `${current}${emoji}`)} className="grid size-7 place-items-center rounded-md text-lg hover:bg-muted">{emoji}</button>
												))}
											</div>
										</PopoverContent>
									</Popover>
									<textarea
										value={draft}
										onChange={(event) => {
											setDraft(event.target.value)
											if (composerError) setComposerError(null)
										}}
										onKeyDown={(event) => {
											if (event.key === 'Enter' && !event.shiftKey) {
												event.preventDefault()
														void sendDraftMessage()
											}
										}}
										rows={1}
										maxLength={4096}
										placeholder={connected ? pendingAttachments.length ? 'Tambahkan keterangan…' : 'Tulis pesan…' : 'WhatsApp sedang tidak terhubung'}
										disabled={!connected || sendingMessage || uploadingMedia || voiceRecording}
										className="max-h-32 min-h-11 min-w-0 flex-1 resize-none rounded-xl bg-muted px-4 py-3 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
									/>
									<button
										type={draft.trim() || pendingAttachments.length ? 'submit' : 'button'}
										onClick={draft.trim() || pendingAttachments.length ? undefined : () => void toggleVoiceNote()}
										disabled={!connected || sendingMessage || uploadingMedia}
										className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100 motion-reduce:transform-none"
										aria-label={draft.trim() || pendingAttachments.length ? 'Kirim pesan' : voiceRecording ? 'Selesai merekam voice note' : 'Rekam voice note'}
									>
										{draft.trim() || pendingAttachments.length ? <SendHorizontal className={cn('size-4', sendingMessage && 'animate-pulse')} /> : voiceRecording ? <Square className="size-3.5 fill-current" /> : <Mic className="size-4" />}
									</button>
								</div>
								{voiceRecording && <p className="mt-2 text-xs font-medium text-destructive">Merekam voice note… tekan tombol merah untuk mengirim.</p>}
								{uploadingMedia && <p className="mt-2 text-xs text-muted-foreground">Menyiapkan dan mengunggah media…</p>}
								{composerError && <p className="mt-2 text-xs leading-5 text-destructive" role="alert">{composerError}</p>}
							</form>
						</footer>
					</>
				) : (
					<State icon={MessageCircle} title="Buka sebuah percakapan" body="Pilih pelanggan di sebelah kiri untuk membaca riwayat pesannya." />
				)}
				{dragActive && (
					<div className="pointer-events-none absolute inset-3 z-40 grid place-items-center rounded-2xl border-2 border-dashed border-primary bg-background/90 p-6 text-center shadow-lg backdrop-blur-sm">
						<div>
							<div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10 text-primary"><Paperclip className="size-5" /></div>
							<p className="mt-3 text-sm font-semibold">Lepaskan file untuk mengirim</p>
							<p className="mt-1 text-xs text-muted-foreground">Foto, video, audio, atau dokumen hingga 25 MB.</p>
						</div>
					</div>
				)}
			</main>

			{active && profileOpen && (
				<ContactProfilePanel
					conversation={active}
					onClose={() => setProfileOpen(false)}
					onCopyPhone={() => void navigator.clipboard.writeText(active.phone)}
				/>
			)}

			{contextMenu && (
				<div
					className="fixed z-50 w-48 rounded-lg border border-border bg-popover p-1.5 text-popover-foreground shadow-md"
					style={{ left: Math.min(contextMenu.x, window.innerWidth - 208), top: Math.min(contextMenu.y, window.innerHeight - 170) }}
					onClick={(event) => event.stopPropagation()}
					role="menu"
				>
					{contextMenu.message.content_type !== 'revoked' && <ContextAction icon={Reply} label="Balas pesan" onClick={() => {
						setReplyTarget(contextMenu.message)
						setContextMenu(null)
					}} />}
					<ContextAction icon={Copy} label="Salin pesan" onClick={() => void copyMessages([contextMenu.message.id])} />
					<ContextAction icon={CheckSquare} label="Pilih pesan" onClick={() => {
						setSelectedMessageIds(new Set([contextMenu.message.id]))
						setContextMenu(null)
					}} />
					<div className="my-1 h-px bg-border" />
					<ContextAction icon={Trash2} label="Hapus dari CRM" destructive onClick={() => {
						setDeleteTarget(contextMenu.message)
						setContextMenu(null)
					}} />
				</div>
			)}

			<Dialog open={newChatOpen} onOpenChange={(open) => {
				if (recording || transcribing || creatingChat) return
				setNewChatOpen(open)
				if (!open) setNewChatError(null)
			}}>
				<DialogContent className="max-w-md gap-4 p-5 sm:max-w-md">
					<DialogHeader className="pr-8">
						<DialogTitle className="text-lg">Mulai percakapan</DialogTitle>
						<DialogDescription>Ketik nomor WhatsApp atau ucapkan digitnya. Kamu tetap bisa mengecek hasilnya sebelum membuka chat.</DialogDescription>
					</DialogHeader>
					<div className="space-y-3">
						<label className="block space-y-1.5">
							<span className="text-sm font-medium text-foreground">Nama kontak <span className="font-normal text-muted-foreground">(opsional)</span></span>
							<input
								value={newContactName}
								onChange={(event) => setNewContactName(event.target.value)}
								placeholder="Misalnya, Budi"
								className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
							/>
						</label>
						<label className="block space-y-1.5">
							<span className="text-sm font-medium text-foreground">Nomor WhatsApp</span>
							<div className="flex gap-2">
								<input
									value={newPhoneNumber}
									onChange={(event) => setNewPhoneNumber(event.target.value)}
									inputMode="tel"
									placeholder="0812 3456 7890"
									className="h-11 min-w-0 flex-1 rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
								/>
								<button
									type="button"
									onClick={() => void toggleRecording()}
									disabled={transcribing}
									className={cn(
										'grid size-11 shrink-0 place-items-center rounded-lg border border-input text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60',
										recording ? 'border-destructive bg-destructive text-destructive-foreground' : 'hover:bg-muted hover:text-foreground',
									)}
									aria-label={recording ? 'Selesai merekam' : 'Ucapkan nomor WhatsApp'}
								>
									{recording ? <Square className="size-4 fill-current" /> : <Mic className={cn('size-4', transcribing && 'animate-pulse')} />}
								</button>
							</div>
						</label>
						<div className="min-h-10 rounded-lg bg-muted px-3 py-2.5 text-xs leading-5 text-muted-foreground" aria-live="polite">
							{recording ? 'Sedang mendengarkan… ucapkan nomor digit demi digit.' : transcribing ? 'Deepgram sedang menuliskan nomornya…' : voiceTranscript ? `Terdengar: “${voiceTranscript}”` : 'Tip: ucapkan “nol delapan satu dua…” dengan jeda yang natural.'}
						</div>
						{newChatError && <p className="text-sm leading-5 text-destructive" role="alert">{newChatError}</p>}
						<button
							type="button"
							onClick={() => void createConversation()}
							disabled={!newPhoneNumber.trim() || recording || transcribing || creatingChat}
							className="flex h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{creatingChat ? 'Membuka percakapan…' : 'Buka percakapan'}
						</button>
					</div>
				</DialogContent>
			</Dialog>

			<AlertDialog open={Boolean(deleteTarget) || bulkDeleteIds.length > 0} onOpenChange={(open) => {
				if (!open && !deletingMessage) {
					setDeleteTarget(null)
					setBulkDeleteIds([])
				}
			}}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{bulkDeleteIds.length > 1 ? `Hapus ${bulkDeleteIds.length} pesan dari chat?` : 'Hapus pesan dari chat?'}</AlertDialogTitle>
						<AlertDialogDescription>Pesan tidak akan hilang permanen. Salinannya tetap tersimpan di trash untuk audit teknis, tetapi tidak lagi terlihat di percakapan ini.</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={deletingMessage}>Batal</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => void deleteMessage()}
							disabled={deletingMessage}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{deletingMessage ? 'Menghapus…' : 'Hapus pesan'}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	)
}

function Avatar({ conversation, size = 'md' }: { conversation: Conversation; size?: 'sm' | 'md' }) {
	const sizeClass = size === 'sm' ? 'size-10' : 'size-11'
	if (conversation.avatarUrl) {
		return <img src={conversation.avatarUrl} alt="" className={cn(sizeClass, 'shrink-0 rounded-full object-cover')} />
	}
	return (
		<div className={cn(sizeClass, 'grid shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold text-muted-foreground')}>
			{conversation.name.slice(0, 1).toUpperCase()}
		</div>
	)
}

function WorkflowBadge({ workflow }: { workflow: Conversation['workflow'] }) {
	const label = workflow === 'ai' ? 'AI' : workflow === 'handover' ? 'Handover' : 'Sales'
	return (
		<span className={cn(
			'shrink-0 rounded-md px-1.5 py-0.5 text-[11px] font-medium',
			workflow === 'ai' && 'bg-violet-500/10 text-violet-700 dark:text-violet-300',
			workflow === 'handover' && 'bg-amber-500/15 text-amber-800 dark:text-amber-300',
			workflow === 'human' && 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
		)}>
			{label}
		</span>
	)
}

function LeadDecisionRow({
	lead,
	busy,
	onConfirm,
	onReject,
	onUnblock,
}: {
	lead: LeadRegistration
	busy: boolean
	onConfirm: () => void
	onReject: () => void
	onUnblock: () => void
}) {
	const pending = lead.status === 'pending'
	return (
		<article className="px-4 py-3">
			<div className="flex items-start gap-3">
				<div className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-sm font-semibold text-muted-foreground">
					{lead.avatarUrl ? <img src={lead.avatarUrl} alt="" className="size-full object-cover" /> : lead.name.slice(0, 1).toUpperCase()}
				</div>
				<div className="min-w-0 flex-1">
					<div className="flex items-baseline justify-between gap-3">
						<h3 className="truncate text-sm font-semibold text-foreground">{lead.name}</h3>
						<time className="shrink-0 text-xs text-muted-foreground">{formatListTime(lead.lastMessageAt)}</time>
					</div>
					<p className="mt-0.5 truncate text-xs text-muted-foreground">{lead.phone}</p>
					<p className="mt-1.5 line-clamp-2 text-sm leading-5 text-muted-foreground">{lead.preview}</p>
				</div>
			</div>
			<div className="mt-3 flex items-center justify-end gap-2 pl-[52px]">
				{pending ? (
					<>
						<button type="button" onClick={onReject} disabled={busy} className="h-9 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
							Tolak
						</button>
						<button type="button" onClick={onConfirm} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
							<UserCheck className="size-4" />
							{busy ? 'Menyimpan…' : 'Terima lead'}
						</button>
					</>
				) : (
					<button type="button" onClick={onUnblock} disabled={busy} className="flex h-9 items-center gap-2 rounded-lg border border-input px-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
						<Undo2 className="size-4" />
						{busy ? 'Membuka…' : 'Buka blokir'}
					</button>
				)}
			</div>
		</article>
	)
}

function MessageBubble({
	message,
	quotedMessage,
	selected,
	selectionMode,
	reactions,
	onSelect,
	onContextMenu,
}: {
	message: ChatMessage
	quotedMessage: ChatMessage | null
	selected: boolean
	selectionMode: boolean
	reactions: string[]
	onSelect: () => void
	onContextMenu: (x: number, y: number) => void
}) {
	const outbound = message.message_type === 'outgoing' || message.sender_type === 'user'
	const longPressRef = useRef<number | null>(null)
	const longPressOriginRef = useRef<{ x: number; y: number } | null>(null)
	const longPressTriggeredRef = useRef(false)
	const startLongPress = (x: number, y: number) => {
		longPressOriginRef.current = { x, y }
		longPressTriggeredRef.current = false
		longPressRef.current = window.setTimeout(() => {
			longPressTriggeredRef.current = true
			onSelect()
		}, 520)
	}
	const cancelLongPress = () => {
		if (longPressRef.current) window.clearTimeout(longPressRef.current)
		longPressRef.current = null
		longPressOriginRef.current = null
	}
	return (
		<div
			className={cn('group/message flex cursor-default items-center gap-2 rounded-lg px-1 py-0.5', outbound ? 'justify-end' : 'justify-start', selected && 'bg-primary/10')}
			onContextMenu={(event) => {
				event.preventDefault()
				onContextMenu(event.clientX, event.clientY)
			}}
			onPointerDown={(event) => { if (event.pointerType === 'touch' && !selectionMode) startLongPress(event.clientX, event.clientY) }}
			onPointerUp={cancelLongPress}
			onPointerCancel={cancelLongPress}
			onPointerMove={(event) => {
				const origin = longPressOriginRef.current
				if (origin && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) > 12) cancelLongPress()
			}}
			onClick={() => {
				if (longPressTriggeredRef.current) {
					longPressTriggeredRef.current = false
					return
				}
				if (selectionMode) onSelect()
			}}
		>
			{selectionMode && !outbound && <SelectionMark selected={selected} />}
			<div
				className={cn(
					'max-w-[84%] overflow-hidden rounded-xl px-3.5 py-2 text-sm leading-relaxed md:max-w-[72%]',
					outbound
						? 'rounded-br-sm bg-primary text-primary-foreground'
						: 'rounded-bl-sm bg-card text-card-foreground shadow-[0_1px_3px_rgb(15_23_42/0.12)] dark:shadow-[0_1px_3px_rgb(0_0_0/0.45)]',
				)}
			>
				{message.reply_to_message_id && (
					<div className={cn('mb-2 rounded-md px-2.5 py-1.5', outbound ? 'bg-black/10' : 'bg-muted')}>
						<p className={cn('text-[11px] font-semibold', outbound ? 'text-primary-foreground/90' : 'text-primary')}>
							{(quotedMessage?.message_type === 'outgoing' || quotedMessage?.sender_type === 'user' || message.content_attributes?.quote?.sender_type === 'user') ? 'Kamu' : 'Kontak'}
						</p>
						<p className={cn('max-w-72 truncate text-xs', outbound ? 'text-primary-foreground/70' : 'text-muted-foreground')}>
							{quotedMessage?.content || message.content_attributes?.quote?.content || `[${quotedMessage?.content_type || message.content_attributes?.quote?.content_type || 'pesan tidak tersedia'}]`}
						</p>
					</div>
				)}
				<MessageContent message={message} />
				<div className={cn('mt-1 flex items-center justify-end gap-1 text-[11px]', outbound ? 'text-primary-foreground/75' : 'text-muted-foreground')}>
					<span>{formatTime(message.created_at)}</span>
					{outbound && (message.status === 'delivered' || message.status === 'read' || message.status === 'played'
						? <CheckCheck className={cn('size-3.5', (message.status === 'read' || message.status === 'played') && 'text-sky-300')} />
						: <Check className="size-3.5" />)}
				</div>
				{reactions.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{reactions.map((reaction, index) => <span key={`${reaction}-${index}`} className="rounded-full bg-background/80 px-1.5 py-0.5 text-xs text-foreground shadow-sm">{reaction}</span>)}</div>}
			</div>
			{selectionMode && outbound && <SelectionMark selected={selected} />}
		</div>
	)
}

function SelectionMark({ selected }: { selected: boolean }) {
	return <span className={cn('grid size-5 shrink-0 place-items-center rounded-full border', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/50 bg-background')}>{selected && <Check className="size-3" />}</span>
}

function AttachmentDraft({ attachment, onRemove }: { attachment: PendingAttachment; onRemove: () => void }) {
	const visual = attachment.file.type.startsWith('image/') || attachment.file.type.startsWith('video/')
	return (
		<div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-muted">
			{attachment.previewUrl && attachment.file.type.startsWith('image/') && <img src={attachment.previewUrl} alt={attachment.file.name} className="size-full object-cover" />}
			{attachment.previewUrl && attachment.file.type.startsWith('video/') && <video src={attachment.previewUrl} muted className="size-full object-cover" />}
			{!visual && (
				<div className="flex size-full flex-col items-center justify-center gap-1 px-2 text-center text-muted-foreground">
					<FileText className="size-5" />
					<span className="w-full truncate text-[10px]">{attachment.file.name}</span>
				</div>
			)}
			<button type="button" onClick={onRemove} className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-background/90 text-foreground shadow-sm hover:bg-background" aria-label={`Hapus ${attachment.file.name} dari draft`}><X className="size-3.5" /></button>
		</div>
	)
}

function contactSourceLabel(source: string | null) {
	if (!source) return 'Pesan masuk WhatsApp'
	if (source === 'manual_whatsapp') return 'Ditambahkan oleh sales'
	if (source === 'baileys' || source.includes('sync') || source.includes('history')) return 'Sinkronisasi WhatsApp'
	if (source.includes('inbound') || source.includes('whatsapp')) return 'Pesan masuk WhatsApp'
	return source.replaceAll('_', ' ')
}

function ContactProfilePanel({ conversation, onClose, onCopyPhone }: { conversation: Conversation; onClose: () => void; onCopyPhone: () => void }) {
	const [copied, setCopied] = useState(false)
	const [photoOpen, setPhotoOpen] = useState(false)
	const copyPhone = () => {
		onCopyPhone()
		setCopied(true)
		window.setTimeout(() => setCopied(false), 1_600)
	}
	return (
		<aside className="absolute inset-0 z-30 flex min-h-0 w-full shrink-0 flex-col border-l border-border bg-background md:static md:z-auto md:w-[340px] lg:w-[380px]">
			<header className="flex h-[64px] shrink-0 items-center gap-3 border-b border-border px-4">
				<button type="button" onClick={onClose} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Tutup profil kontak"><X className="size-5" /></button>
				<h2 className="text-sm font-semibold">Info kontak</h2>
			</header>
			<div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain">
				<div className="flex flex-col items-center px-6 pb-7 pt-8 text-center">
					{conversation.avatarUrl ? (
						<button type="button" onClick={() => setPhotoOpen(true)} className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4" aria-label="Perbesar foto profil">
							<img src={conversation.avatarUrl} alt={`Foto profil ${conversation.name}`} className="size-36 rounded-full object-cover shadow-[0_2px_8px_rgb(15_23_42/0.18)]" />
						</button>
					) : (
						<div className="grid size-36 place-items-center rounded-full bg-muted text-4xl font-semibold text-muted-foreground">{conversation.name.slice(0, 1).toUpperCase()}</div>
					)}
					<h3 className="mt-5 max-w-full truncate text-xl font-semibold">{conversation.name}</h3>
					<p className="mt-1 text-sm text-muted-foreground">+{conversation.phone}</p>
				</div>
				<div className="border-y border-border">
					<div className="flex items-center gap-3 px-5 py-4">
						<Phone className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0 flex-1">
							<p className="text-xs text-muted-foreground">Nomor WhatsApp</p>
							<p className="mt-0.5 truncate text-sm font-medium">+{conversation.phone}</p>
						</div>
						<button type="button" onClick={copyPhone} className="flex h-9 items-center gap-2 rounded-lg px-2.5 text-xs font-medium text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Salin nomor WhatsApp">{copied ? <Check className="size-4" /> : <Copy className="size-4" />}{copied ? 'Tersalin' : 'Salin'}</button>
					</div>
					<div className="flex items-center gap-3 border-t border-border px-5 py-4">
						<UserRound className="size-4 shrink-0 text-muted-foreground" />
						<div className="min-w-0">
							<p className="text-xs text-muted-foreground">Sumber kontak</p>
							<p className="mt-0.5 truncate text-sm font-medium capitalize">{contactSourceLabel(conversation.source)}</p>
						</div>
					</div>
				</div>
			</div>
			{photoOpen && conversation.avatarUrl && (
				<div className="fixed inset-0 z-50 grid place-items-center bg-black/85 p-4" role="dialog" aria-modal="true" aria-label={`Foto profil ${conversation.name}`}>
					<button type="button" onClick={() => setPhotoOpen(false)} className="absolute right-4 top-4 grid size-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white" aria-label="Tutup foto profil"><X className="size-5" /></button>
					<img src={conversation.avatarUrl} alt={`Foto profil besar ${conversation.name}`} className="max-h-[85vh] max-w-[min(90vw,48rem)] object-contain" />
				</div>
			)}
		</aside>
	)
}

function MessageContent({ message }: { message: ChatMessage }) {
	const media = message.content_attributes?.media
	const url = media?.url
	const type = message.content_type || 'text'
	const [downloading, setDownloading] = useState(false)
	const [downloadError, setDownloadError] = useState<string | null>(null)
	const downloadDocument = async () => {
		if (downloading) return
		setDownloading(true)
		setDownloadError(null)
		try {
			const response = await fetch(`${API_BASE}/media/messages/${message.id}/download`, { headers: authHeaders() })
			if (!response.ok) {
				const payload = (await readApiResponse(response)) as { error?: string }
				throw new Error(payload.error || 'File belum dapat diunduh')
			}
			const blob = await response.blob()
			const objectUrl = URL.createObjectURL(blob)
			const anchor = document.createElement('a')
			anchor.href = objectUrl
			anchor.download = media?.file_name || media?.filename || 'dokumen'
			document.body.appendChild(anchor)
			anchor.click()
			anchor.remove()
			window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1_000)
		} catch (reason) {
			setDownloadError(reason instanceof Error ? reason.message : 'File belum dapat diunduh')
		} finally {
			setDownloading(false)
		}
	}
	if (type === 'revoked') return <p className="italic opacity-75">Pesan ini telah dihapus di WhatsApp</p>
	return (
		<div className="space-y-1.5">
			{url && (type === 'image' || type === 'sticker') && (
				<img src={url} alt={type === 'sticker' ? 'Sticker' : message.content || 'Gambar WhatsApp'} className={cn('block max-h-72 w-auto max-w-full object-contain', type === 'sticker' ? 'max-h-40 bg-transparent' : 'rounded-lg')} />
			)}
			{url && (type === 'video' || type === 'gif') && (
				<video src={url} controls={type !== 'gif'} autoPlay={type === 'gif'} loop={type === 'gif'} muted={type === 'gif'} playsInline className="max-h-72 max-w-full rounded-lg" />
			)}
			{url && (type === 'audio' || type === 'voice') && <audio src={url} controls preload="metadata" className="h-10 max-w-full" />}
			{url && (type === 'document' || type === 'file') && (
				<div>
					<button type="button" onClick={() => void downloadDocument()} disabled={downloading} className="flex w-full items-center gap-3 rounded-lg bg-background/15 px-3 py-2.5 text-left transition-colors hover:bg-background/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-70">
						<FileText className="size-5 shrink-0" />
						<span className="min-w-0 flex-1">
							<span className="block truncate font-medium">{media.file_name || media.filename || 'Dokumen'}</span>
							<span className="block text-[11px] opacity-70">{downloading ? 'Mengunduh file…' : 'Unduh untuk membuka'}</span>
						</span>
						{downloading ? <RefreshCw className="size-4 shrink-0 animate-spin" /> : <Download className="size-4 shrink-0" />}
					</button>
					{downloadError && <p className="mt-1.5 text-xs text-destructive" role="alert">{downloadError}</p>}
				</div>
			)}
			{message.content && !(/^\[(IMAGE|VIDEO|AUDIO|DOCUMENT|STICKER)\]$/i.test(message.content)) && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
			{!message.content && !url && <p>[{type}]</p>}
		</div>
	)
}

function MediaOption({ icon: Icon, label, onClick }: { icon: typeof Paperclip; label: string; onClick: () => void }) {
	return <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm hover:bg-muted"><Icon className="size-4 text-muted-foreground" />{label}</button>
}

function ContextAction({ icon: Icon, label, onClick, destructive = false }: { icon: typeof Copy; label: string; onClick: () => void; destructive?: boolean }) {
	return <button type="button" role="menuitem" onClick={onClick} className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted', destructive && 'text-destructive')}><Icon className="size-4" />{label}</button>
}

function State({ icon: Icon, title, body }: { icon: typeof Inbox; title: string; body: string }) {
	return (
		<div className="m-auto flex max-w-sm flex-col items-center px-8 py-16 text-center">
			<div className="grid size-11 place-items-center rounded-xl bg-muted text-muted-foreground">
				<Icon className="size-5" />
			</div>
			<h3 className="mt-4 text-sm font-semibold text-foreground">{title}</h3>
			<p className="mt-1.5 text-sm leading-6 text-muted-foreground">{body}</p>
		</div>
	)
}

const MOCK_MESSAGES = [
	{ role: 'customer', text: 'Halo, saya mau tanya produk terbaru' },
	{ role: 'ai', text: 'Halo! Terima kasih sudah menghubungi kami. Silakan, ada produk spesifik yang ingin ditanyakan?' },
	{ role: 'customer', text: 'Yang laptop seri terbaru, berapa ya harganya?' },
	{ role: 'ai', text: 'Untuk laptop seri terbaru kami mulai dari Rp 12.999.000. Ada dua varian warna: Space Grey dan Silver. Apakah Anda ingin tahu spesifikasi lengkapnya?' },
	{ role: 'customer', text: 'Ada diskon untuk pembelian pertama?' },
	{ role: 'ai', text: 'Tentu! Pembeli pertama mendapatkan diskon 10% + gratis aksesori senilai Rp 500.000. Kode promo: WELCOME10 🎉' },
	{ role: 'customer', text: 'Menarik! Saya mau pesan yang varian Space Grey' },
]

function WhatsappOnboarding() {
	const [visibleCount, setVisibleCount] = useState(0)
	const [showTyping, setShowTyping] = useState(false)
	const [hasRedirected, setHasRedirected] = useState(false)
	const navigate = useNavigate()
	const { agent } = useAppContext()
	const canConnect = agent?.role === 'ceo' || agent?.role === 'superadmin'

	useEffect(() => {
		if (visibleCount >= MOCK_MESSAGES.length || hasRedirected) return
		const msg = MOCK_MESSAGES[visibleCount]
		if (msg.role === 'ai') {
			setShowTyping(true)
			const typingTimer = setTimeout(() => {
				setShowTyping(false)
				const showTimer = setTimeout(() => setVisibleCount((c) => c + 1), 600)
				return () => clearTimeout(showTimer)
			}, 1400)
			return () => clearTimeout(typingTimer)
		}
		const timer = setTimeout(() => setVisibleCount((c) => c + 1), 800)
		return () => clearTimeout(timer)
	}, [visibleCount, hasRedirected])

	return (
		<div className="relative flex min-h-0 flex-1">
			<div className="flex flex-1 flex-col gap-3 px-4 py-4" aria-hidden>
				{MOCK_MESSAGES.slice(0, visibleCount).map((msg, i) => (
					<div key={i} className={cn('flex', msg.role === 'ai' ? 'justify-start' : 'justify-end')}>
						<div className={cn(
							'max-w-[75%] animate-in fade-in slide-in-from-bottom-2 rounded-2xl px-4 py-2.5 text-sm duration-500',
							msg.role === 'ai'
								? 'rounded-bl-sm bg-muted text-foreground'
								: 'rounded-br-sm bg-primary text-primary-foreground',
						)}>
							{msg.text}
						</div>
					</div>
				))}
				{showTyping && (
					<div className="flex justify-start">
						<div className="flex animate-in fade-in items-center gap-1.5 rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
							<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
							<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
							<span className="size-1.5 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
						</div>
					</div>
				)}
			</div>

			<div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/80 to-background/20" />
			<div className="pointer-events-none absolute inset-0 flex items-center justify-center p-6">
				<div className="pointer-events-auto w-full max-w-sm animate-in fade-in zoom-in-95 rounded-xl border bg-background/95 p-6 text-center shadow-xl backdrop-blur-sm duration-500">
					<div className="mx-auto grid size-12 place-items-center rounded-full bg-primary/10">
						<Smartphone className="size-6 text-primary" />
					</div>
					<h3 className="mt-4 text-base font-semibold text-foreground">{canConnect ? 'Hubungkan WhatsApp kamu di sini' : 'Kotak Masuk WhatsApp'}</h3>
					<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
						{canConnect
							? 'Semua pesan pelanggan akan muncul secara otomatis di kotak masuk ini. Koneksikan nomor WhatsApp bisnismu sekarang agar tim dapat merespons lebih cepat.'
							: 'Admin akan menghubungkan WhatsApp bisnis. Setelah tersambung, semua pesan pelanggan akan muncul di sini dan tim dapat langsung merespons.'}
					</p>
					{canConnect ? (
						<button
							onClick={() => {
								setHasRedirected(true)
								navigate({ to: '/whatsapp/connect' })
							}}
							className="mt-6 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-6 text-sm font-medium text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						>
							<Smartphone className="size-4" />
							Hubungkan WhatsApp
						</button>
					) : null}
				</div>
			</div>
		</div>
	)
}

function ListSkeleton() {
	return (
		<div className="space-y-px p-3">
			{Array.from({ length: 7 }).map((_, index) => (
				<div key={index} className="flex gap-3 p-3">
					<div className="size-11 animate-pulse rounded-full bg-muted" />
					<div className="flex-1 space-y-2 py-1">
						<div className="h-3 w-2/5 animate-pulse rounded bg-muted" />
						<div className="h-3 w-4/5 animate-pulse rounded bg-muted/60" />
					</div>
				</div>
			))}
		</div>
	)
}
