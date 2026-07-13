/**
 * useTimezone Hook
 *
 * Handles timezone auto-detection and sync with backend
 */

import { useEffect, useState, useCallback } from 'react'
import { userTimezone } from '@/lib/api'
import {
	setUserTimezone,
	detectBrowserTimezone,
	getUserTimezone,
} from '@/lib/timezone'

interface TimezoneState {
	timezone: string
	isAutoDetected: boolean
	isLoading: boolean
}

export function useTimezone() {
	const [state, setState] = useState<TimezoneState>({
		timezone: 'Asia/Jakarta',
		isAutoDetected: true,
		isLoading: true,
	})

	// Initialize timezone on mount
	useEffect(() => {
		const initTimezone = async () => {
			try {
				// 1. Get stored timezone from API
				const response = await userTimezone.get()

				if (response.success && response.payload) {
					const { timezone, timezone_auto_detected } = response.payload

					// Set timezone in formatter
					setUserTimezone(timezone)

					setState({
						timezone,
						isAutoDetected: timezone_auto_detected,
						isLoading: false,
					})

					// 2. If auto-detected is true, check if browser timezone differs
					if (timezone_auto_detected) {
						const browserTimezone = detectBrowserTimezone()

						if (browserTimezone && browserTimezone !== timezone) {
							console.log(
								`[Timezone] Browser timezone (${browserTimezone}) differs from stored (${timezone}), updating...`,
							)

							// Update to new detected timezone
							const detectResponse = await userTimezone.detect(browserTimezone)

							if (detectResponse.success && detectResponse.payload.updated) {
								setUserTimezone(browserTimezone)
								setState((prev) => ({
									...prev,
									timezone: browserTimezone,
								}))
								console.log(`[Timezone] Updated to ${browserTimezone}`)
							}
						}
					}
				} else {
					// Fallback to browser detection if API fails
					const browserTimezone = detectBrowserTimezone()
					setUserTimezone(browserTimezone)
					setState({
						timezone: browserTimezone,
						isAutoDetected: true,
						isLoading: false,
					})
				}
			} catch (error) {
				console.error('[Timezone] Failed to initialize:', error)
				// Fallback to browser timezone
				const browserTimezone = detectBrowserTimezone()
				setUserTimezone(browserTimezone)
				setState({
					timezone: browserTimezone,
					isAutoDetected: true,
					isLoading: false,
				})
			}
		}

		// Only run if user is logged in
		const token = localStorage.getItem('scalechat_token')
		if (token) {
			initTimezone()
		} else {
			// Not logged in, use browser timezone
			const browserTimezone = detectBrowserTimezone()
			setUserTimezone(browserTimezone)
			setState({
				timezone: browserTimezone,
				isAutoDetected: true,
				isLoading: false,
			})
		}
	}, [])

	// Update timezone manually
	const updateTimezone = useCallback(async (newTimezone: string) => {
		try {
			await userTimezone.update(newTimezone)
			setUserTimezone(newTimezone)
			setState({
				timezone: newTimezone,
				isAutoDetected: false,
				isLoading: false,
			})
			console.log(`[Timezone] Manually updated to ${newTimezone}`)
		} catch (error) {
			console.error('[Timezone] Failed to update:', error)
			throw error
		}
	}, [])

	// Reset to auto-detect
	const resetTimezone = useCallback(async () => {
		try {
			await userTimezone.reset()
			const browserTimezone = detectBrowserTimezone()
			setUserTimezone(browserTimezone)
			setState({
				timezone: browserTimezone,
				isAutoDetected: true,
				isLoading: false,
			})
			console.log(`[Timezone] Reset to auto-detect: ${browserTimezone}`)
		} catch (error) {
			console.error('[Timezone] Failed to reset:', error)
			throw error
		}
	}, [])

	return {
		...state,
		currentTimezone: getUserTimezone(),
		updateTimezone,
		resetTimezone,
		detectBrowserTimezone,
	}
}
