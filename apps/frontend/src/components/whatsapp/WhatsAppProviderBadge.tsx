type WhatsAppProviderBadgeProps = {
	provider?: string | null
	className?: string
}

function normalizeWhatsappProviderLabel(provider?: string | null) {
	return String(provider || '').trim().toLowerCase() === 'baileys'
		? 'Non Official (Baileys)'
		: 'Official WABA'
}

function normalizeWhatsappProviderClassName(provider?: string | null) {
	return String(provider || '').trim().toLowerCase() === 'baileys'
		? 'border-amber-200 bg-amber-50 text-amber-700'
		: 'border-emerald-200 bg-emerald-50 text-emerald-700'
}

export function WhatsAppProviderBadge({
	provider,
	className = '',
}: WhatsAppProviderBadgeProps) {
	return (
		<span
			className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${normalizeWhatsappProviderClassName(
				provider,
			)} ${className}`.trim()}
		>
			{normalizeWhatsappProviderLabel(provider)}
		</span>
	)
}

export { normalizeWhatsappProviderLabel }
