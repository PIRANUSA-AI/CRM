import { useState, useEffect } from 'react'
import { Bot, Plus, Edit2, Trash2, CheckCircle, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'

interface Rule {
	id: string
	name: string
	description: string
	rule_type: 'round_robin' | 'load_balanced' | 'skill_based'
	priority: number
	is_active: boolean
	conditions: any
	target_type: 'all' | 'division' | 'agent'
	target_ids: string[]
}

export default function AutoAssignManager() {
	const [rules, setRules] = useState<Rule[]>([])
	const [loading, setLoading] = useState(true)
	const [showModal, setShowModal] = useState(false)
	const [editingRule, setEditingRule] = useState<Rule | null>(null)

	const appId = localStorage.getItem('scalechat_app_id')
	const token = localStorage.getItem('scalechat_token')

	const fetchRules = async () => {
		try {
			const res = await fetch('/api/auto-assign/rules', {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success) {
				setRules(data.payload)
			}
		} catch (error) {
			console.error('Failed to fetch rules:', error)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchRules()
	}, [])

	const toggleRuleStatus = async (rule: Rule) => {
		try {
			const res = await fetch(`/api/auto-assign/rules/${rule.id}`, {
				method: 'PATCH',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ is_active: !rule.is_active }),
			})
			if (res.ok) {
				setRules(
					rules.map((r) =>
						r.id === rule.id ? { ...r, is_active: !r.is_active } : r,
					),
				)
				toast.success(`Rule ${!rule.is_active ? 'activated' : 'deactivated'}`)
			}
		} catch (error) {
			toast.error('Failed to update rule')
		}
	}

	const handleDelete = async (id: string) => {
		if (!confirm('Are you sure you want to delete this rule?')) return
		try {
			const res = await fetch(`/api/auto-assign/rules/${id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				setRules(rules.filter((r) => r.id !== id))
				toast.success('Rule deleted')
			}
		} catch (error) {
			toast.error('Delete failed')
		}
	}

	return (
		<Card className="border-gray-100 shadow-sm overflow-hidden">
			<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
				<div className="flex items-center justify-between w-full">
					<div className="flex items-center gap-2">
						<Bot size={20} className="text-emerald-600" />
						<CardTitle className="text-lg font-bold">
							Auto Assignment Rules
						</CardTitle>
					</div>
					<Button
						size="sm"
						onClick={() => {
							setEditingRule(null)
							setShowModal(true)
						}}
						className="bg-emerald-500 hover:bg-emerald-600 font-bold"
					>
						<Plus size={16} className="mr-1" /> Add Rule
					</Button>
				</div>
				<CardDescription>
					Automatically assign conversations to agents based on rules
				</CardDescription>
			</CardHeader>
			<CardContent className="p-0">
				{loading ? (
					<div className="p-8 text-center text-gray-400">Loading rules...</div>
				) : rules.length === 0 ? (
					<div className="p-12 text-center text-gray-400">
						<Bot size={48} className="mx-auto mb-4 opacity-10" />
						<p className="text-sm font-medium">No rules configured yet.</p>
						<p className="text-xs mt-1">
							Add your first rule to start automating assignments.
						</p>
					</div>
				) : (
					<div className="divide-y divide-gray-100">
						{rules.map((rule) => (
							<div
								key={rule.id}
								className="p-6 flex items-center justify-between hover:bg-gray-50/50 transition"
							>
								<div className="space-y-1">
									<div className="flex items-center gap-2">
										<p className="text-sm font-bold text-gray-900">
											{rule.name}
										</p>
										<span
											className={`w-2 h-2 rounded-full ${rule.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
										/>
									</div>
									<p className="text-xs text-gray-500">
										{rule.description || 'No description'}
									</p>
									<div className="flex gap-2">
										<span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-bold rounded uppercase tracking-wider">
											{rule.rule_type.replace('_', ' ')}
										</span>
										<span className="px-2 py-0.5 bg-blue-50 text-blue-600 text-[10px] font-bold rounded uppercase tracking-wider">
											Priority {rule.priority}
										</span>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<Button
										variant="ghost"
										size="sm"
										onClick={() => toggleRuleStatus(rule)}
										className={
											rule.is_active ? 'text-emerald-600' : 'text-gray-400'
										}
									>
										{rule.is_active ? (
											<CheckCircle size={18} />
										) : (
											<XCircle size={18} />
										)}
									</Button>
									<Button
										variant="outline"
										size="sm"
										onClick={() => {
											setEditingRule(rule)
											setShowModal(true)
										}}
										className="font-bold h-8"
									>
										Edit
									</Button>
									<Button
										variant="ghost"
										size="sm"
										onClick={() => handleDelete(rule.id)}
										className="h-8 text-red-400 hover:text-red-600 hover:bg-red-50"
									>
										<Trash2 size={16} />
									</Button>
								</div>
							</div>
						))}
					</div>
				)}
			</CardContent>
		</Card>
	)
}
