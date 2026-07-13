import { useState, useEffect } from 'react'
import { API_BASE } from '@/lib/api'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from '@/components/ui/select'
import { Search, Calendar, Download, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'

interface Campaign {
	id: string
	campaign_id: string
	name: string
	status: string
	objective: string
	daily_budget: string
	lifetime_budget: string
	performance: {
		impressions: number
		reach: number
		clicks: number
		spend: number
		conversations: number
	}
}

interface Account {
	id: string
	fb_account_id: string
	fb_account_name: string
}

export default function AdsPerformance() {
	const [accounts, setAccounts] = useState<Account[]>([])
	const [selectedAccount, setSelectedAccount] = useState<string>('')
	const [campaigns, setCampaigns] = useState<Campaign[]>([])

	const [loading, setLoading] = useState(true)
	const [syncing, setSyncing] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')

	// Totals
	const [totals, setTotals] = useState({
		impressions: 0,
		reach: 0,
		clicks: 0,
		spend: 0,
		roas: 0,
	})

	useEffect(() => {
		fetchAccounts()
	}, [])

	useEffect(() => {
		if (selectedAccount) {
			fetchCampaigns()
		}
	}, [selectedAccount])

	const fetchAccounts = async () => {
		try {
			const token = localStorage.getItem('scalechat_token')
			const res = await fetch(`${API_BASE}/meta-ads/accounts`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success && data.accounts.length > 0) {
				setAccounts(data.accounts)
				setSelectedAccount(data.accounts[0].id)
			}
		} catch (err) {
			console.error(err)
		}
	}

	const fetchCampaigns = async () => {
		setLoading(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			// Fetch campaigns for specific account
			const res = await fetch(
				`${API_BASE}/meta-ads/campaigns?account_id=${selectedAccount}`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			)
			const data = await res.json()
			if (data.success) {
				setCampaigns(data.campaigns)
				calculateTotals(data.campaigns)
			}
		} catch (err) {
			console.error(err)
			toast.error('Failed to load campaigns')
		} finally {
			setLoading(false)
		}
	}

	const calculateTotals = (camps: Campaign[]) => {
		const t = camps.reduce(
			(acc, curr) => {
				const p = curr.performance || {
					impressions: 0,
					reach: 0,
					clicks: 0,
					spend: 0,
					conversations: 0,
				}
				return {
					impressions: acc.impressions + Number(p.impressions || 0),
					reach: acc.reach + Number(p.reach || 0),
					clicks: acc.clicks + Number(p.clicks || 0),
					spend: acc.spend + Number(p.spend || 0),
					// Mock ROAS logic: (Conversations * Value) / Spend. For now just 0.
					roas: 0,
				}
			},
			{ impressions: 0, reach: 0, clicks: 0, spend: 0, roas: 0 },
		)
		setTotals(t)
	}

	const handleSync = async () => {
		setSyncing(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const res = await fetch(`${API_BASE}/meta-ads/sync`, {
				method: 'POST',
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success) {
				toast.success('Sync started. Data will update shortly.')
				setTimeout(fetchCampaigns, 3000)
			} else {
				toast.error('Sync failed: ' + data.error)
			}
		} catch (err) {
			toast.error('Sync request failed')
		} finally {
			setSyncing(false)
		}
	}

	const formatCurrency = (val: number | string) => {
		const num = typeof val === 'string' ? parseFloat(val) : val
		if (isNaN(num)) return '-'
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0,
		}).format(num)
	}

	const filteredCampaigns = campaigns.filter(
		(c) =>
			c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
			c.campaign_id.includes(searchQuery),
	)

	const StatCard = ({ label, value, subLabel }: any) => (
		<Card className="flex-1 border-gray-100 shadow-sm">
			<CardContent className="p-6 text-center">
				<h3 className="text-xl font-bold text-gray-900">{value}</h3>
				<p className="text-sm text-gray-500 font-medium mt-1">{label}</p>
				{/* Tooltip icon would go here */}
			</CardContent>
		</Card>
	)

	return (
		<div className="space-y-6">
			{/* Header Section */}
			<Card className="border-gray-100 shadow-sm">
				<CardContent className="p-6">
					<div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
						<div className="w-full md:w-80">
							<label className="text-xs font-semibold text-gray-500 mb-1.5 block uppercase tracking-wider">
								Ad Account
							</label>
							{accounts.length > 0 ? (
								<Select
									value={selectedAccount}
									onValueChange={setSelectedAccount}
								>
									<SelectTrigger className="w-full">
										<SelectValue placeholder="Select Account" />
									</SelectTrigger>
									<SelectContent>
										{accounts.map((acc) => (
											<SelectItem key={acc.id} value={acc.id}>
												{acc.fb_account_name} ({acc.fb_account_id})
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							) : (
								<div className="text-sm text-gray-500 italic p-2 border rounded bg-gray-50">
									No accounts connected
								</div>
							)}
						</div>
					</div>

					<div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-4 border-t border-gray-100">
						<div>
							<h3 className="font-semibold text-gray-900">Sync to Meta</h3>
							<p className="text-sm text-gray-500 max-w-2xl mt-1">
								Effortlessly synchronize the latest Meta data to our server,
								ensuring real-time updates and seamless integration.
							</p>
						</div>
						<Button
							onClick={handleSync}
							disabled={syncing}
							className="bg-emerald-500 hover:bg-emerald-600 text-white min-w-[120px]"
						>
							{syncing ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : null}
							{syncing ? 'Syncing...' : 'Sync Data'}
						</Button>
					</div>
				</CardContent>
			</Card>

			{/* Stats Overview */}
			<div className="flex flex-col md:flex-row gap-4">
				<StatCard
					label="Total Impressions"
					value={totals.impressions.toLocaleString()}
				/>
				<StatCard label="Reach" value={totals.reach.toLocaleString()} />
				<StatCard label="Clicks" value={totals.clicks.toLocaleString()} />
				<StatCard label="Amount Spend" value={formatCurrency(totals.spend)} />
				<StatCard label="ROAS" value={formatCurrency(totals.roas)} />
			</div>

			{/* Filter Bar */}
			<div className="flex flex-col md:flex-row justify-between items-center gap-4">
				<h3 className="font-bold text-gray-900 text-lg">All Campaign</h3>
				<div className="flex gap-3 w-full md:w-auto">
					<div className="relative flex-1 md:w-64">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
						<Input
							placeholder="Search the campaign here"
							className="pl-10 bg-white"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
					{/* Mock Date Picker Button */}
					<div className="relative">
						<Button
							variant="outline"
							className="bg-white text-gray-600 font-normal pl-9"
						>
							02/12/2025 - 01/01/2026
						</Button>
						<Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
					</div>
					<Button
						variant="outline"
						className="text-emerald-600 border-emerald-200 bg-emerald-50 hover:bg-emerald-100"
					>
						Download Data
						<Download className="w-4 h-4 ml-2" />
					</Button>
				</div>
			</div>

			{/* Campaign List (Cards) */}
			<div className="space-y-4">
				{loading ? (
					<div className="text-center py-20 text-gray-500">
						Loading campaigns...
					</div>
				) : filteredCampaigns.length === 0 ? (
					<div className="text-center py-20 bg-white rounded-xl border border-gray-100 text-gray-500">
						No campaigns found
					</div>
				) : (
					filteredCampaigns.map((camp) => {
						const p = camp.performance || {
							impressions: 0,
							reach: 0,
							clicks: 0,
							spend: 0,
							conversations: 0,
						}
						return (
							<Card
								key={camp.id}
								className="border-gray-100 shadow-sm hover:border-gray-200 transition-colors"
							>
								<CardContent className="p-6">
									<div className="flex justify-between items-start mb-6">
										<div className="flex gap-3">
											{/* Status Dot */}
											<div
												className={`w-2 h-2 rounded-full mt-2 ${camp.status === 'ACTIVE' ? 'bg-emerald-500' : 'bg-gray-300'}`}
											/>
											<div>
												<h4 className="font-bold text-gray-900 text-base">
													{camp.name}
												</h4>
												<p className="text-xs text-gray-400 mt-1">
													Campaign ID: {camp.campaign_id}
												</p>
											</div>
										</div>
										<div className="flex items-center gap-1 text-xs text-gray-500">
											<div className="w-4 h-4 rounded-full bg-blue-600 grid place-items-center text-white text-[8px]">
												f
											</div>
											Dental Clinic
										</div>
									</div>

									<div className="grid grid-cols-2 md:grid-cols-5 gap-4">
										<div>
											<h5 className="font-bold text-gray-900 text-lg">
												{p.impressions?.toLocaleString() || 0}
											</h5>
											<p className="text-xs text-gray-400 font-medium mt-1">
												Impression
											</p>
										</div>
										<div>
											<h5 className="font-bold text-gray-900 text-lg">
												{p.reach?.toLocaleString() || 0}
											</h5>
											<p className="text-xs text-gray-400 font-medium mt-1">
												Reach
											</p>
										</div>
										<div>
											<h5 className="font-bold text-gray-900 text-lg">
												{p.clicks?.toLocaleString() || 0}
											</h5>
											<p className="text-xs text-gray-400 font-medium mt-1">
												Clicks
											</p>
										</div>
										<div>
											<h5 className="font-bold text-gray-900 text-lg">
												{formatCurrency(p.spend || 0)}
											</h5>
											<p className="text-xs text-gray-400 font-medium mt-1">
												Amount Spend
											</p>
										</div>
										<div>
											<h5 className="font-bold text-gray-900 text-lg">
												Rp 0,00
											</h5>
											<p className="text-xs text-gray-400 font-medium mt-1">
												ROAS
											</p>
										</div>
									</div>
								</CardContent>
							</Card>
						)
					})
				)}
			</div>

			{/* Pagination Mock */}
			<div className="flex justify-center items-center gap-2 pt-4 pb-8">
				<span className="text-xs text-gray-400">Prev</span>
				<button className="w-6 h-6 rounded bg-emerald-500 text-white text-xs font-medium">
					1
				</button>
				<button className="w-6 h-6 rounded text-gray-500 text-xs font-medium hover:bg-gray-100">
					2
				</button>
				<button className="w-6 h-6 rounded text-gray-500 text-xs font-medium hover:bg-gray-100">
					3
				</button>
				<span className="text-xs text-emerald-500 font-medium ml-2 cursor-pointer">
					Next
				</span>
			</div>
		</div>
	)
}
