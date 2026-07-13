import { useState, useEffect } from 'react'
import {
	Book,
	Plus,
	Search,
	Globe,
	FileText,
	Database,
	Trash2,
	Edit2,
	Layout,
	ExternalLink,
	Brain,
} from 'lucide-react'
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

interface KnowledgeSource {
	id: string
	title: string
	content: string
	type: 'text' | 'pdf' | 'website'
	category_id?: string
	created_at: string
}

interface Category {
	id: string
	name: string
	description: string
	source_count: number
	faq_count: number
}

export default function KnowledgeManager() {
	const [sources, setSources] = useState<KnowledgeSource[]>([])
	const [categories, setCategories] = useState<Category[]>([])
	const [loading, setLoading] = useState(true)
	const [activeTab, setActiveTab] = useState<'sources' | 'categories' | 'faqs'>(
		'sources',
	)
	const [searchQuery, setSearchQuery] = useState('')

	const token = localStorage.getItem('scalechat_token')

	const fetchData = async () => {
		try {
			const [sourcesRes, catsRes] = await Promise.all([
				fetch('/api/knowledge/sources', {
					headers: { Authorization: `Bearer ${token}` },
				}),
				fetch('/api/knowledge/categories', {
					headers: { Authorization: `Bearer ${token}` },
				}),
			])

			const sourcesData = await sourcesRes.json()
			const catsData = await catsRes.json()

			if (sourcesData.success) setSources(sourcesData.data || [])
			if (catsData.success) setCategories(catsData.payload || [])
		} catch (error) {
			console.error('Failed to fetch knowledge data:', error)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		fetchData()
	}, [])

	const handleDeleteSource = async (id: string) => {
		if (!confirm('Are you sure you want to delete this source?')) return
		try {
			const res = await fetch(`/api/knowledge/sources/${id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			if (res.ok) {
				setSources(sources.filter((s) => s.id !== id))
				toast.success('Source deleted')
			}
		} catch (error) {
			toast.error('Delete failed')
		}
	}

	return (
		<div className="space-y-6">
			<div className="flex items-center justify-between">
				<div className="flex bg-gray-100 p-1 rounded-lg">
					<button
						onClick={() => setActiveTab('sources')}
						className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'sources' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
					>
						Sources
					</button>
					<button
						onClick={() => setActiveTab('categories')}
						className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'categories' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
					>
						Categories
					</button>
					<button
						onClick={() => setActiveTab('faqs')}
						className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all ${activeTab === 'faqs' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
					>
						FAQs
					</button>
				</div>
				<div className="flex gap-2">
					<div className="relative">
						<Search
							className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
							size={14}
						/>
						<Input
							placeholder="Search..."
							className="h-8 pl-9 text-xs w-48 rounded-lg border-gray-200"
							value={searchQuery}
							onChange={(e) => setSearchQuery(e.target.value)}
						/>
					</div>
					<Button
						size="sm"
						className="h-8 bg-emerald-500 hover:bg-emerald-600 font-bold text-xs"
					>
						<Plus size={14} className="mr-1" /> Add {activeTab.slice(0, -1)}
					</Button>
				</div>
			</div>

			{activeTab === 'sources' && (
				<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
					{loading ? (
						<div className="col-span-2 py-20 text-center text-gray-400">
							Loading sources...
						</div>
					) : sources.length === 0 ? (
						<div className="col-span-2 py-20 text-center bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
							<Book size={48} className="mx-auto mb-4 opacity-10" />
							<p className="text-sm font-medium text-gray-900">
								No Knowledge Sources
							</p>
							<p className="text-xs text-gray-500 mt-1">
								Upload files or crawl websites to train your AI.
							</p>
						</div>
					) : (
						sources.map((source) => (
							<Card
								key={source.id}
								className="border-gray-100 shadow-sm hover:border-emerald-200 transition group"
							>
								<CardContent className="p-5">
									<div className="flex items-start justify-between">
										<div className="flex items-center gap-3">
											<div className="w-10 h-10 rounded-xl bg-gray-50 flex items-center justify-center text-emerald-600 border border-gray-100 group-hover:bg-emerald-50 transition">
												{source.type === 'website' ? (
													<Globe size={20} />
												) : (
													<FileText size={20} />
												)}
											</div>
											<div>
												<h4 className="text-sm font-bold text-gray-900">
													{source.title}
												</h4>
												<p className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mt-0.5">
													{source.type}
												</p>
											</div>
										</div>
										<div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
											<Button
												variant="ghost"
												size="sm"
												className="h-8 w-8 p-0 text-gray-400 hover:text-emerald-600"
											>
												<Edit2 size={14} />
											</Button>
											<Button
												variant="ghost"
												size="sm"
												className="h-8 w-8 p-0 text-gray-400 hover:text-red-600"
												onClick={() => handleDeleteSource(source.id)}
											>
												<Trash2 size={14} />
											</Button>
										</div>
									</div>
									<div className="mt-4 flex items-center justify-between text-[11px] text-gray-400">
										<span>
											Added {new Date(source.created_at).toLocaleDateString()}
										</span>
										<div className="flex items-center gap-1.5 text-emerald-600 font-bold">
											<Brain size={12} />
											<span>Ready for AI</span>
										</div>
									</div>
								</CardContent>
							</Card>
						))
					)}
				</div>
			)}

			{activeTab === 'categories' && (
				<Card className="border-gray-100 shadow-sm">
					<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
						<CardTitle className="text-sm font-bold">
							Knowledge Categories
						</CardTitle>
						<CardDescription className="text-xs">
							Organize your knowledge base into logical sections
						</CardDescription>
					</CardHeader>
					<CardContent className="p-0">
						<div className="divide-y divide-gray-100">
							{categories.length === 0 ? (
								<div className="p-12 text-center text-gray-400 text-sm">
									No categories found.
								</div>
							) : (
								categories.map((cat) => (
									<div
										key={cat.id}
										className="p-4 flex items-center justify-between hover:bg-gray-50/50 transition"
									>
										<div className="flex items-center gap-3">
											<div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400">
												<Layout size={16} />
											</div>
											<div>
												<p className="text-sm font-bold text-gray-900">
													{cat.name}
												</p>
												<p className="text-xs text-gray-500">
													{cat.description || 'No description'}
												</p>
											</div>
										</div>
										<div className="flex items-center gap-6">
											<div className="flex gap-4">
												<div className="flex flex-col items-center">
													<span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
														Sources
													</span>
													<span className="text-xs font-bold text-gray-700">
														{cat.source_count}
													</span>
												</div>
												<div className="flex flex-col items-center">
													<span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
														FAQs
													</span>
													<span className="text-xs font-bold text-gray-700">
														{cat.faq_count}
													</span>
												</div>
											</div>
											<Button
												variant="ghost"
												size="sm"
												className="h-8 w-8 p-0 text-gray-400"
											>
												<Edit2 size={14} />
											</Button>
										</div>
									</div>
								))
							)}
						</div>
					</CardContent>
				</Card>
			)}

			<Card className="border-gray-100 shadow-sm overflow-hidden bg-emerald-50/30">
				<CardContent className="p-6">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-4">
							<div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600">
								<Brain size={24} className="animate-pulse" />
							</div>
							<div>
								<h4 className="text-sm font-bold text-gray-900">
									AI Synchonization
								</h4>
								<p className="text-xs text-gray-600">
									Your AI model is currently training on the updated knowledge
									base.
								</p>
							</div>
						</div>
						<div className="text-right">
							<p className="text-[10px] font-black text-emerald-600 uppercase tracking-widest mb-1">
								Status: Training
							</p>
							<div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
								<div className="h-full bg-emerald-500 w-[65%] rounded-full" />
							</div>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	)
}
