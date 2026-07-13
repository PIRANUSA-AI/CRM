import { useState } from 'react'
import { X, Save } from 'lucide-react'
import { Button } from './ui/button'
import { Input } from './ui/input'

interface CreateVariableModalProps {
	onClose: () => void
	onSuccess: (data: any) => void
}

export function CreateVariableModal({
	onClose,
	onSuccess,
}: CreateVariableModalProps) {
	const [name, setName] = useState('')
	const [value, setValue] = useState('')
	const [fallback, setFallback] = useState('')
	const [category, setCategory] = useState('custom')
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setLoading(true)
		setError('')

		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'

			const res = await fetch(`${API_URL}/api/template-variables`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					name,
					value,
					fallback_value: fallback,
					category,
				}),
			})

			const data = await res.json()

			if (data.error) {
				throw new Error(data.error)
			}

			onSuccess(data.data)
		} catch (e: any) {
			setError(e.message)
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/50 backdrop-blur-sm animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden">
				<div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
					<h2 className="text-lg font-semibold text-gray-900">
						Create Variable
					</h2>
					<button
						onClick={onClose}
						className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
					>
						<X size={20} />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="p-6 space-y-4">
					{error && (
						<div className="p-3 bg-red-50 text-red-600 text-sm rounded-lg mb-4">
							{error}
						</div>
					)}

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Variable Name
						</label>
						<Input
							value={name}
							onChange={(e) =>
								setName(
									e.target.value.replace(/[^a-zA-Z0-9_]/g, '').toLowerCase(),
								)
							}
							placeholder="e.g. customer_name"
							className="font-mono text-sm"
							required
						/>
						<p className="text-xs text-gray-500 mt-1">
							Snake_case only. Used as identifier.
						</p>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Category
						</label>
						<select
							value={category}
							onChange={(e) => setCategory(e.target.value)}
							className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
						>
							<option value="custom">Custom</option>
							<option value="contact">Contact Attribute</option>
							<option value="system">System</option>
						</select>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Map to Value
						</label>
						<Input
							value={value}
							onChange={(e) => setValue(e.target.value)}
							placeholder="e.g. {{contact.name}} or Static Value"
							required
						/>
						<p className="text-xs text-gray-500 mt-1">
							The value this variable resolves to.
						</p>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Fallback Value (Optional)
						</label>
						<Input
							value={fallback}
							onChange={(e) => setFallback(e.target.value)}
							placeholder="e.g. Valued Customer"
						/>
						<p className="text-xs text-gray-500 mt-1">
							Used if the mapped value is missing.
						</p>
					</div>

					<div className="pt-4 flex justify-end gap-2">
						<Button type="button" variant="outline" onClick={onClose}>
							Cancel
						</Button>
						<Button type="submit" disabled={loading}>
							{loading ? 'Creating...' : 'Create Variable'}
						</Button>
					</div>
				</form>
			</div>
		</div>
	)
}
