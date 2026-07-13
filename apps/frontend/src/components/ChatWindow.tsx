import { useState, useEffect, useRef } from 'react'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Search, MoreVertical, Send, Sparkles, Loader2 } from 'lucide-react'
import { conversations } from '../lib/api'
import { MessageItem, type MessageProps } from './MessageItem'

interface Conversation {
	id: string
	meta: {
		sender: {
			name: string
			email?: string
		}
		assignee?: {
			name: string
		}
	}
	status: 'open' | 'resolved' | 'pending'
	messaging_window_expires_at?: string
	is_within_messaging_window?: boolean
}

interface Props {
	conversation: Conversation | null
}

export default function ChatWindow({ conversation }: Props) {
	const [messages, setMessages] = useState<MessageProps[]>([])
	const [loading, setLoading] = useState(false)
	const [message, setMessage] = useState('')
	const [sending, setSending] = useState(false)
	const [suggesting, setSuggesting] = useState(false)

	const bottomRef = useRef<HTMLDivElement>(null)

	// Fetch messages when conversation changes
	useEffect(() => {
		if (conversation) {
			loadMessages()
		} else {
			setMessages([])
		}
	}, [conversation?.id])

	// Auto-scroll to bottom when messages change
	useEffect(() => {
		bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
	}, [messages])

	// Polling for new messages (Simple MVP Realtime)
	useEffect(() => {
		if (!conversation) return

		const interval = setInterval(() => {
			loadMessages(true) // silent refresh
		}, 5000)

		return () => clearInterval(interval)
	}, [conversation?.id])

	const loadMessages = async (silent = false) => {
		if (!conversation) return

		if (!silent) setLoading(true)
		try {
			const res: any = await conversations.getMessages(conversation.id)

			// Handle Qiscus-style response or direct array
			const msgs = res.results?.messages || res.payload || []
			setMessages(msgs)
		} catch (e) {
			console.error('Failed to load messages:', e)
		} finally {
			if (!silent) setLoading(false)
		}
	}

	const handleSendMessage = async () => {
		if (!message.trim() || !conversation) return

		setSending(true)
		try {
			// Optimistic update
			const tempId = `temp_${Date.now()}`
			const optimisticMsg: MessageProps = {
				id: tempId,
				message: message,
				message_type: 'outgoing',
				content_type: 'text',
				created_at: new Date().toISOString(),
				status: 'sending',
			}
			setMessages((prev) => [...prev, optimisticMsg])

			await conversations.sendMessage(conversation.id, {
				content: message,
				message_type: 'outgoing',
			})

			setMessage('')
			loadMessages(true) // Refresh to get real ID and status
		} catch (error) {
			console.error('Failed to send message:', error)
			// Remove optimistic message on error (or mark failed)
			setMessages((prev) => prev.filter((m) => m.id !== `temp_${Date.now()}`)) // simplified: reloading cleans it up
			loadMessages(true)
		} finally {
			setSending(false)
		}
	}

	const handleSuggestReply = async () => {
		if (!conversation) return

		setSuggesting(true)
		try {
			const data: any = await conversations.suggestReply(conversation.id)
			if (data.suggestion) {
				setMessage(data.suggestion)
			}
		} catch (error) {
			console.error('Failed to get suggestion:', error)
		} finally {
			setSuggesting(false)
		}
	}

	// Messaging Window Logic
	const isWindowClosed = conversation?.status === 'resolved' // Simplified check, extend with is_within_messaging_window if needed from enhanced API

	if (!conversation) {
		return (
			<div className="flex-1 flex items-center justify-center flex-col gap-4 bg-gray-50/50">
				<div className="text-6xl grayscale opacity-50">💬</div>
				<div className="text-lg font-medium text-muted-foreground text-center">
					Select a conversation to start messaging
				</div>
			</div>
		)
	}

	return (
		<div className="flex-1 flex flex-col h-full bg-white relative">
			{/* Header */}
			<div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-white/80 backdrop-blur-md sticky top-0 z-10">
				<div className="flex items-center gap-3">
					<div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600 font-bold text-lg">
						{conversation.meta.sender.name.charAt(0).toUpperCase()}
					</div>
					<div>
						<h2 className="text-lg font-semibold text-gray-900 leading-tight">
							{conversation.meta.sender.name}
						</h2>
						<div className="flex items-center gap-2 text-xs text-gray-500">
							<span
								className={`w-2 h-2 rounded-full ${conversation.status === 'open' ? 'bg-green-500' : 'bg-gray-300'}`}
							/>
							<span>{conversation.meta.sender.email || 'WhatsApp User'}</span>
						</div>
					</div>
				</div>
				<div className="flex gap-1">
					<Button
						variant="ghost"
						size="icon"
						className="text-gray-400 hover:text-gray-600"
					>
						<Search size={20} />
					</Button>
					<Button
						variant="ghost"
						size="icon"
						className="text-gray-400 hover:text-gray-600"
					>
						<MoreVertical size={20} />
					</Button>
				</div>
			</div>

			{/* Messages Area */}
			<div className="flex-1 overflow-y-auto px-6 py-4 bg-slate-50 relative">
				{loading && messages.length === 0 ? (
					<div className="absolute inset-0 flex items-center justify-center">
						<Loader2 className="animate-spin text-indigo-600" size={32} />
					</div>
				) : messages.length === 0 ? (
					<div className="flex h-full items-center justify-center text-center text-muted-foreground">
						<div>
							<div className="text-5xl mb-3 opacity-20">📨</div>
							<div className="text-lg font-medium">No messages yet</div>
							<div className="text-sm mt-1 opacity-60">
								Start the conversation by sending a message
							</div>
						</div>
					</div>
				) : (
					<div className="space-y-2">
						{messages.map((msg) => (
							<MessageItem key={msg.id} item={msg} />
						))}
						<div ref={bottomRef} />
					</div>
				)}
			</div>

			{/* Messaging Window Warning */}
			{conversation.is_within_messaging_window === false && (
				<div className="bg-yellow-50 px-6 py-2 text-xs text-yellow-800 border-t border-yellow-100 flex justify-center">
					⚠️ 24-hour messaging window has expred. You can only send template
					messages.
				</div>
			)}

			{/* Input Area */}
			<div className="p-4 border-t border-gray-100 bg-white">
				<div className="flex gap-3 items-end">
					{/* Attachments Button could go here */}

					<div className="relative flex-1">
						<textarea
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							onKeyDown={(e) => {
								if (e.key === 'Enter' && !e.shiftKey) {
									e.preventDefault()
									handleSendMessage()
								}
							}}
							placeholder="Type your message..."
							className="w-full min-h-[44px] max-h-[120px] py-3 px-4 bg-gray-50 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:bg-white transition resize-none text-sm"
							rows={1}
						/>
						{suggesting && (
							<div className="absolute right-3 top-3">
								<Loader2 className="animate-spin text-indigo-500" size={16} />
							</div>
						)}
					</div>

					<div className="flex flex-col gap-2">
						<Button
							variant="outline"
							size="icon"
							onClick={handleSuggestReply}
							disabled={suggesting || sending}
							title="AI Suggested Reply"
							className="h-[44px] w-[44px] rounded-xl text-purple-600 border-purple-100 hover:bg-purple-50 hover:border-purple-200 transition"
						>
							<Sparkles
								size={20}
								className={suggesting ? 'animate-pulse' : ''}
							/>
						</Button>

						<Button
							onClick={handleSendMessage}
							disabled={sending || !message.trim()}
							className="h-[44px] w-[44px] rounded-xl bg-indigo-600 hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition p-0 flex items-center justify-center"
						>
							{sending ? (
								<Loader2 className="animate-spin text-white" size={20} />
							) : (
								<Send className="text-white ml-0.5" size={20} />
							)}
						</Button>
					</div>
				</div>
				<div className="text-[10px] text-gray-400 mt-2 text-center">
					Press Enter to send, Shift + Enter for new line
				</div>
			</div>
		</div>
	)
}
