/**
 * Chat Preferences Utility
 * Manages pinned chats and muted notifications in localStorage
 */

interface ChatPreferences {
	pinnedChats: string[] // Array of conversation IDs
	mutedChats: Record<string, number | null> // conversationId -> muteUntil timestamp (null = forever)
}

const STORAGE_KEY = 'scalechat_chat_preferences'

function getPreferences(): ChatPreferences {
	try {
		const stored = localStorage.getItem(STORAGE_KEY)
		if (stored) {
			return JSON.parse(stored)
		}
	} catch (error) {
		console.error('Failed to load chat preferences:', error)
	}

	return {
		pinnedChats: [],
		mutedChats: {},
	}
}

function savePreferences(prefs: ChatPreferences): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
	} catch (error) {
		console.error('Failed to save chat preferences:', error)
	}
}

// Pin Management
export function pinChat(conversationId: string): void {
	const prefs = getPreferences()
	if (!prefs.pinnedChats.includes(conversationId)) {
		prefs.pinnedChats.unshift(conversationId) // Add to beginning
		savePreferences(prefs)
	}
}

export function unpinChat(conversationId: string): void {
	const prefs = getPreferences()
	prefs.pinnedChats = prefs.pinnedChats.filter((id) => id !== conversationId)
	savePreferences(prefs)
}

export function isPinned(conversationId: string): boolean {
	const prefs = getPreferences()
	return prefs.pinnedChats.includes(conversationId)
}

export function getPinnedChats(): string[] {
	const prefs = getPreferences()
	return prefs.pinnedChats
}

// Mute Management
export function muteChat(
	conversationId: string,
	duration: number | null,
): void {
	const prefs = getPreferences()

	if (duration === null) {
		// Mute forever
		prefs.mutedChats[conversationId] = null
	} else {
		// Mute until timestamp
		prefs.mutedChats[conversationId] = Date.now() + duration
	}

	savePreferences(prefs)
}

export function unmuteChat(conversationId: string): void {
	const prefs = getPreferences()
	delete prefs.mutedChats[conversationId]
	savePreferences(prefs)
}

export function isMuted(conversationId: string): boolean {
	const prefs = getPreferences()
	const muteUntil = prefs.mutedChats[conversationId]

	if (muteUntil === undefined) {
		return false // Not muted
	}

	if (muteUntil === null) {
		return true // Muted forever
	}

	// Check if mute duration has expired
	if (Date.now() > muteUntil) {
		// Expired, remove from muted list
		unmuteChat(conversationId)
		return false
	}

	return true
}

export function getMuteInfo(
	conversationId: string,
): { isMuted: boolean; muteUntil: number | null } | null {
	const prefs = getPreferences()
	const muteUntil = prefs.mutedChats[conversationId]

	if (muteUntil === undefined) {
		return null
	}

	if (muteUntil === null) {
		return { isMuted: true, muteUntil: null }
	}

	if (Date.now() > muteUntil) {
		unmuteChat(conversationId)
		return null
	}

	return { isMuted: true, muteUntil }
}

// Sort conversations: pinned first, then by timestamp
export function sortConversationsWithPinned<
	T extends { id: string; timestamp: Date },
>(conversations: T[]): T[] {
	const pinnedIds = getPinnedChats()

	return conversations.sort((a, b) => {
		const aIsPinned = pinnedIds.includes(a.id)
		const bIsPinned = pinnedIds.includes(b.id)

		// Both pinned: maintain pin order
		if (aIsPinned && bIsPinned) {
			return pinnedIds.indexOf(a.id) - pinnedIds.indexOf(b.id)
		}

		// Only a is pinned
		if (aIsPinned) return -1

		// Only b is pinned
		if (bIsPinned) return 1

		// Neither pinned: sort by timestamp (newest first)
		return b.timestamp.getTime() - a.timestamp.getTime()
	})
}
