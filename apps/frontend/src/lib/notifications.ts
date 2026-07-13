export const playNotificationSound = (allowed: boolean) => {
	if (!allowed) return

	const audio = new Audio('/sounds/notification.mp3')
	audio.play().catch((e) => console.error('Error playing sound', e))
}

export const requestNotificationPermission = async () => {
	if (!('Notification' in window)) return 'denied'
	const permission = await Notification.requestPermission()
	return permission
}

export const sendBrowserNotification = (title: string, body: string) => {
	if (Notification.permission === 'granted' && document.hidden) {
		new Notification(title, {
			body,
			icon: '/icon.png', // Ensure you have an icon or use default
			// silent: true // if we handle sound separately
		})
	}
}
