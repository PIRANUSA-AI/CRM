import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
	RefreshCcw,
	Search,
	Clock,
	AlertTriangle,
	CheckCircle2,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { API_BASE } from '@/lib/api'

interface WebhookEvent {
	id: string
	event_type: string
	payload: any
	status: 'processed' | 'failed' | 'ignored'
	error_message?: string
	created_at: string
}

// Mock Data for now as we haven't implemented a webhook logs endpoint yet
// In a real scenario, we would fetch this from an endpoint like /api/meta-ads/webhooks/logs
const mockLogs: WebhookEvent[] = [
	{
		id: 'evt_1',
		event_type: 'ads_insight_update',
		payload: {
			object: 'ad_account',
			entry: [
				{ time: 1735776000, changes: [{ field: 'insights', value: {} }] },
			],
		},
		status: 'processed',
		created_at: new Date().toISOString(),
	},
	{
		id: 'evt_2',
		event_type: 'campaign_status_change',
		payload: { object: 'ad_campaign', id: '123456', status: 'PAUSED' },
		status: 'processed',
		created_at: new Date(Date.now() - 3600000).toISOString(),
	},
	{
		id: 'evt_3',
		event_type: 'unknown_event',
		payload: { raw_body: '...' },
		status: 'ignored',
		created_at: new Date(Date.now() - 7200000).toISOString(),
	},
]

export default function WebhookLog() {
	const [logs, setLogs] = useState<WebhookEvent[]>([])
	const [loading, setLoading] = useState(false)
	const [filter, setFilter] = useState('')

	useEffect(() => {
		// fetchLogs()
		setLogs(mockLogs)
	}, [])

	const fetchLogs = async () => {
		setLoading(true)
		// TODO: Implement API endpoint for fetching logs
		// const res = await fetch(`${API_BASE}/meta-ads/webhooks/logs`)
		// ...
		setTimeout(() => {
			setLogs(mockLogs)
			setLoading(false)
		}, 500)
	}

	const getStatusBadge = (status: string) => {
		switch (status) {
			case 'processed':
				return (
					<Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none">
						Processed
					</Badge>
				)
			case 'failed':
				return (
					<Badge className="bg-red-100 text-red-700 hover:bg-red-100 border-none">
						Failed
					</Badge>
				)
			case 'ignored':
				return (
					<Badge className="bg-gray-100 text-gray-700 hover:bg-gray-100 border-none">
						Ignored
					</Badge>
				)
			default:
				return <Badge variant="outline">{status}</Badge>
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex justify-between items-center">
				<div>
					<h3 className="text-lg font-medium text-gray-900">
						Webhook Activity
					</h3>
					<p className="text-sm text-gray-500">
						Monitor incoming events from Meta Ads Manager
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onClick={fetchLogs}
					disabled={loading}
				>
					<RefreshCcw
						className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`}
					/>
					Refresh
				</Button>
			</div>

			<Card>
				<div className="p-4 border-b border-gray-100 bg-gray-50/50 flex gap-4">
					<div className="relative flex-1 max-w-sm">
						<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
						<Input
							placeholder="Filter by event type or ID..."
							className="pl-9 bg-white"
							value={filter}
							onChange={(e) => setFilter(e.target.value)}
						/>
					</div>
				</div>
				<div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
					{logs.map((log) => (
						<div
							key={log.id}
							className="p-4 hover:bg-gray-50 transition-colors group"
						>
							<div className="flex items-start justify-between mb-2">
								<div className="flex items-center gap-3">
									<div
										className={`p-2 rounded-lg ${log.status === 'processed' ? 'bg-emerald-100/50' : 'bg-gray-100'}`}
									>
										{log.status === 'processed' ? (
											<CheckCircle2 className="w-4 h-4 text-emerald-600" />
										) : (
											<AlertTriangle className="w-4 h-4 text-gray-500" />
										)}
									</div>
									<div>
										<p className="font-mono text-sm font-medium text-gray-900">
											{log.event_type}
										</p>
										<p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
											<Clock className="w-3 h-3" />
											{new Intl.DateTimeFormat('en-US', {
												year: 'numeric',
												month: 'short',
												day: 'numeric',
												hour: '2-digit',
												minute: '2-digit',
												second: '2-digit',
											}).format(new Date(log.created_at))}{' '}
											• ID: {log.id}
										</p>
									</div>
								</div>
								{getStatusBadge(log.status)}
							</div>

							<div className="ml-11">
								<details className="group/details">
									<summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-900 select-none flex items-center gap-1 w-fit">
										View Payload
									</summary>
									<pre className="mt-2 p-3 bg-gray-900 text-gray-50 rounded-lg text-xs font-mono overflow-x-auto">
										{JSON.stringify(log.payload, null, 2)}
									</pre>
								</details>
							</div>
						</div>
					))}

					{logs.length === 0 && (
						<div className="p-12 text-center text-gray-500">
							No webhook events found
						</div>
					)}
				</div>
			</Card>
		</div>
	)
}
