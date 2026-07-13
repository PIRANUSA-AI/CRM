import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
	LayoutTemplate,
	Plus,
	RefreshCw,
	Braces,
	Search,
	Filter,
	Trash2,
} from 'lucide-react'
import PageHeader from '@/components/PageHeader'
import { CreateTemplateModal } from '@/components/CreateTemplateModal'
import { CreateVariableModal } from '@/components/CreateVariableModal'

export const Route = createFileRoute('/_app/templates')({
	component: TemplatesPage,
})

function TemplatesPage() {
	const [activeTab, setActiveTab] = useState<'templates' | 'variables'>(
		'templates',
	)
	const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
	const [isVariableModalOpen, setIsVariableModalOpen] = useState(false)
	const [templates, setTemplates] = useState<any[]>([])
	const [variables, setVariables] = useState<any[]>([])
	const [loading, setLoading] = useState(false)

	const fetchTemplates = async () => {
		setLoading(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
			const res = await fetch(`${API_URL}/api/whatsapp/templates?limit=50`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success) {
				setTemplates(data.data || [])
			}
		} catch (e) {
			console.error('Failed to fetch templates', e)
		} finally {
			setLoading(false)
		}
	}

	const fetchVariables = async () => {
		setLoading(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
			const res = await fetch(`${API_URL}/api/template-variables`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success) {
				setVariables(data.data || [])
			}
		} catch (e) {
			console.error('Failed to fetch variables', e)
		} finally {
			setLoading(false)
		}
	}

	const deleteVariable = async (id: string) => {
		if (!confirm('Are you sure you want to delete this variable?')) return
		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
			await fetch(`${API_URL}/api/template-variables/${id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			fetchVariables()
		} catch (e) {
			alert('Failed to delete variable')
		}
	}

	const handleDelete = async (name: string) => {
		if (
			!confirm(
				`Are you sure you want to delete template "${name}"? This cannot be undone.`,
			)
		)
			return

		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
			const res = await fetch(
				`${API_URL}/api/whatsapp/templates?name=${name}`,
				{
					method: 'DELETE',
					headers: { Authorization: `Bearer ${token}` },
				},
			)

			const data = await res.json()

			if (res.ok && data.success) {
				fetchTemplates()
			} else {
				alert('Failed to delete: ' + (data.error || 'Unknown error'))
			}
		} catch (e) {
			console.error(e)
			alert('Failed to delete template')
		}
	}

	useEffect(() => {
		if (activeTab === 'templates') {
			fetchTemplates()
		} else {
			fetchVariables()
		}
	}, [activeTab])

	const actions = (
		<div className="flex flex-wrap sm:flex-nowrap gap-2 lg:gap-3 w-full lg:w-auto">
			{activeTab === 'templates' ? (
				<>
					<button
						className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
						onClick={fetchTemplates}
						disabled={loading}
					>
						<RefreshCw
							size={16}
							className={loading ? 'animate-spin' : ''}
						/>
						Sync
					</button>
					<button
						className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"
						onClick={() => setIsCreateModalOpen(true)}
					>
						<Plus size={18} />
						Create
					</button>
				</>
			) : (
				<button
					className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"
					onClick={() => setIsVariableModalOpen(true)}
				>
					<Plus size={18} />
					Create Variable
				</button>
			)}
		</div>
	)

		return (
			<div className="flex-1 flex flex-col h-full bg-background overflow-hidden">
			<div className="flex-1 flex flex-col overflow-hidden">
				<PageHeader
					title="Templates"
					description={`Create and manage WhatsApp message templates ${activeTab === 'variables' ? 'and variables' : ''} for your business`}
					icon={<LayoutTemplate size={24} />}
					actions={actions}
				/>

				<div className="px-4 lg:px-8 mb-4">
					<div
						role='tablist'
						aria-orientation="horizontal"
						className="bg-gray-100 text-gray-500 inline-flex h-10 items-center justify-center rounded-lg p-1 w-full lg:w-auto"
						style={{ outline: 'none' }}
					>
						<button
							type='button'
							role='tab'
							aria-selected={activeTab === 'templates'}
							onClick={() => setActiveTab('templates')}
							className={`flex-1 lg:flex-none ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
								activeTab === 'templates'
									? 'bg-white text-gray-950 shadow-sm'
									: 'hover:text-gray-900'
							}`}
						>
							<LayoutTemplate className="h-4 w-4" />
							Templates
						</button>
						<button
							type='button'
							role='tab'
							aria-selected={activeTab === 'variables'}
							onClick={() => setActiveTab('variables')}
							className={`flex-1 lg:flex-none ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
								activeTab === 'variables'
									? 'bg-white text-gray-950 shadow-sm'
									: 'hover:text-gray-900'
							}`}
						>
							<Braces className="h-4 w-4" />
							Variable Library
						</button>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-4 lg:p-8 pt-0 lg:pt-0">
					{activeTab === 'templates' ? (
						<div className="space-y-4">
							{templates.length === 0 ? (
								<div className="bg-white rounded-xl border border-dashed border-gray-300 py-16 transition-all duration-300 hover:border-emerald-500/30">
									<div className="flex flex-col items-center justify-center text-center">
										<LayoutTemplate className="text-gray-400 mb-4 h-12 w-12" />
										<h3 className="mb-2 text-lg font-semibold text-gray-900">
											No templates yet
										</h3>
										<p className="text-muted-foreground mb-4 text-center text-sm max-w-sm">
											Create your first WhatsApp message template to start
											sending messages
										</p>
										<div className="flex items-center gap-2">
											<button
												className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm disabled:opacity-50"
												onClick={fetchTemplates}
												disabled={loading}
											>
												<RefreshCw
													className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
												/>
												Sync from Meta
											</button>
											<button
												className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"
												onClick={() => setIsCreateModalOpen(true)}
											>
												<Plus className="h-3.5 w-3.5" />
												Create Template
											</button>
										</div>
									</div>
								</div>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
									{templates.map((template: any) => (
										<div
											key={template.id}
											className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition"
										>
											<div className="flex justify-between items-start mb-2">
												<h3
													className="font-semibold text-gray-900 truncate pr-2"
													title={template.name}
												>
													{template.name}
												</h3>
												<span
													className={`text-xs px-2 py-0.5 rounded-full font-medium ${
														template.status === 'APPROVED'
															? 'bg-green-100 text-green-700'
															: template.status === 'REJECTED'
																? 'bg-red-100 text-red-700'
																: 'bg-yellow-100 text-yellow-700'
													}`}
												>
													{template.status}
												</span>
											</div>
											<div className="flex items-center gap-2 text-xs text-gray-500 mb-3">
												<span className="bg-gray-100 px-1.5 py-0.5 rounded uppercase">
													{template.language}
												</span>
												<span>•</span>
												<span>{template.category}</span>
											</div>

											{/* Preview Body */}
											<div className="text-sm text-gray-600 bg-gray-50 p-2 rounded line-clamp-3 mb-3 h-16">
												{template.components.find((c: any) => c.type === 'BODY')
													?.text || 'No text body'}
											</div>

											<div className="flex justify-between items-center mt-2">
												<span className="text-xs text-gray-400">
													ID: {template.id}
												</span>
												<button
													onClick={() => handleDelete(template.name)}
													className="text-gray-400 hover:text-red-500 transition p-1"
													title='Delete Template'
												>
													<Trash2 size={14} />
												</button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					) : (
						<div className="space-y-4">
							<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
								<div className="flex flex-col gap-2 sm:flex-row sm:items-center flex-1">
									<div className="relative flex-1 max-w-sm">
										<Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 h-4 w-4" />
										<input
											className="border-gray-200 flex h-9 w-full rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-gray-500 focus-visible:ring-1 focus-visible:ring-emerald-500 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 pl-9"
											placeholder='Search variables...'
										/>
									</div>
									<button className="border-gray-200 focus:ring-emerald-500 flex h-9 items-center justify-between rounded-md border bg-transparent px-3 py-1 text-sm shadow-sm focus:ring-1 disabled:cursor-not-allowed disabled:opacity-50 sm:w-[160px]">
										<div className="flex items-center">
											<Filter className="h-4 w-4 mr-2" />
											<span>All Types</span>
										</div>
									</button>
								</div>
							</div>

							{variables.length === 0 ? (
								<div className="bg-white rounded-xl border border-dashed border-gray-300 py-16">
									<div className="flex flex-col items-center justify-center text-center">
										<Braces className="text-gray-400 mb-4 h-12 w-12" />
										<h3 className="mb-2 text-lg font-semibold text-gray-900">
											No variables yet
										</h3>
										<p className="text-gray-500 mb-6 text-sm">
											Create your first variable to start personalizing your
											templates
										</p>
										<button
											className="flex items-center justify-center gap-2 px-3 py-1.5 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors shadow-sm mt-2"
											onClick={() => setIsVariableModalOpen(true)}
										>
											<Plus className='h-4 w-4' />
											Create Variable
										</button>
									</div>
								</div>
							) : (
								<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
									{variables.map((variable: any) => (
										<div
											key={variable.id}
											className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition group"
										>
											<div className="flex justify-between items-start mb-2">
												<h3
													className="font-mono font-semibold text-emerald-600 truncate pr-2"
													title={variable.name}
												>
													{'{{${variable.name}}}'}
												</h3>
												<span className="text-xs px-2 py-0.5 rounded-full font-medium bg-gray-100 text-gray-600 capitalize">
													{variable.category}
												</span>
											</div>

											<div className='space-y-1 mb-3'>
												<div className='text-sm'>
													<span className="text-gray-400 text-xs uppercase font-bold mr-2">
														Value:
													</span>
													<span className="text-gray-900 font-medium truncate block">
														{variable.value}
													</span>
												</div>
												{variable.fallback_value && (
													<div className='text-sm'>
														<span className="text-gray-400 text-xs uppercase font-bold mr-2">
															Fallback:
														</span>
														<span className="text-gray-600 italic truncate block">
															{variable.fallback_value}
														</span>
													</div>
												)}
											</div>

											<div className="flex justify-end items-center mt-2 border-t pt-2 border-gray-50">
												<button
													onClick={() => deleteVariable(variable.id)}
													className="text-gray-400 hover:text-red-500 transition p-1 opacity-0 group-hover:opacity-100"
													title='Delete Variable'
												>
													<Trash2 size={14} />
												</button>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</div>
			</div>
			{isCreateModalOpen && (
				<CreateTemplateModal
					onClose={() => setIsCreateModalOpen(false)}
					onSuccess={(data) => {
						console.log('Template created:', data)
						fetchTemplates()
						setIsCreateModalOpen(false)
					}}
				/>
			)}
			{isVariableModalOpen && (
				<CreateVariableModal
					onClose={() => setIsVariableModalOpen(false)}
					onSuccess={() => {
						fetchVariables()
						setIsVariableModalOpen(false)
					}}
				/>
			)}
		</div>
	)
}
