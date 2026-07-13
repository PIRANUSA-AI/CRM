import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
	Download,
	MessageSquare,
	Users,
	Clock,
	CheckCircle2,
	BarChart3,
	RefreshCw,
	TrendingUp,
	Bot,
} from 'lucide-react'
import { metrics } from '@/lib/api'
import {
	BarChart,
	Bar,
	XAxis,
	YAxis,
	CartesianGrid,
	Tooltip,
	Legend,
	ResponsiveContainer,
	PieChart,
	Pie,
	Cell,
	LineChart,
	Line,
	AreaChart,
	Area,
} from 'recharts'
import PageHeader from '@/components/PageHeader'

export const Route = createFileRoute('/_app/analytics')({
	component: AnalyticsPage,
})

interface DashboardData {
	messages: {
		total: number
		today: number
		thisWeek: number
		thisMonth: number
		sent: number
		delivered: number
		read: number
		growth: number
		sentDetails: Array<{ date: string; value: number }>
	}
	customers: {
		total: number
		activeToday: number
		growth: number
		customersDetails: Array<{ date: string; value: number }>
	}
	performance: {
		avgResponseTime: string
		resolutionRate: number
		satisfactionScore: number
		responseDetails: Array<{ date: string; value: number }>
	}
	channels: Array<{ name: string; value: number; color: string }>
	agents: Array<{
		name: string
		convs: number
		replies: number
		rating: number
	}>
}

const COLORS = ['#10B981', '#3B82F6', '#F59E0B', '#EF4444', '#8B5CF6']

