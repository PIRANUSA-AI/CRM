import { useState, useEffect } from 'react'
import {
	Timer,
	Plus,
	Edit2,
	Trash2,
	Activity,
	ShieldCheck,
	AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { toast } from 'sonner'

interface SLAPolicy {
	id: string
	name: string
	description: string
	first_response_time: number // in minutes
	resolution_time: number // in minutes
	is_active: boolean
	is_default: boolean
}

interface SLAStats {
	avg_response_time: number
	avg_resolution_time: number
	compliance_rate: number
	total_breaches: number
}

export default function SLAManager() {
	const [policies, setPolicies] = useState<SLAPolicy[]>([])
	const [stats, setStats] = useState<SLAStats | null>(null)
	const [loading, setLoading] = useState(true)
	const [showModal, setShowModal] = useState(false)

	const appId = localStorage.getItem('scalechat_app_id')
	const token = localStorage.getItem('scalechat_token')

	const fetchData = async () => {
		try {
			const [policiesRes, statsRes] = await Promise.all([
				fetch('/api/auto-assign/sla', {
					headers: { Authorization: `Bearer ${token}` },
				}),
				fetch('/api/auto-assign/sla/stats?days=7', {
					headers: { Authorization: `Bearer ${token}` },
				}),
			])

			const policiesData = await policiesRes.json()
			const statsData = await statsRes.json()

			if (policiesData.success) setPolicies(policiesData.payload)
			if (statsData.success) setStats(statsData.payload)
		} catch (error) {
			console.error('Failed to fetch SLA data:', error)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchData()
	}, [])

	const formatTime = (mins: number) => {
		if (mins < 60) return `${mins}m`
		const hours = Math.floor(mins / 60)
		if (hours < 24) return `${hours}h ${mins % 60}m`
		return `${Math.floor(hours / 24)}d ${hours % 24}h`
	}

	return (
		<div className="space-y-6">
			{/* SLA Stats Overview */}
			<div className="grid grid-cols-1 md:grid-cols-3 gap-4">
				<Card className="border-gray-100 shadow-sm">
					<CardContent className="pt-6">
						<div className="flex items-center gap-2 mb-2">
							<Activity size={16} className="text-emerald-500" />
							<p className="text-xs font-black uppercase tracking-widest text-gray-400">
								Compliance Rate
							</p>
						</div>
						<p className="text-2xl font-black text-gray-900">
							{stats?.compliance_rate || 0}%
						</p>
						<p className="text-[10px] text-gray-500 mt-1">
							Last 7 days performance
						</p>
					</CardContent>
				</Card>
				<Card className="border-gray-100 shadow-sm">
					<CardContent className="pt-6">
						<div className="flex items-center gap-2 mb-2">
							<Timer size={16} className="text-blue-500" />
							<p className="text-xs font-black uppercase tracking-widest text-gray-400">
								Avg. Response
							</p>
						</div>
						<p className="text-2xl font-black text-gray-900">
							{formatTime(stats?.avg_response_time || 0)}
						</p>
						<p className="text-[10px] text-gray-500 mt-1">
							Time to first response
						</p>
					</CardContent>
				</Card>
				<Card className="border-gray-100 shadow-sm">
					<CardContent className="pt-6 text-red-600">
						<div className="flex items-center gap-2 mb-2">
							<AlertCircle size={16} className="text-red-500" />
							<p className="text-xs font-black uppercase tracking-widest text-gray-400">
								Breaches
							</p>
						</div>
						<p className="text-2xl font-black">{stats?.total_breaches || 0}</p>
						<p className="text-[10px] text-gray-500 mt-1">
							Total missed targets
						</p>
					</CardContent>
				</Card>
			</div>

			<Card className="border-gray-100 shadow-sm overflow-hidden">
				<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
					<div className="flex items-center justify-between w-full">
						<div className="flex items-center gap-2">
							<ShieldCheck size={20} className="text-emerald-600" />
							<CardTitle className="text-lg font-bold">SLA Policies</CardTitle>
						</div>
						<Button
							size="sm"
							className="bg-emerald-500 hover:bg-emerald-600 font-bold"
						>
							<Plus size={16} className="mr-1" /> New Policy
						</Button>
					</div>
					<CardDescription>
						Define service level agreements for response and resolution times
					</CardDescription>
				</CardHeader>
				<CardContent className="p-0">
					{loading ? (
						<div className="p-8 text-center text-gray-400">
							Loading policies...
						</div>
					) : policies.length === 0 ? (
						<div className="p-12 text-center text-gray-400">
							<Timer size={48} className="mx-auto mb-4 opacity-10" />
							<p className="text-sm font-medium">No SLA policies defined.</p>
						</div>
					) : (
						<div className="divide-y divide-gray-100">
							{policies.map((policy) => (
								<div
									key={policy.id}
									className="p-6 flex items-center justify-between hover:bg-gray-50/50 transition"
								>
									<div className="space-y-1">
										<div className="flex items-center gap-2">
											<p className="text-sm font-bold text-gray-900">
												{policy.name}
											</p>
											{policy.is_default && (
												<span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[8px] font-black uppercase rounded">
													Default
												</span>
											)}
										</div>
										<p className="text-xs text-gray-500">
											{policy.description || 'No description'}
										</p>
										<div className="flex gap-4 mt-2">
											<div className="flex flex-col">
												<span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
													FRT
												</span>
												<span className="text-xs font-bold text-gray-700">
													{formatTime(policy.first_response_time)}
												</span>
											</div>
											<div className="flex flex-col">
												<span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
													Resolution
												</span>
												<span className="text-xs font-bold text-gray-700">
													{formatTime(policy.resolution_time)}
												</span>
											</div>
										</div>
									</div>
									<div className="flex items-center gap-2">
										<Button
											variant="outline"
											size="sm"
											className="font-bold h-8"
										>
											Edit
										</Button>
										{!policy.is_default && (
											<Button
												variant="ghost"
												size="sm"
												className="h-8 text-red-400 hover:text-red-600"
											>
												<Trash2 size={16} />
											</Button>
										)}
									</div>
								</div>
							))}
						</div>
					)}
				</CardContent>
			</Card>
		</div>
	)
}
