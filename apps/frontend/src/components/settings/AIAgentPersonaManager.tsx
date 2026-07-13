import { useEffect, useMemo, useState } from 'react'
import { Bot, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ai } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type AgentTypeId = 'ai_sales' | 'ai_support' | 'ai_general'

type AgentTypeOption = {
	id: AgentTypeId
	label: string
}

type PersonaItem = {
	id: string
	label: string
	systemInstruction: string
	agentType: AgentTypeId
	isDefault: boolean
	isDefaultForType: boolean
}

type PersonaPayload = {
	agentTypes: AgentTypeOption[]
	personas: PersonaItem[]
}

function extractData<T>(response: unknown): T {
	const wrapped = response as { payload?: T; data?: T }
	if (wrapped?.payload !== undefined) return wrapped.payload
	if (wrapped?.data !== undefined) return wrapped.data
	return response as T
}

const FALLBACK_AGENT_TYPES: AgentTypeOption[] = [
	{ id: 'ai_sales', label: 'AI Sales' },
	{ id: 'ai_support', label: 'AI Support' },
	{ id: 'ai_general', label: 'AI General' },
]

export default function AIAgentPersonaManager() {
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [agentTypes, setAgentTypes] =
		useState<AgentTypeOption[]>(FALLBACK_AGENT_TYPES)
	const [personas, setPersonas] = useState<PersonaItem[]>([])

	const [newAgentType, setNewAgentType] = useState<AgentTypeId>('ai_general')
	const [newLabel, setNewLabel] = useState('')
	const [newSystemInstruction, setNewSystemInstruction] = useState('')
	const [newIsTypeDefault, setNewIsTypeDefault] = useState(false)
	const [newIsGlobalDefault, setNewIsGlobalDefault] = useState(false)

	const [editingId, setEditingId] = useState<string | null>(null)
	const [editingAgentType, setEditingAgentType] =
		useState<AgentTypeId>('ai_general')
	const [editingLabel, setEditingLabel] = useState('')
	const [editingSystemInstruction, setEditingSystemInstruction] = useState('')

	const personasByType = useMemo(() => {
		const grouped: Record<AgentTypeId, PersonaItem[]> = {
			ai_sales: [],
			ai_support: [],
			ai_general: [],
		}
		for (const persona of personas) {
			grouped[persona.agentType]?.push(persona)
		}
		return grouped
	}, [personas])

	const hasDefaultForType = useMemo(() => {
		return (agentType: AgentTypeId) =>
			(personasByType[agentType] || []).some((persona) => persona.isDefaultForType)
	}, [personasByType])

	const loadPersonas = async () => {
		setLoading(true)
		try {
			const response = await ai.getPlaygroundPersonas()
			const payload = extractData<PersonaPayload>(response)
			const nextAgentTypes =
				Array.isArray(payload?.agentTypes) && payload.agentTypes.length > 0
					? payload.agentTypes
					: FALLBACK_AGENT_TYPES
			setAgentTypes(nextAgentTypes)
			setPersonas(Array.isArray(payload?.personas) ? payload.personas : [])
		} catch (error) {
			console.error('Failed to load AI personas:', error)
			toast.error(`Failed to load AI personas: ${(error as Error | null)?.message || 'Unknown error'}`)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		void loadPersonas()
	}, [])

	const resetCreateForm = () => {
		setNewAgentType('ai_general')
		setNewLabel('')
		setNewSystemInstruction('')
		setNewIsTypeDefault(false)
		setNewIsGlobalDefault(false)
	}

	const submitCreate = async () => {
		if (!newLabel.trim()) {
			toast.error('Persona label is required')
			return
		}
		if (!newSystemInstruction.trim()) {
			toast.error('System instruction is required')
			return
		}

		setSaving(true)
		try {
			const shouldSetTypeDefault =
				newIsTypeDefault || !hasDefaultForType(newAgentType)
			const response = await ai.createPlaygroundPersona({
				label: newLabel.trim(),
				systemInstruction: newSystemInstruction.trim(),
				agentType: newAgentType,
				setAsDefaultForType: shouldSetTypeDefault,
				setAsGlobalDefault: newIsGlobalDefault,
			})
			const payload = extractData<PersonaPayload>(response)
			setAgentTypes(
				Array.isArray(payload?.agentTypes) && payload.agentTypes.length > 0
					? payload.agentTypes
					: FALLBACK_AGENT_TYPES,
			)
			setPersonas(Array.isArray(payload?.personas) ? payload.personas : [])
			resetCreateForm()
			toast.success('Persona created')
		} catch (error: any) {
			console.error('Failed to create persona:', error)
			toast.error(error?.message || 'Failed to create persona')
		} finally {
			setSaving(false)
		}
	}

	const startEdit = (persona: PersonaItem) => {
		setEditingId(persona.id)
		setEditingAgentType(persona.agentType)
		setEditingLabel(persona.label)
		setEditingSystemInstruction(persona.systemInstruction)
	}

	const cancelEdit = () => {
		setEditingId(null)
		setEditingAgentType('ai_general')
		setEditingLabel('')
		setEditingSystemInstruction('')
	}

	const submitEdit = async (personaId: string) => {
		if (!editingLabel.trim()) {
			toast.error('Persona label is required')
			return
		}
		if (!editingSystemInstruction.trim()) {
			toast.error('System instruction is required')
			return
		}

		setSaving(true)
		try {
			const response = await ai.updatePlaygroundPersona(personaId, {
				label: editingLabel.trim(),
				systemInstruction: editingSystemInstruction.trim(),
				agentType: editingAgentType,
			})
			const payload = extractData<PersonaPayload>(response)
			setAgentTypes(
				Array.isArray(payload?.agentTypes) && payload.agentTypes.length > 0
					? payload.agentTypes
					: FALLBACK_AGENT_TYPES,
			)
			setPersonas(Array.isArray(payload?.personas) ? payload.personas : [])
			cancelEdit()
			toast.success('Persona updated')
		} catch (error: any) {
			console.error('Failed to update persona:', error)
			toast.error(error?.message || 'Failed to update persona')
		} finally {
			setSaving(false)
		}
	}

	const setDefaultForType = async (personaId: string) => {
		setSaving(true)
		try {
			const response = await ai.updatePlaygroundPersona(personaId, {
				setAsDefaultForType: true,
			})
			const payload = extractData<PersonaPayload>(response)
			setPersonas(Array.isArray(payload?.personas) ? payload.personas : [])
			toast.success('Default persona for agent type updated')
		} catch (error: any) {
			console.error('Failed to update default persona by type:', error)
			toast.error(error?.message || 'Failed to update default persona')
		} finally {
			setSaving(false)
		}
	}

	const setGlobalDefault = async (personaId: string) => {
		setSaving(true)
		try {
			const response = await ai.updatePlaygroundPersona(personaId, {
				setAsGlobalDefault: true,
			})
			const payload = extractData<PersonaPayload>(response)
			setPersonas(Array.isArray(payload?.personas) ? payload.personas : [])
			toast.success('Global default persona updated')
		} catch (error: any) {
			console.error('Failed to update global default persona:', error)
			toast.error(error?.message || 'Failed to update global default persona')
		} finally {
			setSaving(false)
		}
	}

	const removePersona = async (persona: PersonaItem) => {
		if (!confirm(`Delete persona "${persona.label}"?`)) return
		setSaving(true)
		try {
			const response = await ai.deletePlaygroundPersona(persona.id)
			const payload = extractData<PersonaPayload>(response)
			setPersonas(Array.isArray(payload?.personas) ? payload.personas : [])
			toast.success('Persona deleted')
		} catch (error: any) {
			console.error('Failed to delete persona:', error)
			toast.error(error?.message || 'Failed to delete persona')
		} finally {
			setSaving(false)
		}
	}

	return (
		<Card className="border-gray-100 shadow-sm overflow-hidden">
			<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4">
				<div className="flex items-center gap-2">
					<Bot size={20} className="text-emerald-600" />
					<CardTitle className="text-lg font-bold">
						AI Agent Personas
					</CardTitle>
				</div>
				<CardDescription>
					Manage dynamic personas for AI Sales, AI Support, and AI General.
					Used by Workflow and AI Playground.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-6 p-6">
				{loading ? (
					<div className="flex items-center justify-center py-12">
						<div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
					</div>
				) : null}

				{!loading &&
					agentTypes.map((agentType) => {
						const rows = personasByType[agentType.id] || []
						return (
						<div
							key={agentType.id}
							className="space-y-3 rounded-xl border border-gray-100 p-4"
						>
							<div className="flex items-center justify-between">
								<div className="flex items-center gap-2">
									<h4 className="text-sm font-bold text-gray-900">
										{agentType.label}
									</h4>
									<Badge variant="outline">{rows.length} personas</Badge>
									{hasDefaultForType(agentType.id) ? (
										<Badge variant="outline">Has type default</Badge>
									) : (
										<Badge variant="outline">No type default</Badge>
									)}
								</div>
							</div>
							{rows.length > 0 && !hasDefaultForType(agentType.id) ? (
								<Button
									variant="outline"
									size="sm"
									onClick={() => void setDefaultForType(rows[0].id)}
									disabled={saving}
								>
									Set first persona as type default
								</Button>
							) : null}
							{rows.length === 0 ? (
								<p className="text-xs text-gray-500">
									No persona for this agent type yet.
								</p>
							) : (
									<div className="space-y-2">
										{rows.map((persona) => {
											const isEditing = editingId === persona.id
											if (isEditing) {
												return (
													<div
														key={persona.id}
														className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/30 p-3"
													>
														<div className="grid gap-2 md:grid-cols-2">
															<Input
																value={editingLabel}
																onChange={(event) =>
																	setEditingLabel(event.target.value)
																}
																placeholder="Persona label"
															/>
															<select
																value={editingAgentType}
																onChange={(event) =>
																	setEditingAgentType(
																		event.target.value as AgentTypeId,
																	)
																}
																className="h-10 rounded-md border border-input bg-background px-3 text-sm"
															>
																{agentTypes.map((typeOption) => (
																	<option
																		key={typeOption.id}
																		value={typeOption.id}
																	>
																		{typeOption.label}
																	</option>
																))}
															</select>
														</div>
														<Textarea
															value={editingSystemInstruction}
															onChange={(event) =>
																setEditingSystemInstruction(event.target.value)
															}
															placeholder="System instruction"
															className="min-h-[96px]"
														/>
														<div className="flex flex-wrap gap-2">
															<Button
																onClick={() => void submitEdit(persona.id)}
																disabled={saving}
																className="bg-emerald-500 hover:bg-emerald-600 text-white"
															>
																<Save size={14} className="mr-2" />
																Save
															</Button>
															<Button
																variant="outline"
																onClick={cancelEdit}
																disabled={saving}
															>
																Cancel
															</Button>
														</div>
													</div>
												)
											}

											return (
												<div
													key={persona.id}
													className="space-y-2 rounded-lg border border-gray-100 bg-white p-3"
												>
													<div className="flex flex-wrap items-center justify-between gap-2">
														<div className="min-w-0">
															<p className="truncate text-sm font-semibold text-gray-900">
																{persona.label}
															</p>
															<div className="mt-1 flex flex-wrap gap-1">
																{persona.isDefaultForType ? (
																	<Badge variant="outline">
																		Default for type
																	</Badge>
																) : null}
																{persona.isDefault ? (
																	<Badge variant="outline">
																		Global default
																	</Badge>
																) : null}
															</div>
														</div>
														<div className="flex flex-wrap gap-2">
															<Button
																variant="outline"
																size="sm"
																onClick={() => startEdit(persona)}
																disabled={saving}
															>
																Edit
															</Button>
															<Button
																variant="outline"
																size="sm"
																onClick={() => void setDefaultForType(persona.id)}
																disabled={saving || persona.isDefaultForType}
															>
																Set Type Default
															</Button>
															<Button
																variant="outline"
																size="sm"
																onClick={() => void setGlobalDefault(persona.id)}
																disabled={saving}
															>
																Set Global Default
															</Button>
															<Button
																variant="outline"
																size="sm"
																className="text-red-600 border-red-200 hover:bg-red-50"
																onClick={() => void removePersona(persona)}
																disabled={saving}
															>
																<Trash2 size={14} />
															</Button>
														</div>
													</div>
													<p className="text-xs text-gray-600 whitespace-pre-wrap">
														{persona.systemInstruction}
													</p>
												</div>
											)
										})}
									</div>
								)}
							</div>
						)
					})}

				<div className="space-y-3 rounded-xl border border-dashed border-gray-200 p-4">
					<h4 className="text-sm font-bold text-gray-900">Create Persona</h4>
					<div className="grid gap-2 md:grid-cols-2">
						<Input
							value={newLabel}
							onChange={(event) => setNewLabel(event.target.value)}
							placeholder="Persona label"
						/>
						<select
							value={newAgentType}
							onChange={(event) =>
								setNewAgentType(event.target.value as AgentTypeId)
							}
							className="h-10 rounded-md border border-input bg-background px-3 text-sm"
						>
							{agentTypes.map((agentType) => (
								<option key={agentType.id} value={agentType.id}>
									{agentType.label}
								</option>
							))}
						</select>
					</div>
					<Textarea
						value={newSystemInstruction}
						onChange={(event) => setNewSystemInstruction(event.target.value)}
						placeholder="System instruction for this persona"
						className="min-h-[110px]"
					/>
					<div className="flex flex-wrap items-center gap-4 text-xs text-gray-600">
						<label className="inline-flex items-center gap-2">
							<input
								type="checkbox"
								checked={newIsTypeDefault}
								onChange={(event) =>
									setNewIsTypeDefault(event.target.checked)
								}
							/>
							Set as default for this agent type
						</label>
						<label className="inline-flex items-center gap-2">
							<input
								type="checkbox"
								checked={newIsGlobalDefault}
								onChange={(event) =>
									setNewIsGlobalDefault(event.target.checked)
								}
							/>
							Set as global default persona
						</label>
					</div>
					<Button
						onClick={() => void submitCreate()}
						disabled={saving}
						className="bg-emerald-500 hover:bg-emerald-600 text-white"
					>
						<Plus size={14} className="mr-2" />
						Add Persona
					</Button>
				</div>
			</CardContent>
		</Card>
	)
}
