import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { agentsManagement } from '@/lib/agents-api'
import { extractNormalizedRole } from '@/lib/role-access'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/kelola-tim')({
	component: KelolaTimPage,
})

interface TeamMember {
	id: string
	name: string
	email: string
	role: string
}

function KelolaTimPage() {
	const [members, setMembers] = useState<TeamMember[]>([])
	const [name, setName] = useState('')
	const [email, setEmail] = useState('')
	const [role, setRole] = useState('sales')
	const [generatedPassword, setGeneratedPassword] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)

	const loadMembers = useCallback(async () => {
		const response = await agentsManagement.list()
		setMembers((response as any).data ?? [])
	}, [])

	useEffect(() => {
		loadMembers()
	}, [loadMembers])

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
			await loadMembers()
			toast.success('Akun berhasil dibuat')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal membuat akun')
		} finally {
			setLoading(false)
		}
	}

	async function handleRoleChange(memberId: string, newRole: string) {
		const member = members.find((m) => m.id === memberId)
		const memberName = member?.name ?? 'anggota ini'
		if (!window.confirm(`Ubah role ${memberName} menjadi "${newRole}"?`)) {
			// ponytail: select is controlled by `members`, but the browser already
			// flipped its visual value on click; force a re-render so it snaps
			// back to the real (unchanged) role instead of showing the rejected one.
			setMembers((prev) => [...prev])
			return
		}
		try {
			await agentsManagement.update(memberId, { role: newRole })
			await loadMembers()
			toast.success('Role berhasil diubah')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal mengubah role')
		}
	}

	return (
		<div className="p-6 space-y-6">
			<h1 className="text-2xl font-bold">Kelola Tim</h1>

			{generatedPassword && (
				<div className="rounded-md border border-amber-400 bg-amber-50 p-4">
					<p className="text-sm font-medium">
						Password akun baru (catat sekarang, tidak akan ditampilkan lagi):
					</p>
					<code className="mt-1 block text-lg">{generatedPassword}</code>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => setGeneratedPassword(null)}
					>
						Tutup
					</Button>
				</div>
			)}

			<form onSubmit={handleCreate} className="flex flex-wrap gap-2 items-end">
				<Input
					placeholder="Nama"
					value={name}
					onChange={(e) => setName(e.target.value)}
					required
				/>
				<Input
					type="email"
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

			<table className="w-full text-sm">
				<thead>
					<tr className="text-left border-b">
						<th className="py-2">Nama</th>
						<th>Email</th>
						<th>Role</th>
					</tr>
				</thead>
				<tbody>
					{members.map((member) => (
						<tr key={member.id} className="border-b">
							<td className="py-2">{member.name}</td>
							<td>{member.email}</td>
							<td>
								<NativeSelect
									value={
										extractNormalizedRole(
											member as unknown as Record<string, unknown>,
										) ||
										member.role
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
	)
}
