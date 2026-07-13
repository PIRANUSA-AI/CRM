import { useState, useEffect } from 'react'
import { X, User, Mail, Phone, Loader2, Save } from 'lucide-react'
import { contacts } from '@/lib/api'
import { toast } from 'sonner'

interface Customer {
	id: string
	name: string
	email?: string
	phone_number?: string
	pipeline_stage_id?: string
	custom_attributes?: Record<string, any>
}

interface EditCustomerModalProps {
	customer: Customer
	onSave: (data: Partial<Customer>) => Promise<void>
	onClose: () => void
}

export function EditCustomerModal({
	customer,
	onSave,
	onClose,
}: EditCustomerModalProps) {
	const [stageOptions, setStageOptions] = useState<
		Array<{ id: string; name: string; color: string }>
	>([])
	const [fieldDefinitions, setFieldDefinitions] = useState<
		Array<{
			id: string
			fieldKey: string
			fieldLabel: string
			fieldType: string
			options: string[]
			isRequired: boolean
			isVisible: boolean
		}>
	>([])

	const [formData, setFormData] = useState({
		name: customer.name || '',
		email: customer.email || '',
		phone_number: customer.phone_number || '',
		pipeline_stage_id: customer.pipeline_stage_id || '',
		custom_attributes: customer.custom_attributes || {},
	})
	const [isSaving, setIsSaving] = useState(false)
	const [isLoadingSettings, setIsLoadingSettings] = useState(false)
	const [errors, setErrors] = useState<Record<string, string>>({})

	useEffect(() => {
		const loadContactSettings = async () => {
			setIsLoadingSettings(true)
			try {
				const response: any = await contacts.settings.get()
				const payload = response?.payload || {}
				const stages = Array.isArray(payload?.stages?.stages)
					? payload.stages.stages
					: []
				const fields = Array.isArray(payload?.fields) ? payload.fields : []
				setStageOptions(stages)
				setFieldDefinitions(
					fields.map((field: any) => ({
						id: field.id,
						fieldKey: field.fieldKey,
						fieldLabel: field.fieldLabel,
						fieldType: field.fieldType,
						options: Array.isArray(field.options)
							? field.options.filter((opt: unknown) => typeof opt === 'string')
							: [],
						isRequired: !!field.isRequired,
						isVisible: field.isVisible !== false,
					})),
				)
			} catch (error) {
				console.error('Failed to load contact settings:', error)
				toast.error('Failed to load contact settings')
			} finally {
				setIsLoadingSettings(false)
			}
		}

		loadContactSettings()
	}, [])

	const updateCustomAttribute = (key: string, value: any) => {
		setFormData((prev) => ({
			...prev,
			custom_attributes: {
				...(prev.custom_attributes || {}),
				[key]: value,
			},
		}))
	}

	const validateForm = () => {
		const newErrors: Record<string, string> = {}

		if (!formData.name.trim()) {
			newErrors.name = 'Name is required'
		}

		if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
			newErrors.email = 'Invalid email format'
		}

		if (
			formData.phone_number &&
			!/^\+?[\d\s-()]+$/.test(formData.phone_number)
		) {
			newErrors.phone_number = 'Invalid phone number format'
		}

		for (const field of fieldDefinitions) {
			if (!field.isVisible || !field.isRequired) continue
			const value = formData.custom_attributes?.[field.fieldKey]
			const isEmpty =
				value === undefined ||
				value === null ||
				(typeof value === 'string' && value.trim().length === 0) ||
				(Array.isArray(value) && value.length === 0)
			if (isEmpty) {
				newErrors[field.fieldKey] = `${field.fieldLabel} is required`
			}
		}

		setErrors(newErrors)
		return Object.keys(newErrors).length === 0
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!validateForm()) return

		setIsSaving(true)
		try {
			await onSave({
				name: formData.name,
				email: formData.email,
				phone_number: formData.phone_number,
				pipeline_stage_id: formData.pipeline_stage_id || undefined,
				custom_attributes: formData.custom_attributes || {},
			})
			onClose()
		} catch (error) {
			console.error('Failed to save customer:', error)
			alert('Failed to save customer information')
		} finally {
			setIsSaving(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in zoom-in-95 duration-200">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
							<User className="w-5 h-5 text-emerald-600" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-gray-900">
								Edit Customer Info
							</h3>
							<p className="text-xs text-gray-500">Update customer details</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
					>
						<X className="w-5 h-5 text-gray-400" />
					</button>
				</div>

				{/* Form */}
				<form onSubmit={handleSubmit} className="p-6 max-h-[75vh] overflow-y-auto space-y-4">
					{/* Name */}
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-2">
							Name <span className="text-red-500">*</span>
						</label>
						<div className="relative">
							<User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
							<input
								type="text"
								value={formData.name}
								onChange={(e) =>
									setFormData({ ...formData, name: e.target.value })
								}
								className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
									errors.name
										? 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
										: 'border-gray-300 focus:ring-emerald-500/20 focus:border-emerald-500'
								}`}
								placeholder="Enter customer name"
							/>
						</div>
						{errors.name && (
							<p className="mt-1 text-xs text-red-600">{errors.name}</p>
						)}
					</div>

					{/* Email */}
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-2">
							Email
						</label>
						<div className="relative">
							<Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
							<input
								type="email"
								value={formData.email}
								onChange={(e) =>
									setFormData({ ...formData, email: e.target.value })
								}
								className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
									errors.email
										? 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
										: 'border-gray-300 focus:ring-emerald-500/20 focus:border-emerald-500'
								}`}
								placeholder="customer@example.com"
							/>
						</div>
						{errors.email && (
							<p className="mt-1 text-xs text-red-600">{errors.email}</p>
						)}
					</div>

					{/* Phone */}
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-2">
							Phone Number
						</label>
						<div className="relative">
							<Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
							<input
								type="tel"
								value={formData.phone_number}
								onChange={(e) =>
									setFormData({ ...formData, phone_number: e.target.value })
								}
								className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 transition-all ${
									errors.phone_number
										? 'border-red-300 focus:ring-red-500/20 focus:border-red-500'
										: 'border-gray-300 focus:ring-emerald-500/20 focus:border-emerald-500'
								}`}
								placeholder="+62 812 3456 7890"
							/>
						</div>
						{errors.phone_number && (
							<p className="mt-1 text-xs text-red-600">{errors.phone_number}</p>
						)}
					</div>

					{/* Stage */}
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-2">
							Contact Stage
						</label>
						<select
							value={formData.pipeline_stage_id}
							onChange={(event) =>
								setFormData({ ...formData, pipeline_stage_id: event.target.value })
							}
							className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
						>
							<option value="">No stage</option>
							{stageOptions.map((stage) => (
								<option key={stage.id} value={stage.id}>
									{stage.name}
								</option>
							))}
						</select>
					</div>

					{/* Dynamic Additional Fields */}
					{fieldDefinitions.filter((field) => field.isVisible).length > 0 && (
						<div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
							<div className="text-sm font-semibold text-gray-800">
								Additional Fields
							</div>
							{fieldDefinitions
								.filter((field) => field.isVisible)
								.map((field) => {
									const fieldValue = formData.custom_attributes?.[field.fieldKey]
									return (
										<div key={field.id}>
											<label className="block text-sm font-medium text-gray-700 mb-2">
												{field.fieldLabel}
												{field.isRequired && (
													<span className="text-red-500 ml-1">*</span>
												)}
											</label>
											{field.fieldType === 'dropdown' ? (
												<select
													value={typeof fieldValue === 'string' ? fieldValue : ''}
													onChange={(event) =>
														updateCustomAttribute(field.fieldKey, event.target.value)
													}
													className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
												>
													<option value="">Select option</option>
													{field.options.map((option) => (
														<option key={option} value={option}>
															{option}
														</option>
													))}
												</select>
											) : field.fieldType === 'number' ? (
												<input
													type="number"
													value={
														typeof fieldValue === 'number'
															? fieldValue
															: typeof fieldValue === 'string'
																? fieldValue
																: ''
													}
													onChange={(event) =>
														updateCustomAttribute(
															field.fieldKey,
															event.target.value === ''
																? ''
																: Number(event.target.value),
														)
													}
													className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
												/>
											) : field.fieldType === 'date' ? (
												<input
													type="date"
													value={typeof fieldValue === 'string' ? fieldValue : ''}
													onChange={(event) =>
														updateCustomAttribute(field.fieldKey, event.target.value)
													}
													className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
												/>
											) : field.fieldType === 'checkbox' ? (
												<label className="inline-flex items-center gap-2 text-sm text-gray-700">
													<input
														type="checkbox"
														checked={Boolean(fieldValue)}
														onChange={(event) =>
															updateCustomAttribute(
																field.fieldKey,
																event.target.checked,
															)
														}
													/>
													{field.fieldLabel}
												</label>
											) : (
												<input
													type="text"
													value={typeof fieldValue === 'string' ? fieldValue : ''}
													onChange={(event) =>
														updateCustomAttribute(field.fieldKey, event.target.value)
													}
													className="w-full px-3 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500"
												/>
											)}
											{errors[field.fieldKey] && (
												<p className="mt-1 text-xs text-red-600">
													{errors[field.fieldKey]}
												</p>
											)}
										</div>
									)
								})}
						</div>
					)}

					{/* Info Box */}
					<div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
						<p className="text-xs text-blue-700">
							<strong>Note:</strong> Changes will be reflected across all
							conversations with this customer.
						</p>
					</div>

					{/* Actions */}
					<div className="flex gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={isSaving || isLoadingSettings}
							className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						>
							{isSaving ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Saving...</span>
								</>
							) : (
								<>
									<Save className="w-4 h-4" />
									<span>Save Changes</span>
								</>
							)}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
