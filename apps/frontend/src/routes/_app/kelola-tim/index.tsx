import { Link, createFileRoute } from '@tanstack/react-router'

/** Mirrors DEFAULT_DEAL_THRESHOLD on the backend; the two must not disagree. */
const DEFAULT_DEAL_THRESHOLD = 30
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	Check,
	Pencil,
	Plus,
	Trash2,
	UserPlus,
	Users,
	X,
} from 'lucide-react'
import { agentsManagement } from '@/lib/agents-api'
import { teams as teamsApi, type TeamWithMembers } from '@/lib/api'
import { extractNormalizedRole } from '@/lib/role-access'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { CrmAvatar, CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/kelola-tim/')({
	component: KelolaTimPage,
})

interface Account {
	id: string
	name: string
	email: string
	role: string
}

type MainTab = 'tim' | 'anggota'

function KelolaTimPage() {
	const [tab, setTab] = useState<MainTab>('tim')
	const [accounts, setAccounts] = useState<Account[]>([])

	const loadAccounts = useCallback(async () => {
		const response = await agentsManagement.list()
		setAccounts(((response as any).data ?? []) as Account[])
	}, [])

	useEffect(() => {
		void loadAccounts()
	}, [loadAccounts])

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Kelola Tim"
				subtitle="Buat tim (mis. AEC & MFG), atur anggotanya, dan kelola akun pengguna."
			/>

			<section className="ocm-card overflow-hidden">
				<div className="flex items-center gap-1 overflow-x-auto border-b border-border p-2">
					{(
						[
							{ value: 'tim', label: 'Tim' },
							{ value: 'anggota', label: 'Anggota / Akun' },
						] as Array<{ value: MainTab; label: string }>
					).map((option) => (
						<button
							key={option.value}
							type='button'
							onClick={() => setTab(option.value)}
							className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
								tab === option.value
									? 'bg-primary/15 text-primary'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							{option.label}
						</button>
					))}
				</div>

				<div className="p-4">
					{tab === 'tim' ? (
						<TeamsTab accounts={accounts} />
					) : (
						<AccountsTab accounts={accounts} reloadAccounts={loadAccounts} />
					)}
				</div>
			</section>
		</main>
	)
}

// ---------------------------------------------------------------------------
// Teams tab, create/edit/delete teams and manage members.
// ---------------------------------------------------------------------------

