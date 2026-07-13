import { useState, useEffect } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { agentsManagement } from '../lib/agents-api'

type AgentSettingsProps = {}

export default function AgentSettings({}: AgentSettingsProps) {
	// State to manage single active expanded section
	const [activeSection, setActiveSection] = useState<string | null>(
		'agentAllocation',
	)
	const [settings, setSettings] = useState<any>(null)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		loadSettings()
	}, [])

	const loadSettings = async () => {
		try {
			setLoading(true)
			const res: any = await agentsManagement.settings.get()
			if (res.success) {
				setSettings(res.settings)
			}
		} catch (error) {
			console.error('Failed to load settings:', error)
		} finally {
			setLoading(false)
		}
	}

	const handleToggle = async (key: string, value: boolean) => {
		// Optimistic update
		setSettings((prev: any) => ({ ...prev, [key]: value }))

		try {
			await agentsManagement.settings.update({ [key]: value })
		} catch (error) {
			console.error('Failed to update setting:', error)
			// Revert on failure
			setSettings((prev: any) => ({ ...prev, [key]: !value }))
		}
	}

	const toggleSection = (key: string) => {
		setActiveSection((prev) => (prev === key ? null : key))
	}

	if (loading)
		return (
			<div className="p-8 text-center text-gray-500">Loading settings...</div>
		)
	if (!settings)
		return (
			<div className="p-8 text-center text-red-500">
				Failed to load settings.
			</div>
		)

	return (
		<div className="max-w-4xl mx-auto space-y-6 pb-20">
			{/* Agent Allocation */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<div
					className="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 border-b border-gray-100"
					onClick={() => toggleSection('agentAllocation')}
				>
					<h3 className="font-bold text-gray-900">Agent Allocation</h3>
					{activeSection === 'agentAllocation' ? (
						<ChevronUp className="w-5 h-5 text-gray-500" />
					) : (
						<ChevronDown className="w-5 h-5 text-gray-500" />
					)}
				</div>

				{activeSection === 'agentAllocation' && (
					<div className="px-6 pb-6 pt-4 space-y-6 animate-in slide-in-from-top-2 duration-200">
						<div>
							<div className="flex items-center justify-between mb-2">
								<span className="text-teal-600 font-medium text-sm">
									Auto assign agent
								</span>
								<ToggleSwitch
									checked={settings.auto_assign_agent}
									onChange={(val) => handleToggle('auto_assign_agent', val)}
								/>
							</div>
							<div className="bg-[#DDEce9] text-gray-700 text-xs p-3 rounded-md">
								Please note that this setting will only work if the custom agent
								allocation setting is disabled.
							</div>
						</div>

						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Agent can takeover unserved customer
							</span>
							<ToggleSwitch
								checked={settings.agent_can_takeover_unserved}
								onChange={(val) =>
									handleToggle('agent_can_takeover_unserved', val)
								}
							/>
						</div>
					</div>
				)}
			</div>

			{/* Customers Agent Setting */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<div
					className="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 border-b border-gray-100"
					onClick={() => toggleSection('customersAgentSetting')}
				>
					<h3 className="font-bold text-gray-900">Customers Agent Setting</h3>
					{activeSection === 'customersAgentSetting' ? (
						<ChevronUp className="w-5 h-5 text-gray-500" />
					) : (
						<ChevronDown className="w-5 h-5 text-gray-500" />
					)}
				</div>
				{activeSection === 'customersAgentSetting' && (
					<div className="px-6 pb-6 pt-4 space-y-6 animate-in slide-in-from-top-2 duration-200">
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Agent can access customers page
							</span>
							<ToggleSwitch
								checked={settings.agent_can_access_customers}
								onChange={(val) =>
									handleToggle('agent_can_access_customers', val)
								}
							/>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Agent can Import or Export customers data
							</span>
							<ToggleSwitch
								checked={settings.agent_can_import_export_customers}
								onChange={(val) =>
									handleToggle('agent_can_import_export_customers', val)
								}
							/>
						</div>
					</div>
				)}
			</div>

			{/* Broadcast Agent Setting */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<div
					className="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 border-b border-gray-100"
					onClick={() => toggleSection('broadcastAgentSetting')}
				>
					<h3 className="font-bold text-gray-900">Broadcast Agent Setting</h3>
					{activeSection === 'broadcastAgentSetting' ? (
						<ChevronUp className="w-5 h-5 text-gray-500" />
					) : (
						<ChevronDown className="w-5 h-5 text-gray-500" />
					)}
				</div>
				{activeSection === 'broadcastAgentSetting' && (
					<div className="px-6 pb-6 pt-4 space-y-6 animate-in slide-in-from-top-2 duration-200">
						<div>
							<div className="flex items-center justify-between mb-2">
								<span className="text-teal-600 font-medium text-sm">
									Agent can send outbound message in broadcast page
								</span>
								<ToggleSwitch
									checked={settings.agent_can_send_broadcast}
									onChange={(val) =>
										handleToggle('agent_can_send_broadcast', val)
									}
								/>
							</div>
							<div className="bg-orange-50 text-gray-700 text-xs p-3 rounded-md flex items-start gap-3 border border-orange-100">
								<span className="text-red-500 text-lg flex-shrink-0">⚠️</span>
								<p className="leading-relaxed">
									Enabling this setting allows agents to send broadcasts to all
									channels, including WhatsApp, through the Broadcast Message
									page. Additionally, agents can also use your credits to send
									broadcasts to the WhatsApp channel.
								</p>
							</div>
						</div>

						<div>
							<div className="flex items-center justify-between mb-2">
								<span className="text-teal-600 font-medium text-sm">
									Agents can send broadcasts when customer service window is
									active
								</span>
								<ToggleSwitch
									checked={settings.agent_can_broadcast_in_service_window}
									onChange={(val) =>
										handleToggle('agent_can_broadcast_in_service_window', val)
									}
								/>
							</div>
							<div className="bg-orange-50 text-gray-700 text-xs p-3 rounded-md flex items-start gap-3 border border-orange-100">
								<span className="text-red-500 text-lg flex-shrink-0">⚠️</span>
								<p className="leading-relaxed">
									Enabling this setting allows agents to send broadcasts to the
									WhatsApp channel through the Inbox page when the customer
									service window is active. Additionally, agents can also use
									your credits to send the broadcasts.
								</p>
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Other Agents Inbox Setting */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<div
					className="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 border-b border-gray-100"
					onClick={() => toggleSection('otherAgentsInboxSetting')}
				>
					<h3 className="font-bold text-gray-900">
						Other Agents Inbox Setting
					</h3>
					{activeSection === 'otherAgentsInboxSetting' ? (
						<ChevronUp className="w-5 h-5 text-gray-500" />
					) : (
						<ChevronDown className="w-5 h-5 text-gray-500" />
					)}
				</div>
				{activeSection === 'otherAgentsInboxSetting' && (
					<div className="px-6 pb-6 pt-4 space-y-6 animate-in slide-in-from-top-2 duration-200">
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Hide agent status (online/offline) toggle
							</span>
							<ToggleSwitch
								checked={settings.hide_agent_status_toggle}
								onChange={(val) =>
									handleToggle('hide_agent_status_toggle', val)
								}
							/>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Hide customer ID on Chat & Customer Info
							</span>
							<ToggleSwitch
								checked={settings.hide_customer_id}
								onChange={(val) => handleToggle('hide_customer_id', val)}
							/>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Agent can assign chat to other agents
							</span>
							<ToggleSwitch
								checked={settings.agent_can_assign_chat}
								onChange={(val) => handleToggle('agent_can_assign_chat', val)}
							/>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Agent can add other agents to chat
							</span>
							<ToggleSwitch
								checked={settings.agent_can_add_agents_to_chat}
								onChange={(val) =>
									handleToggle('agent_can_add_agents_to_chat', val)
								}
							/>
						</div>
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Agent can leave chat room themselves
							</span>
							<ToggleSwitch
								checked={settings.agent_can_leave_chat}
								onChange={(val) => handleToggle('agent_can_leave_chat', val)}
							/>
						</div>
						<div>
							<div className="flex items-center justify-between mb-2">
								<span className="text-teal-600 font-medium text-sm">
									Hide handover request dialogue from bot to agent
								</span>
								<ToggleSwitch
									checked={settings.hide_handover_dialogue}
									onChange={(val) =>
										handleToggle('hide_handover_dialogue', val)
									}
								/>
							</div>
							<div className="bg-[#DDEce9] text-gray-700 text-xs p-3 rounded-md">
								If you enable this setting, a handover request pop-up will not
								appear in the Inbox menu for Admin, Supervisor, and Agent. See
								this{' '}
								<a
									href="#"
									className="text-blue-600 font-semibold hover:underline"
								>
									documentation
								</a>{' '}
								for details.
							</div>
						</div>
					</div>
				)}
			</div>

			{/* Other Agents Setting */}
			<div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
				<div
					className="px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 border-b border-gray-100"
					onClick={() => toggleSection('otherAgentsSetting')}
				>
					<h3 className="font-bold text-gray-900">Other Agents Setting</h3>
					{activeSection === 'otherAgentsSetting' ? (
						<ChevronUp className="w-5 h-5 text-gray-500" />
					) : (
						<ChevronDown className="w-5 h-5 text-gray-500" />
					)}
				</div>
				{activeSection === 'otherAgentsSetting' && (
					<div className="px-6 pb-6 pt-4 space-y-6 animate-in slide-in-from-top-2 duration-200">
						<div className="flex items-center justify-between">
							<span className="text-teal-600 font-medium text-sm">
								Agent can manage Quick Replies
							</span>
							<ToggleSwitch
								checked={settings.agent_can_manage_quick_replies}
								onChange={(val) =>
									handleToggle('agent_can_manage_quick_replies', val)
								}
							/>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}

function ToggleSwitch({
	checked,
	onChange,
}: {
	checked: boolean
	onChange: (val: boolean) => void
}) {
	return (
		<label className="relative inline-flex items-center cursor-pointer">
			<input
				type="checkbox"
				className="sr-only peer"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
			/>
			<div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-teal-500"></div>
		</label>
	)
}
