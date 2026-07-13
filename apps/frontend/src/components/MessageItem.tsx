import { formatChatTime } from '../lib/timezone'
import {
	Check,
	CheckCheck,
	FileText,
	Image as ImageIcon,
	MapPin,
	Play,
	Reply,
} from 'lucide-react'

export interface MessageProps {
	id: string
	message: string
	message_type: 'incoming' | 'outgoing'
	content_type: string
	created_at: string
	status?: string

	sender?: {
		username: string
		avatar_url?: string
	}

	reply_to?: {
		message: string
		sender_username: string
	}

	media?: {
		url: string
		caption?: string
		mime_type?: string
	}

	extras?: any
}

export function MessageItem({ item }: { item: MessageProps }) {
	const isOutgoing = item.message_type === 'outgoing'
	const time = formatChatTime(item.created_at)

	// Render based on content type
	const renderContent = () => {
		// 1. Image
		if (item.content_type === 'image') {
			const imageUrl =
				item.media?.url ||
				item.extras?.url ||
				item.extras?.media?.url ||
				extractUrl(item.message)
			return (
				<div className="rounded-lg overflow-hidden mb-1">
					{imageUrl ? (
						<img
							src={imageUrl}
							alt="Image"
							className="max-w-[240px] max-h-[300px] object-cover rounded-lg cursor-pointer hover:opacity-90 transition"
							onClick={() => window.open(imageUrl, '_blank')}
						/>
					) : (
						<div className="flex items-center gap-2 p-3 bg-gray-100 rounded text-gray-500">
							<ImageIcon size={20} />
							<span>Image unavailable</span>
						</div>
					)}
					{item.message && item.message !== imageUrl && (
						<p className="mt-2 text-sm whitespace-pre-wrap">{item.message}</p>
					)}
				</div>
			)
		}

		// 2. Video
		if (item.content_type === 'video') {
			const videoUrl =
				item.media?.url ||
				item.extras?.url ||
				item.extras?.media?.url ||
				extractUrl(item.message)
			return (
				<div className="rounded-lg overflow-hidden mb-1 max-w-[240px]">
					<video controls className="w-full rounded-lg bg-black">
						<source src={videoUrl} />
						Your browser does not support video.
					</video>
					{item.message && (
						<p className="mt-2 text-sm whitespace-pre-wrap">{item.message}</p>
					)}
				</div>
			)
		}

		// 3. Document
		if (item.content_type === 'document') {
			const docUrl =
				item.media?.url || item.extras?.url || item.extras?.media?.url
			const fileName =
				item.extras?.media?.fileName || item.media?.caption || 'Document'
			return (
				<a
					href={docUrl}
					target="_blank"
					rel="noreferrer"
					className="flex items-center gap-3 p-3 bg-gray-100 rounded-lg hover:bg-gray-200 transition max-w-[260px]"
				>
					<div className="p-2 bg-white rounded-lg shadow-sm">
						<FileText size={24} className="text-gray-600" />
					</div>
					<div className="flex-1 min-w-0">
						<p className="font-medium text-sm text-gray-900 truncate">
							{fileName}
						</p>
						<p className="text-xs text-gray-500">Click to download</p>
					</div>
				</a>
			)
		}

		// 4. Audio
		if (item.content_type === 'audio') {
			const audioUrl =
				item.media?.url || item.extras?.url || item.extras?.media?.url
			return (
				<div className="max-w-[260px]">
					<audio controls className="w-full">
						<source src={audioUrl} />
						Your browser does not support audio.
					</audio>
				</div>
			)
		}

		// 3. Location
		if (item.content_type === 'location' || item.extras?.latitude) {
			const { latitude, longitude, name, address } = item.extras || {}
			const mapUrl = `https://maps.google.com/?q=${latitude},${longitude}`
			return (
				<a
					href={mapUrl}
					target="_blank"
					rel="noreferrer"
					className="block max-w-[240px] bg-gray-100 rounded-lg overflow-hidden hover:bg-gray-200 transition"
				>
					<div className="h-24 bg-blue-100 flex items-center justify-center relative">
						<MapPin className="text-red-500" size={32} />
						<div className="absolute inset-0 bg-black/5" />
					</div>
					<div className="p-3">
						<h4 className="font-semibold text-sm text-gray-900">
							{name || 'Location'}
						</h4>
						<p className="text-xs text-gray-500 truncate">
							{address || `${latitude}, ${longitude}`}
						</p>
					</div>
				</a>
			)
		}

		// 4. Interactive / Template Buttons
		const interactive = item.extras?.interactive || item.extras?.template
		if (interactive) {
			return (
				<div>
					<p className="whitespace-pre-wrap break-words mb-2">{item.message}</p>
					<div className="flex flex-col gap-2">
						{/* Handle Button Reply */}
						{interactive.button_reply && (
							<div className="bg-gray-100 text-gray-800 text-xs px-3 py-2 rounded-lg border border-gray-200 self-start">
								Selected: <strong>{interactive.button_reply.title}</strong>
							</div>
						)}

						{/* Handle Outgoing Template Buttons if present in extras */}
						{interactive.buttons && Array.isArray(interactive.buttons) && (
							<div className="grid gap-1">
								{interactive.buttons.map((btn: any, idx: number) => (
									<div
										key={idx}
										className="bg-white/90 text-indigo-600 text-center text-sm py-2 px-4 rounded border border-gray-200 shadow-sm"
									>
										{btn.reply?.title || btn.text || 'Button'}
									</div>
								))}
							</div>
						)}
					</div>
				</div>
			)
		}

		// Default: Text
		return <p className="whitespace-pre-wrap break-words">{item.message}</p>
	}

	// Extract URL from string if needed (fallback)
	const extractUrl = (text: string) => {
		try {
			if (text.startsWith('http')) return text
			return null
		} catch {
			return null
		}
	}

	return (
		<div
			className={`flex w-full mb-4 ${isOutgoing ? 'justify-end' : 'justify-start'}`}
		>
			<div
				className={`max-w-[70%] flex flex-col ${isOutgoing ? 'items-end' : 'items-start'}`}
			>
				{/* Sender Name (Group chat support) */}
				{!isOutgoing && item.sender && (
					<span className="text-xs text-gray-500 mb-1 ml-1">
						{item.sender.username}
					</span>
				)}

				{/* Reply Context */}
				{item.reply_to && (
					<div
						className={`mb-1 text-xs border-l-4 p-2 rounded max-w-full ${
							isOutgoing
								? 'bg-indigo-100 border-indigo-300 text-indigo-800'
								: 'bg-gray-100 border-gray-300 text-gray-600'
						}`}
					>
						<div className="flex items-center gap-1 font-semibold mb-0.5">
							<Reply size={10} />
							<span>{item.reply_to.sender_username}</span>
						</div>
						<p className="truncate opacity-80">{item.reply_to.message}</p>
					</div>
				)}

				{/* Message Bubble */}
				<div
					className={`relative px-4 py-2 rounded-2xl shadow-sm ${
						isOutgoing
							? 'bg-indigo-600 text-white rounded-br-none'
							: 'bg-white border border-gray-100 text-gray-900 rounded-bl-none'
					}`}
				>
					{renderContent()}

					<div
						className={`text-[10px] mt-1 flex items-center justify-end gap-1 ${
							isOutgoing ? 'text-indigo-100' : 'text-gray-400'
						}`}
					>
						<span>{time}</span>
						{isOutgoing && (
							<span>
								{item.status === 'read' ? (
									<CheckCheck size={12} />
								) : item.status === 'delivered' ? (
									<CheckCheck size={12} className="opacity-50" />
								) : (
									<Check size={12} className="opacity-50" />
								)}
							</span>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