function TeamsTab({ accounts }: { accounts: Account[] }) {
	const [teams, setTeams] = useState<TeamWithMembers[]>([])
	const [loading, setLoading] = useState(true)
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [autoAssign, setAutoAssign] = useState(true)
	const [creating, setCreating] = useState(false)
	const [editingId, setEditingId] = useState<string | null>(null)
	const [editName, setEditName] = useState('')
	const [busyTeam, setBusyTeam] = useState<string | null>(null)

	const loadTeams = useCallback(async () => {
		setLoading(true)
		try {
			const response = await teamsApi.list()
			setTeams((response.payload ?? []) as unknown as TeamWithMembers[])
		} catch (err: any) {
			toast.error(err?.message || 'Gagal memuat tim')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void loadTeams()
	}, [loadTeams])

	const accountName = useMemo(() => {
		const map = new Map<string, Account>()
		for (const account of accounts) map.set(account.id, account)
		return map
	}, [accounts])

	async function handleCreate(e: React.FormEvent) {
		e.preventDefault()
		if (!name.trim()) return
		setCreating(true)
		try {
			await teamsApi.create({
				name: name.trim(),
				description: description.trim() || undefined,
				allow_auto_assign: autoAssign,
			})
			setName('')
			setDescription('')
			setAutoAssign(true)
			await loadTeams()
			toast.success('Tim berhasil dibuat')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal membuat tim')
		} finally {
			setCreating(false)
		}
	}

	async function handleDelete(team: TeamWithMembers) {
		if (!window.confirm(`Hapus tim "${team.name}"? Tindakan ini tidak bisa dibatalkan.`))
			return
		setBusyTeam(team.id)
		try {
			await teamsApi.delete(team.id)
			await loadTeams()
			toast.success('Tim dihapus')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal menghapus tim')
		} finally {
			setBusyTeam(null)
		}
	}

	async function handleToggleAuto(team: TeamWithMembers) {
		setBusyTeam(team.id)
		try {
			await teamsApi.update(team.id, { allow_auto_assign: !team.allow_auto_assign })
			await loadTeams()
		} catch (err: any) {
			toast.error(err?.message || 'Gagal memperbarui tim')
		} finally {
			setBusyTeam(null)
		}
	}

	/**
	 * The probability at which this team's deals stop reading as prospek and
	 * start reading as opportunity. Per team because AEC and MFG qualify
	 * differently. An Archicad tender is committed later than a ZWCAD seat top-up.
	 */
	async function handleThreshold(team: TeamWithMembers, value: number) {
		const next = Math.max(0, Math.min(100, Math.round(value)))
		if (next === (team.deal_threshold ?? DEFAULT_DEAL_THRESHOLD)) return
		setBusyTeam(team.id)
		try {
			await teamsApi.update(team.id, { deal_threshold: next })
			await loadTeams()
			toast.success(`Ambang opportunity ${team.name} jadi ${next}%`)
		} catch (err: any) {
			toast.error(err?.message || 'Gagal mengubah ambang')
		} finally {
			setBusyTeam(null)
		}
	}

	async function handleRename(team: TeamWithMembers) {
		const next = editName.trim()
		if (!next || next === team.name) {
			setEditingId(null)
			return
		}
		setBusyTeam(team.id)
		try {
			await teamsApi.update(team.id, { name: next })
			setEditingId(null)
			await loadTeams()
			toast.success('Nama tim diperbarui')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal mengganti nama')
		} finally {
			setBusyTeam(null)
		}
	}

	async function handleAddMember(teamId: string, userId: string) {
		if (!userId) return
		setBusyTeam(teamId)
		try {
			await teamsApi.addMember(teamId, userId)
			await loadTeams()
		} catch (err: any) {
			toast.error(err?.message || 'Gagal menambah anggota')
		} finally {
			setBusyTeam(null)
		}
	}

	async function handleRemoveMember(teamId: string, userId: string) {
		setBusyTeam(teamId)
		try {
			await teamsApi.removeMember(teamId, userId)
			await loadTeams()
		} catch (err: any) {
			toast.error(err?.message || 'Gagal mengeluarkan anggota')
		} finally {
			setBusyTeam(null)
		}
	}

	// Sales/leader accounts are the assignable pool for a team.
	const assignablePool = useMemo(
		() =>
			accounts.filter((account) => {
				const role = (account.role || '').toLowerCase()
				return role === 'sales' || role === 'leader'
			}),
		[accounts],
	)

	return (
		<div className="space-y-5">
			{/* Create team */}
			<form
				onSubmit={handleCreate}
				className="ocm-card space-y-3 p-4"
			>
				<p className="text-sm font-semibold">Buat tim baru</p>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<input
						className="ocm-input"
						placeholder="Nama tim (mis. AEC, MFG)"
						value={name}
						onChange={(e) => setName(e.target.value)}
						required
					/>
					<input
						className="ocm-input"
						placeholder="Deskripsi (opsional)"
						value={description}
						onChange={(e) => setDescription(e.target.value)}
					/>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3">
					<label className="inline-flex items-center gap-2 text-sm text-muted-foreground">
						<input
							type='checkbox'
							checked={autoAssign}
							onChange={(e) => setAutoAssign(e.target.checked)}
						/>
						Izinkan auto-assign lead ke tim ini
					</label>
					<button type="submit" className="ocm-btn ocm-btn-primary" disabled={creating}>
						<Plus size={14} /> {creating ? 'Menyimpan…' : 'Buat Tim'}
					</button>
				</div>
			</form>

			{/* Teams list */}
			{loading ? (
				<div className="space-y-2">
					{Array.from({ length: 2 }).map((_, index) => (
						<div key={index} className="h-28 animate-pulse rounded-lg bg-muted/60" />
					))}
				</div>
			) : teams.length === 0 ? (
				<CrmEmptyState
					title="Belum ada tim"
					description="Buat tim pertamamu (mis. AEC untuk Archicad, MFG untuk ZWCAD) lalu masukkan sales ke dalamnya."
				/>
			) : (
				<div className="space-y-4">
					{teams.map((team) => {
						const members = team.team_members ?? []
						const memberIds = new Set(members.map((m) => m.user_id))
						const addable = assignablePool.filter((a) => !memberIds.has(a.id))
						const busy = busyTeam === team.id
						return (
							<div key={team.id} className="ocm-card">
								<div className="ocm-card-header">
									<div className="flex min-w-0 flex-1 items-center gap-2">
										<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
											<Users size={15} />
										</span>
										{editingId === team.id ? (
											<div className="flex items-center gap-1.5">
												<input
													className='ocm-input h-8 py-1'
													value={editName}
													autoFocus
													onChange={(e) => setEditName(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === 'Enter') void handleRename(team)
														if (e.key === 'Escape') setEditingId(null)
													}}
												/>
												<button
													type='button'
													className='ocm-btn h-8 px-2'
													onClick={() => void handleRename(team)}
													disabled={busy}
												>
													<Check size={14} />
												</button>
												<button
													type='button'
													className='ocm-btn h-8 px-2'
													onClick={() => setEditingId(null)}
												>
													<X size={14} />
												</button>
											</div>
										) : (
											<div className='min-w-0'>
												<div className="flex items-center gap-2">
													<span className="truncate font-semibold">{team.name}</span>
													<button
														type='button'
														className="text-muted-foreground hover:text-foreground"
														onClick={() => {
															setEditingId(team.id)
															setEditName(team.name)
														}}
														aria-label='Ganti nama tim'
													>
														<Pencil size={13} />
													</button>
												</div>
												{team.description ? (
													<p className="truncate text-xs text-muted-foreground">
														{team.description}
													</p>
												) : null}
											</div>
										)}
									</div>
									<div className="flex shrink-0 items-center gap-2">
										<label
											className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground"
											title="Deal di bawah angka ini masih prospek; di atasnya jadi opportunity."
										>
											<span>Ambang opportunity</span>
											<input
												type='number'
												min={0}
												max={100}
												defaultValue={team.deal_threshold ?? DEFAULT_DEAL_THRESHOLD}
												disabled={busy}
												onBlur={(event) =>
													void handleThreshold(team, Number(event.target.value))
												}
												className="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-right tabular-nums focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
											/>
											<span>%</span>
										</label>
										<button
											type='button'
											onClick={() => void handleToggleAuto(team)}
											disabled={busy}
											className={`ocm-tag ${team.allow_auto_assign ? 'ocm-tag-success' : ''}`}
											title='Klik untuk mengubah'
										>
											{team.allow_auto_assign ? '● Auto-assign aktif' : '○ Auto-assign mati'}
										</button>
										<button
											type='button'
											className="text-muted-foreground hover:text-red-500"
											onClick={() => void handleDelete(team)}
											disabled={busy}
											aria-label='Hapus tim'
										>
											<Trash2 size={15} />
										</button>
									</div>
								</div>

								<div className="ocm-card-body space-y-3">
									{members.length === 0 ? (
										<p className="text-sm italic text-muted-foreground">
											Belum ada anggota.
										</p>
									) : (
										<ul className="flex flex-wrap gap-2">
											{members.map((member) => {
												const label =
													member.users?.name ||
													accountName.get(member.user_id)?.name ||
													'Pengguna'
												return (
													<li
														key={member.user_id}
														className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/40 py-1 pl-1 pr-2"
													>
														<CrmAvatar
															name={label}
															imageUrl={member.users?.avatar_url}
															size={22}
														/>
										{/* The profile lives behind the member, not in a second list of
										    the same people. */}
										<Link
											to="/kelola-tim/$userId"
											params={{ userId: member.user_id }}
											className="text-sm hover:underline"
										>
											{label}
										</Link>
														<button
															type='button'
															className="text-muted-foreground hover:text-red-500"
															onClick={() =>
																void handleRemoveMember(team.id, member.user_id)
															}
															disabled={busy}
															aria-label={`Keluarkan ${label}`}
														>
															<X size={13} />
														</button>
													</li>
												)
											})}
										</ul>
									)}

									{addable.length > 0 ? (
										<div className="flex items-center gap-2">
											<UserPlus size={15} className="shrink-0 text-muted-foreground" />
											<NativeSelect
												value=''
												disabled={busy}
												onChange={(e) => {
													void handleAddMember(team.id, e.target.value)
													e.target.value = ''
												}}
												className='max-w-xs'
											>
												<NativeSelectOption value=''>
													+ Tambah anggota…
												</NativeSelectOption>
												{addable.map((account) => (
													<NativeSelectOption key={account.id} value={account.id}>
														{account.name} ({account.role})
													</NativeSelectOption>
												))}
											</NativeSelect>
										</div>
									) : (
										<p className="text-xs text-muted-foreground">
											Semua sales/leader sudah ada di tim ini.
										</p>
									)}
								</div>
							</div>
						)
					})}
				</div>
			)}
		</div>
	)
}

