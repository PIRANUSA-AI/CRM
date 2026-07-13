import { Camera, Check, LoaderCircle, User } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { auth, media } from '@/lib/api'

type Profile = {
	id: string
	name: string
	email: string
	role: string | null
	avatar_url: string | null
}

function updateStoredProfile(profile: Profile) {
	const raw = localStorage.getItem('crm_user')
	if (raw) {
		try {
			const stored = JSON.parse(raw) as Record<string, any>
			const next = stored.user && typeof stored.user === 'object'
				? { ...stored, user: { ...stored.user, ...profile } }
				: { ...stored, ...profile }
			localStorage.setItem('crm_user', JSON.stringify(next))
		} catch {
			localStorage.setItem('crm_user', JSON.stringify(profile))
		}
	}
	window.dispatchEvent(new CustomEvent('crm:user-updated', { detail: profile }))
}

export default function ProfileSettingsManager() {
	const fileInputRef = useRef<HTMLInputElement>(null)
	const [profile, setProfile] = useState<Profile | null>(null)
	const [name, setName] = useState('')
	const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [uploading, setUploading] = useState(false)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	useEffect(() => {
		void auth.getProfile()
			.then((response) => {
				setProfile(response.data)
				setName(response.data.name || '')
				setAvatarUrl(response.data.avatar_url)
			})
			.catch((currentError) => {
				console.error('Failed to load profile:', currentError)
				setError('Profil belum bisa dimuat.')
			})
			.finally(() => setLoading(false))
	}, [])

	const selectPhoto = async (file: File | undefined) => {
		if (!file) return
		setError(null)
		setNotice(null)
		if (!file.type.startsWith('image/')) {
			setError('Pilih file gambar untuk foto profil.')
			return
		}
		if (file.size > 5 * 1024 * 1024) {
			setError('Ukuran foto profil maksimal 5 MB.')
			return
		}

		setUploading(true)
		try {
			const response = await media.upload(file)
			if (!response.success || !response.payload?.url) throw new Error(response.error || 'Upload gagal')
			setAvatarUrl(response.payload.url)
			setNotice('Foto siap disimpan.')
		} catch (currentError) {
			console.error('Failed to upload profile photo:', currentError)
			setError(currentError instanceof Error ? currentError.message : 'Foto profil gagal diunggah.')
		} finally {
			setUploading(false)
			if (fileInputRef.current) fileInputRef.current.value = ''
		}
	}

	const saveProfile = async () => {
		if (saving || uploading) return
		const normalizedName = name.trim().replace(/\s+/g, ' ')
		if (normalizedName.length < 2) {
			setError('Nama minimal 2 karakter.')
			return
		}

		setSaving(true)
		setError(null)
		setNotice(null)
		try {
			const response = await auth.updateProfile({ name: normalizedName, avatarUrl })
			setProfile(response.data)
			setName(response.data.name)
			setAvatarUrl(response.data.avatar_url)
			updateStoredProfile(response.data)
			setNotice('Profil sudah diperbarui.')
		} catch (currentError) {
			console.error('Failed to save profile:', currentError)
			setError(currentError instanceof Error ? currentError.message : 'Profil gagal disimpan.')
		} finally {
			setSaving(false)
		}
	}

	const initials = (name || profile?.email || '?').trim().slice(0, 1).toUpperCase()

	return (
		<section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
			<header className="flex items-center gap-3 border-b border-border px-5 py-5">
				<div className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary"><User size={20} /></div>
				<div>
					<h2 className="font-bold">Profil kamu</h2>
					<p className="mt-0.5 text-sm text-muted-foreground">Nama dan foto ini hanya terlihat oleh tim internal.</p>
				</div>
			</header>

			<div className="space-y-6 px-5 py-5">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center">
					<div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-2xl font-bold text-primary-foreground">
						{avatarUrl ? <img src={avatarUrl} alt="Foto profil" className="size-full object-cover" /> : initials}
					</div>
					<div>
						<input ref={fileInputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => void selectPhoto(event.target.files?.[0])} />
						<button type="button" disabled={uploading || loading} onClick={() => fileInputRef.current?.click()} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold transition hover:bg-muted disabled:opacity-50">
							{uploading ? <LoaderCircle size={15} className="animate-spin" /> : <Camera size={15} />} {uploading ? 'Mengunggah...' : 'Pilih foto'}
						</button>
						<p className="mt-2 text-xs text-muted-foreground">JPG, PNG, atau WebP · maksimal 5 MB.</p>
					</div>
				</div>

				<div className="max-w-xl">
					<label htmlFor="profile-name" className="text-sm font-semibold">Nama</label>
					<input id="profile-name" value={name} maxLength={100} disabled={loading} onChange={(event) => setName(event.target.value)} placeholder="Nama kamu" className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15 disabled:opacity-50" />
				</div>
			</div>

			<footer className="flex flex-col gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-h-5 text-xs">
					{loading ? <span className="inline-flex items-center gap-2 text-muted-foreground"><LoaderCircle size={13} className="animate-spin" /> Memuat profil...</span> : null}
					{error ? <span className="text-destructive">{error}</span> : null}
					{notice ? <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check size={13} /> {notice}</span> : null}
				</div>
				<button type="button" disabled={loading || uploading || saving || name.trim().length < 2} onClick={() => void saveProfile()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
					{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} Simpan profil
				</button>
			</footer>
		</section>
	)
}