function AnalyticsPage() {
	const [data, setData] = useState<DashboardData | null>(null)
	const [loading, setLoading] = useState(true)
	const [timeRange, setTimeRange] = useState('7d')
	const [isExporting, setIsExporting] = useState(false)

	useEffect(() => {
		loadData()
	}, [timeRange])

	const loadData = async () => {
		setLoading(true)
		try {
			const res: any = await metrics.getDashboard(timeRange)
			if (res && res.success && res.data) {
				// Map and ensure structure for frontend
				const raw = res.data
				const mapped: DashboardData = {
					messages: {
						total: raw.messages?.total || 0,
						today: raw.messages?.today || 0,
						thisWeek: raw.messages?.thisWeek || 0,
						thisMonth: raw.messages?.thisMonth || 0,
						sent: raw.messages?.sent || 0,
						delivered: raw.messages?.delivered || 0,
						read: raw.messages?.read || 0,
						growth: raw.messages?.growth || 0,
						sentDetails: raw.messages?.sentDetails || [],
					},
					customers: {
						total: raw.customers?.total || 0,
						activeToday: raw.customers?.activeToday || 0,
						growth: raw.customers?.growth || 0,
						customersDetails: raw.customers?.customersDetails || [],
					},
					performance: {
						avgResponseTime: raw.performance?.avgResponseTime || '0m',
						resolutionRate: raw.performance?.resolutionRate || 0,
						satisfactionScore: raw.performance?.satisfactionScore || 0,
						responseDetails: raw.performance?.responseDetails || [],
					},
					channels: raw.channels || [],
					agents: raw.agents || [],
				}
				setData(mapped)
			} else {
				setData(null)
			}
		} catch (e) {
			console.error(e)
			setData(null)
		} finally {
			setLoading(false)
		}
	}

	const handleExport = async () => {
		setIsExporting(true)
		await new Promise((r) => setTimeout(r, 1500))
		setIsExporting(false)
	}

	const actions = (
		<div className="flex flex-wrap sm:flex-nowrap items-center gap-2 lg:gap-3 w-full lg:w-auto">
			<button
				onClick={loadData}
				className="flex-none p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200 bg-white"
				title="Refresh Data"
			>
				<RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
			</button>
			<button
				onClick={handleExport}
				className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors shadow-sm font-medium text-sm"
				disabled={isExporting}
			>
				<Download size={18} />
				{isExporting ? 'Exporting...' : 'Export'}
			</button>
			<button className="flex-1 sm:flex-none px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors shadow-sm font-medium text-sm">
				Reports
			</button>
		</div>
	)

	return (
		<div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
			<PageHeader
				title="Analytics Dashboard"
				description="Monitor your messaging performance, customer growth, and agent productivity"
				icon={<BarChart3 size={24} />}
				actions={actions}
			/>

			<div className="flex-1 overflow-y-auto px-4 lg:px-8 pb-8">
				{loading && !data ? (
					<div className="h-full flex items-center justify-center">
						<div className="flex flex-col items-center gap-4">
							<RefreshCw className="animate-spin text-emerald-500" size={32} />
							<p className="text-gray-500 font-medium tracking-tight">
								Crunching your data...
							</p>
						</div>
					</div>
				) : data ? (
					<div className="space-y-6 lg:space-y-8">
						{/* Time Range Filter */}
						<div className="flex items-center gap-3">
							<span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
								Time Range:
							</span>
							<div className="flex bg-gray-100 p-1 rounded-lg">
								{[
									{ id: '24h', label: '24h' },
									{ id: '7d', label: '7 Days' },
									{ id: '30d', label: '30 Days' },
									{ id: 'custom', label: 'Custom' },
								].map((range) => (
									<button
										key={range.id}
										onClick={() => setTimeRange(range.id)}
										className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${
											timeRange === range.id
												? 'bg-white text-gray-900 shadow-sm'
												: 'text-gray-500 hover:text-gray-700'
										}`}
									>
										{range.label}
									</button>
								))}
							</div>
						</div>

						{/* Stats Overview */}
						<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
							{[
								{
									label: 'Total Messages',
									value: data.messages.total.toLocaleString(),
									growth: data.messages.growth,
									icon: MessageSquare,
									color: 'text-blue-600',
									bg: 'bg-blue-50',
								},
								{
									label: 'Active Customers',
									value: data.customers.total.toLocaleString(),
									growth: data.customers.growth,
									icon: Users,
									color: 'text-emerald-600',
									bg: 'bg-emerald-50',
								},
								{
									label: 'Avg. Response Time',
									value: data.performance.avgResponseTime,
									growth: -12,
									icon: Clock,
									color: 'text-amber-600',
									bg: 'bg-amber-50',
								},
								{
									label: 'Resolution Rate',
									value: `${data.performance.resolutionRate}%`,
									growth: 5,
									icon: CheckCircle2,
									color: 'text-purple-600',
									bg: 'bg-purple-50',
								},
							].map((stat, i) => (
								<div
									key={i}
									className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm hover:shadow-md transition-all"
								>
									<div className="flex items-start justify-between mb-4">
										<div className={`p-3 rounded-xl ${stat.bg} ${stat.color}`}>
											<stat.icon size={24} />
										</div>
										<span
											className={`flex items-center gap-1 text-xs font-bold p-1 px-2 rounded-full ${stat.growth > 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}
										>
											<TrendingUp
												size={12}
												className={stat.growth < 0 ? 'rotate-180' : ''}
											/>
											{Math.abs(stat.growth)}%
										</span>
									</div>
									<h3 className="text-sm font-bold text-gray-500 uppercase tracking-wider mb-1">
										{stat.label}
									</h3>
									<p className="text-3xl font-black text-gray-900 tracking-tight">
										{stat.value}
									</p>
								</div>
							))}
						</div>

						<div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
							{/* Message Volume Chart */}
							<div className="lg:col-span-2 bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
								<div className="flex items-center justify-between mb-8">
									<h3 className="text-lg font-bold text-gray-900">
										Message Volume
									</h3>
									<select className="bg-gray-50 border border-gray-200 rounded-lg text-xs font-bold px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-emerald-500/20">
										<option>Sent vs Received</option>
										<option>By Channel</option>
									</select>
								</div>
								<div className="h-[300px] w-full">
									{data.messages.sentDetails.length > 0 ? (
										<ResponsiveContainer width="100%" height="100%">
											<AreaChart data={data.messages.sentDetails}>
												<defs>
													<linearGradient
														id='colorValue'
														x1='0'
														y1='0'
														x2='0'
														y2='1'
													>
														<stop
															offset='5%'
															stopColor='#10B981'
															stopOpacity={0.1}
														/>
														<stop
															offset='95%'
															stopColor='#10B981'
															stopOpacity={0}
														/>
													</linearGradient>
												</defs>
												<CartesianGrid
													strokeDasharray='3 3'
													vertical={false}
													stroke='#F3F4F6'
												/>
												<XAxis
													dataKey='date'
													axisLine={false}
													tickLine={false}
													tick={{ fill: '#9CA3AF', fontSize: 12 }}
												/>
												<YAxis
													axisLine={false}
													tickLine={false}
													tick={{ fill: '#9CA3AF', fontSize: 12 }}
												/>
												<Tooltip
													contentStyle={{
														borderRadius: '12px',
														border: 'none',
														boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)',
													}}
												/>
												<Area
													type='monotone'
													dataKey='value'
													stroke='#10B981'
													strokeWidth={3}
													fillOpacity={1}
													fill='url(#colorValue)'
												/>
											</AreaChart>
										</ResponsiveContainer>
									) : (
										<div className="h-full flex items-center justify-center text-gray-400">
											<div className='text-center'>
												<MessageSquare
													size={32}
													className='mx-auto mb-2 opacity-50'
												/>
												<p className="font-medium">No message data yet</p>
											</div>
										</div>
									)}
								</div>
							</div>

							{/* Channel Distribution */}
							<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
								<h3 className="text-lg font-bold text-gray-900 mb-8">
									Channel Distribution
								</h3>
								<div className="h-[300px] w-full relative">
									{data.channels.length > 0 ? (
										<>
											<ResponsiveContainer width="100%" height="100%">
												<PieChart>
													<Pie
														data={data.channels}
														cx='50%'
														cy='50%'
														innerRadius={80}
														outerRadius={100}
														paddingAngle={5}
														dataKey='value'
													>
														{data.channels.map((entry, index) => (
															<Cell
																key={'cell-${index}'}
																fill={
																	entry.color || COLORS[index % COLORS.length]
																}
															/>
														))}
													</Pie>
													<Tooltip />
												</PieChart>
											</ResponsiveContainer>
											<div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
												<p className="text-3xl font-black text-gray-900">
													{data.channels.reduce((a, b) => a + b.value, 0)}
												</p>
												<p className="text-xs font-bold text-gray-400 uppercase">
													Total
												</p>
											</div>
										</>
									) : (
										<div className="h-full flex items-center justify-center text-gray-400">
											<div className='text-center'>
												<BarChart3
													size={32}
													className='mx-auto mb-2 opacity-50'
												/>
												<p className="font-medium">No channel data</p>
											</div>
										</div>
									)}
								</div>
								<div className="mt-8 space-y-3">
									{data.channels.map((ch, i) => (
										<div
											key={i}
											className="flex items-center justify-between text-sm font-bold"
										>
											<div className="flex items-center gap-2">
												<div
													className='w-3 h-3 rounded-full'
													style={{
														backgroundColor:
															ch.color || COLORS[i % COLORS.length],
													}}
												></div>
												<span className="text-gray-600">{ch.name}</span>
											</div>
											<span className="text-gray-900">{ch.value}</span>
										</div>
									))}
								</div>
							</div>
						</div>

						{/* Agent Performance */}
						<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm overflow-hidden">
							<div className="flex items-center justify-between mb-8">
								<h3 className="text-lg font-bold text-gray-900">
									Agent Performance
								</h3>
								<button className="text-emerald-600 font-bold text-sm hover:underline">
									View All Agents
								</button>
							</div>
							{data.agents.length > 0 ? (
								<div className="overflow-x-auto -mx-6">
									<table className="w-full min-w-[600px] text-left">
										<thead className="bg-gray-50/50 text-[10px] font-black uppercase tracking-widest text-gray-400">
											<tr>
												<th className="px-6 py-4">Agent Name</th>
												<th className="px-6 py-4 text-center">Conversations</th>
												<th className="px-6 py-4 text-center">Total Replies</th>
												<th className="px-6 py-4 text-center">Satisfaction</th>
											</tr>
										</thead>
										<tbody className="divide-y divide-gray-50">
											{data.agents.map((agent: any, i: number) => (
												<tr
													key={agent.id || i}
													className="hover:bg-gray-50/50 transition-colors"
												>
													<td className="px-6 py-4 flex items-center gap-3">
														{agent.avatar_url ? (
															<img
																src={agent.avatar_url}
																alt={agent.name}
																className='w-8 h-8 rounded-full object-cover'
															/>
														) : (
															<div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center font-bold text-gray-600 text-xs">
																{agent.name?.charAt(0) || '?'}
															</div>
														)}
														<span className='font-bold text-gray-900'>
															{agent.name}
														</span>
													</td>
													<td className="px-6 py-4 text-center font-bold text-gray-600">
														{agent.convs}
													</td>
													<td className="px-6 py-4 text-center font-bold text-gray-600">
														{agent.replies}
													</td>
													<td className='px-6 py-4 text-center'>
														<div className="flex items-center justify-center gap-1">
															<span className='text-emerald-500 font-bold'>
																{agent.rating > 0
																	? agent.rating.toFixed(1)
																	: '-'}
															</span>
															{agent.rating > 0 && (
																<span className='text-gray-400'>/ 5.0</span>
															)}
														</div>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							) : (
								<div className="py-12 text-center text-gray-400">
									<Users size={32} className="mx-auto mb-2 opacity-50" />
									<p className="font-medium">No agent data available</p>
								</div>
							)}
						</div>
					</div>
				) : (
					<div className="flex-1 flex flex-col items-center justify-center opacity-50 space-y-4 py-20">
						<BarChart3 size={48} className="text-gray-300" />
						<p className="text-gray-500 font-bold text-lg">
							No data available for the selected period
						</p>
					</div>
				)}
			</div>
		</div>
	)
}