// ---------------------------------------------------------------------------
// Accounts tab, create user accounts and change their role (unchanged logic).
// ---------------------------------------------------------------------------

function AccountsTab({
	accounts,
	reloadAccounts,
}: {
	accounts: Account[]
	reloadAccounts: () => Promise<void>
}) {
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [role, setRole] = useState('sales')
	const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	async function handleCreate(e: React.FormEvent) {
		e.preventDefault()
		setLoading(true)
		try {
			const response = await agentsManagement.create({ name, email, role })
			const data = (response as any).data
			if (data?.generatedPassword) {
				setGeneratedPassword(data.generatedPassword)
			}
			setName('')
			setEmail('')
			await reloadAccounts()
			toast.success('Akun berhasil dibuat')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal membuat akun')
		} finally {
			setLoading(false)
		}
	}

	async function handleRoleChange(memberId: string, newRole: string) {
		const member = accounts.find((m) => m.id === memberId)
		const memberName = member?.name ?? 'anggota ini'
		if (!window.confirm(`Ubah role ${memberName} menjadi "${newRole}"?`)) {
			await reloadAccounts()
			return
		}
		try {
			await agentsManagement.update(memberId, { role: newRole })
			await reloadAccounts()
			toast.success('Role berhasil diubah')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal mengubah role')
		}
	}

	return (
		<div className="space-y-5">
			{generatedPassword && (
				<div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-4">
					<p className="text-sm font-medium">
						Password akun baru (catat sekarang, tidak akan ditampilkan lagi):
					</p>
					<code className="mt-1 block text-lg">{generatedPassword}</code>
					<Button
						variant='ghost'
						size='sm'
						onClick={() => setGeneratedPassword(null)}
					>
						Tutup
					</Button>
				</div>
			)}

			<form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
				<Input
					placeholder="Nama"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
				/>
				<Input
					type='email'
					placeholder="Email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					required
				/>
				<NativeSelect value={role} onChange={(e) => setRole(e.target.value)}>
					<NativeSelectOption value="sales">Sales</NativeSelectOption>
					<NativeSelectOption value="leader">Sales Leader</NativeSelectOption>
					<NativeSelectOption value="ceo">CEO</NativeSelectOption>
					<NativeSelectOption value="superadmin">Superadmin</NativeSelectOption>
				</NativeSelect>
				<Button type="submit" disabled={loading}>
					Tambah Akun
				</Button>
			</form>

			<div className="ocm-card overflow-hidden">
				<div className="overflow-x-auto">
					<table className="ocm-table">
						<thead>
							<tr>
								<th>Nama</th>
								<th>Email</th>
								<th>Role</th>
							</tr>
						</thead>
						<tbody>
							{accounts.map((member) => (
								<tr key={member.id}>
									<td>{member.name}</td>
									<td>{member.email}</td>
									<td>
										<NativeSelect
											value={
												extractNormalizedRole(
													member as unknown as Record<string, unknown>,
												) || member.role
											}
											onChange={(e) => handleRoleChange(member.id, e.target.value)}
										>
											<NativeSelectOption value="sales">Sales</NativeSelectOption>
											<NativeSelectOption value="leader">Sales Leader</NativeSelectOption>
											<NativeSelectOption value="ceo">CEO</NativeSelectOption>
											<NativeSelectOption value="superadmin">Superadmin</NativeSelectOption>
										</NativeSelect>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</div>
	)
}
