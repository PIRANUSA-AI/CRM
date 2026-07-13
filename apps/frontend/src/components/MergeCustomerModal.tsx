import { useState, useEffect } from 'react'
import {
	X,
	Search,
	User,
	Merge,
	AlertTriangle,
	Loader2,
	ArrowRight,
} from 'lucide-react'
import { contacts } from '@/lib/api'

interface Contact {
	id: string
	name: string
	email: string
	phone_number: string
	avatar_url?: string
	identifier: string
	channel_type: string
}

interface MergeCustomerModalProps {
	sourceContactId: string
	sourceContactName: string
	onClose: () => void
	onSuccess: () => void
}

export function MergeCustomerModal({
	sourceContactId,
	sourceContactName,
	onClose,
	onSuccess,
}: MergeCustomerModalProps) {
	const [step, setStep] = useState<1 | 2>(1) // 1: Select Target, 2: Confirm
	const [searchQuery, setSearchQuery] = useState('')
	const [searchResults, setSearchResults] = useState<Contact[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [isMerging, setIsMerging] = useState(false)
	const [selectedTarget, setSelectedTarget] = useState<Contact | null>(null)

	// Debounced search
	useEffect(() => {
		const timer = setTimeout(() => {
			if (searchQuery.trim().length >= 2) {
				performSearch()
			} else {
				setSearchResults([])
			}
		}, 500)

		return () => clearTimeout(timer)
	}, [searchQuery])

	const performSearch = async () => {
		setIsLoading(true)
		try {
			const res: any = await contacts.list({
				search: searchQuery,
				per_page: 5,
			})
			if (res.payload) {
				// Filter out the source contact itself
				setSearchResults(
					res.payload.filter((c: Contact) => c.id !== sourceContactId),
				)
			}
		} catch (error) {
			console.error('Search failed:', error)
		} finally {
			setIsLoading(false)
		}
	}

	const handleMerge = async () => {
		if (!selectedTarget) return
		setIsMerging(true)
		try {
			await contacts.merge(sourceContactId, selectedTarget.id)
			onSuccess()
			onClose()
			alert('Contacts merged successfully')
		} catch (error) {
			console.error('Merge failed:', error)
			alert('Failed to merge contacts')
		} finally {
			setIsMerging(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
							<Merge className="w-5 h-5 text-purple-600" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-gray-900">
								Merge Customer
							</h3>
							<p className="text-xs text-gray-500">
								Combine duplicate customer records
							</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
					>
						<X className="w-5 h-5 text-gray-500" />
					</button>
				</div>

				{/* Content */}
				<div className="p-6">
					{step === 1 ? (
						<div className="space-y-4">
							<p className="text-sm text-gray-600">
								Select the customer you want to merge{' '}
								<strong>{sourceContactName}</strong> into. This will move all
								conversations to the target customer.
							</p>

							<div className="relative">
								<Search className="absolute left-3 top-3 w-5 h-5 text-gray-400" />
								<input
									type="text"
									placeholder="Search by name, email, or phone..."
									className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 outline-none transition-all"
									value={searchQuery}
									onChange={(e) => setSearchQuery(e.target.value)}
									autoFocus
								/>
							</div>

							<div className="min-h-[200px] border rounded-lg overflow-hidden bg-gray-50/50">
								{isLoading ? (
									<div className="flex justify-center items-center h-40">
										<Loader2 className="w-6 h-6 text-purple-600 animate-spin" />
										<span className="ml-2 text-sm text-gray-500">
											Searching...
										</span>
									</div>
								) : searchResults.length > 0 ? (
									<div className="divide-y divide-gray-200">
										{searchResults.map((contact) => (
											<button
												key={contact.id}
												onClick={() => {
													setSelectedTarget(contact)
													setStep(2)
												}}
												className="w-full text-left p-3 hover:bg-purple-50 transition-colors flex items-center justify-between group"
											>
												<div className="flex items-center gap-3">
													<div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
														{contact.avatar_url ? (
															<img
																src={contact.avatar_url}
																alt=""
																className="w-full h-full rounded-full object-cover"
															/>
														) : (
															<User className="w-5 h-5 text-gray-400" />
														)}
													</div>
													<div>
														<p className="font-medium text-gray-900">
															{contact.name || 'Unknown'}
														</p>
														<p className="text-xs text-gray-500">
															{contact.email ||
																contact.phone_number ||
																contact.identifier}
														</p>
													</div>
												</div>
												<ArrowRight className="w-4 h-4 text-gray-300 group-hover:text-purple-600" />
											</button>
										))}
									</div>
								) : searchQuery.length >= 2 ? (
									<div className="flex flex-col items-center justify-center h-40 text-gray-400">
										<User className="w-8 h-8 mb-2 opacity-50" />
										<p className="text-sm">No customers found</p>
									</div>
								) : (
									<div className="flex flex-col items-center justify-center h-40 text-gray-400">
										<Search className="w-8 h-8 mb-2 opacity-50" />
										<p className="text-sm">Type to search existing customers</p>
									</div>
								)}
							</div>
						</div>
					) : (
						<div className="space-y-6">
							<div className="bg-red-50 border border-red-100 rounded-lg p-4 flex gap-3">
								<AlertTriangle className="w-6 h-6 text-red-600 flex-shrink-0" />
								<div>
									<h4 className="text-sm font-bold text-red-800">
										Warning: Destructive Action
									</h4>
									<p className="text-sm text-red-700 mt-1">
										You are about to merge <strong>{sourceContactName}</strong>{' '}
										into <strong>{selectedTarget?.name}</strong>.
									</p>
									<ul className="list-disc list-inside text-xs text-red-600 mt-2 space-y-1">
										<li>
											All conversations will be moved to the target customer.
										</li>
										<li>
											<strong>{sourceContactName}</strong> will be permanently
											deleted.
										</li>
										<li>This action cannot be undone.</li>
									</ul>
								</div>
							</div>

							<div className="flex items-center gap-4 justify-center py-4">
								<div className="text-center">
									<div className="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-2 opacity-50">
										<User className="w-7 h-7 text-gray-500" />
									</div>
									<p className="text-sm font-medium text-gray-500 line-through">
										{sourceContactName}
									</p>
								</div>

								<ArrowRight className="w-6 h-6 text-purple-600" />

								<div className="text-center">
									<div className="w-14 h-14 rounded-full bg-purple-100 flex items-center justify-center mx-auto mb-2 border-2 border-purple-200">
										{selectedTarget?.avatar_url ? (
											<img
												src={selectedTarget.avatar_url}
												alt=""
												className="w-full h-full rounded-full object-cover"
											/>
										) : (
											<User className="w-7 h-7 text-purple-600" />
										)}
									</div>
									<p className="text-sm font-bold text-gray-900">
										{selectedTarget?.name}
									</p>
								</div>
							</div>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-3 flex-shrink-0">
					<button
						onClick={step === 1 ? onClose : () => setStep(1)}
						className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
					>
						{step === 1 ? 'Cancel' : 'Back'}
					</button>

					{step === 2 && (
						<button
							onClick={handleMerge}
							disabled={isMerging}
							className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 rounded-lg transition-colors flex items-center gap-2"
						>
							{isMerging && <Loader2 className="w-4 h-4 animate-spin" />}
							Convert & Merge
						</button>
					)}
				</div>
			</div>
		</div>
	)
}
