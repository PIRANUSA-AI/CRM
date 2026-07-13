/**
 * Timezone-aware timestamp formatting utilities
 */

const isBrowser = typeof window !== 'undefined'
const DEFAULT_TIMEZONE = 'Asia/Jakarta'

// Keep initial value deterministic between SSR and client hydration.
let userTimezone = DEFAULT_TIMEZONE

export function setUserTimezone(tz: string) {
	userTimezone = tz
	if (isBrowser && typeof localStorage !== 'undefined') {
		localStorage.setItem('scalechat_timezone', tz)
	}
	console.log('[Timezone] Set to:', tz)
}

export function getUserTimezone(): string {
	return userTimezone
}

// Detect browser timezone
export function detectBrowserTimezone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone
	} catch {
		return 'UTC'
	}
}

// Format time only (HH:MM)
export function formatChatTime(isoDate: string | Date | number): string {
	if (!isoDate) return ''
	let date: Date
	if (typeof isoDate === 'number') {
		// If number is small (e.g. < 2000000000), it's probably Unix seconds
		date = isoDate < 2000000000 ? new Date(isoDate * 1000) : new Date(isoDate)
	} else {
		date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate
	}

	try {
		return date.toLocaleTimeString('id-ID', {
			timeZone: userTimezone,
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		})
	} catch {
		return date.toLocaleTimeString('id-ID', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		})
	}
}

// Format date for message grouping
export function formatChatDate(isoDate: string | Date | number): string {
	if (!isoDate) return ''
	let date: Date
	if (typeof isoDate === 'number') {
		date = isoDate < 2000000000 ? new Date(isoDate * 1000) : new Date(isoDate)
	} else {
		date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate
	}
	const now = new Date()

	try {
		// Get date strings in user timezone for comparison (YYYY-MM-DD format)
		const dateStr = date.toLocaleDateString('en-CA', {
			timeZone: userTimezone,
		})
		const nowStr = now.toLocaleDateString('en-CA', { timeZone: userTimezone })

		// Check if same day
		if (dateStr === nowStr) {
			return 'Today'
		}

		// Check if yesterday
		const yesterdayDate = new Date(now.getTime() - 86400000)
		const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA', {
			timeZone: userTimezone,
		})
		if (dateStr === yesterdayStr) {
			return 'Yesterday'
		}

		// Otherwise show full date
		return date.toLocaleDateString('id-ID', {
			timeZone: userTimezone,
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		})
	} catch {
		return date.toLocaleDateString('id-ID', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
		})
	}
}

// Format relative time (for conversation list)
export function formatRelativeTime(isoDate: string | Date | number): string {
	if (!isoDate) return ''
	let date: Date
	if (typeof isoDate === 'number') {
		date = isoDate < 2000000000 ? new Date(isoDate * 1000) : new Date(isoDate)
	} else {
		date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate
	}
	const now = new Date()
	const diffMs = now.getTime() - date.getTime()
	const diffMins = Math.floor(diffMs / 60000)
	const diffHours = Math.floor(diffMs / 3600000)
	const diffDays = Math.floor(diffMs / 86400000)

	if (diffMins < 1) return 'Just now'
	if (diffMins < 60) return `${diffMins}m ago`
	if (diffHours < 24) return `${diffHours}h ago`
	if (diffDays < 2) return 'Yesterday'
	if (diffDays < 7) return `${diffDays}d ago`

	// Show date for older messages
	return formatChatDate(date)
}

// Format full datetime
export function formatFullDateTime(isoDate: string | Date | number): string {
	if (!isoDate) return ''
	let date: Date
	if (typeof isoDate === 'number') {
		date = isoDate < 2000000000 ? new Date(isoDate * 1000) : new Date(isoDate)
	} else {
		date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate
	}

	try {
		return date.toLocaleString('id-ID', {
			timeZone: userTimezone,
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		})
	} catch {
		return date.toLocaleString('id-ID')
	}
}

// Format "Today, HH:MM" style
export function formatTodayTime(isoDate: string | Date | number): string {
	if (!isoDate) return ''
	let date: Date
	if (typeof isoDate === 'number') {
		date = isoDate < 2000000000 ? new Date(isoDate * 1000) : new Date(isoDate)
	} else {
		date = typeof isoDate === 'string' ? new Date(isoDate) : isoDate
	}
	const now = new Date()

	try {
		// Get date strings in user timezone for comparison
		const dateStr = date.toLocaleDateString('en-CA', {
			timeZone: userTimezone,
		}) // YYYY-MM-DD format
		const nowStr = now.toLocaleDateString('en-CA', { timeZone: userTimezone })

		const time = formatChatTime(date)

		// Same day - show "Today, HH:MM"
		if (dateStr === nowStr) {
			return time
		}

		// Yesterday - get yesterday's date string
		const yesterdayDate = new Date(now.getTime() - 86400000)
		const yesterdayStr = yesterdayDate.toLocaleDateString('en-CA', {
			timeZone: userTimezone,
		})
		if (dateStr === yesterdayStr) {
			return `Yesterday, ${time}`
		}

		// This week - show day name
		const dateParts = dateStr.split('-').map(Number)
		const nowParts = nowStr.split('-').map(Number)
		const dateObj = new Date(dateParts[0], dateParts[1] - 1, dateParts[2])
		const nowObj = new Date(nowParts[0], nowParts[1] - 1, nowParts[2])
		const daysDiff = Math.floor(
			(nowObj.getTime() - dateObj.getTime()) / 86400000,
		)

		if (daysDiff < 7) {
			const dayName = date.toLocaleDateString('en-US', {
				timeZone: userTimezone,
				weekday: 'short',
			})
			return `${dayName}, ${time}`
		}

		// Older - show date and time
		return date.toLocaleString('id-ID', {
			timeZone: userTimezone,
			day: 'numeric',
			month: 'short',
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		})
	} catch {
		return formatRelativeTime(date)
	}
}

// Format duration (for resolution time)
export function formatDuration(seconds: number): string {
	if (!seconds || seconds < 0) return '-'

	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)

	if (hours > 24) {
		const days = Math.floor(hours / 24)
		const remainingHours = hours % 24
		return `${days}d ${remainingHours}h`
	}

	if (hours > 0) {
		return `${hours}h ${minutes}m`
	}

	return `${minutes}m`
}
