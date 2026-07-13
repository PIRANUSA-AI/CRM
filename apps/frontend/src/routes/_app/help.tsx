import { createFileRoute } from '@tanstack/react-router'
import {
	Phone,
	Mail,
	MessageCircle,
	Clock,
	Lightbulb,
	ShieldAlert,
	ChevronDown,
	TriangleAlert,
} from 'lucide-react'
import { useState } from 'react'

export const Route = createFileRoute('/_app/help')({
	component: HelpPage,
})

function HelpPage() {
	const [activeTab, setActiveTab] = useState<'support' | 'usage' | 'policy'>(
		'support',
	)

	return (
		<div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
			<div className="flex-1 flex flex-col overflow-hidden">
				<main className="flex-1 flex flex-col overflow-hidden">
					{/* Tabs */}
					<div className="mb-4 px-4 pt-6 lg:px-8">
						<div
							role='tablist'
							aria-orientation="horizontal"
							className="bg-gray-100 text-gray-500 inline-flex h-10 items-center justify-center rounded-lg p-1 w-full lg:w-auto overflow-x-auto whitespace-nowrap"
							style={{ outline: 'none' }}
						>
							<button
								type='button'
								role='tab'
								aria-selected={activeTab === 'support'}
								onClick={() => setActiveTab('support')}
								className={`flex-1 lg:flex-none ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
									activeTab === 'support'
										? 'bg-white text-gray-950 shadow-sm'
										: 'hover:text-gray-900'
								}`}
							>
								<Phone className="h-4 w-4" />
								Contact Support
							</button>
							<button
								type='button'
								role='tab'
								aria-selected={activeTab === 'usage'}
								onClick={() => setActiveTab('usage')}
								className={`flex-1 lg:flex-none ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
									activeTab === 'usage'
										? 'bg-white text-gray-950 shadow-sm'
										: 'hover:text-gray-900'
								}`}
							>
								<Lightbulb className="h-4 w-4" />
								Usage Tips
							</button>
							<button
								type='button'
								role='tab'
								aria-selected={activeTab === 'policy'}
								onClick={() => setActiveTab('policy')}
								className={`flex-1 lg:flex-none ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
									activeTab === 'policy'
										? 'bg-white text-gray-950 shadow-sm'
										: 'hover:text-gray-900'
								}`}
							>
								<ShieldAlert className="h-4 w-4" />
								Policy & Compliance
							</button>
						</div>
					</div>

					<div className="flex-1 overflow-y-auto px-4 lg:px-8 py-4 lg:py-0">
						{/* Support Content */}
						{activeTab === 'support' && (
							<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
								<div className="bg-white text-gray-900 rounded-xl border border-gray-200 shadow-sm">
									<div className="flex flex-col space-y-1.5 p-6 border-b border-gray-100">
										<div className="leading-none font-semibold tracking-tight text-lg">
											Contact Support
										</div>
										<div className="text-gray-500 text-sm">
											Contact our support team for help and questions
										</div>
									</div>
									<div className="p-6 space-y-6">
										<div className="grid gap-6 md:grid-cols-2">
											{/* Email Support */}
											<div className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg">
												<div className="p-2 bg-emerald-50 rounded-lg">
													<Mail
														className='h-5 w-5 text-emerald-600'
														aria-hidden='true'
													/>
												</div>
												<div className='flex-1 space-y-1'>
													<h3 className="font-semibold text-gray-900">
														Email Support
													</h3>
													<p className='text-sm text-gray-500'>
												support@crm.chat
													</p>
													<button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors text-emerald-600 underline-offset-4 hover:underline h-auto p-0">
														Send Email
													</button>
												</div>
											</div>

											{/* WhatsApp Support */}
											<div className="flex items-start gap-4 p-4 border border-gray-200 rounded-lg">
												<div className="p-2 bg-emerald-50 rounded-lg">
													<MessageCircle
														className='h-5 w-5 text-emerald-600'
														aria-hidden='true'
													/>
												</div>
												<div className='flex-1 space-y-1'>
													<h3 className="font-semibold text-gray-900">
														WhatsApp Support
													</h3>
													<p className='text-sm text-gray-500'>
														+6281295648580
													</p>
													<button className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors text-emerald-600 underline-offset-4 hover:underline h-auto p-0">
														Chat WhatsApp
													</button>
												</div>
											</div>
										</div>

										{/* Operating Hours */}
										<div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
											<Clock
												className="h-5 w-5 text-emerald-600 mt-0.5"
												aria-hidden='true'
											/>
											<div className='space-y-1'>
												<h3 className="font-semibold text-gray-900">
													Operating Hours
												</h3>
												<div className="text-sm text-gray-500 space-y-1">
													<p>Monday - Friday: 09:00 - 18:00 WIB</p>
													<p>Saturday: 09:00 - 15:00 WIB</p>
													<p>Sunday & Holidays: Closed</p>
												</div>
											</div>
										</div>

										{/* Before Contacting */}
										<div className="space-y-4 pt-4 border-t border-gray-100">
											<h3 className="font-semibold text-gray-900">
												Before Contacting Support
											</h3>
											<ul className="list-disc pl-5 space-y-2 text-sm text-gray-500">
												<li>
													Make sure you have read the documentation and usage
													tips
												</li>
												<li>
													Prepare detailed information about the issue you are
													experiencing
												</li>
												<li>
													Screenshots or videos can help the troubleshooting
													process
												</li>
												<li>
													Note the WhatsApp Business number and WABA account
													having issues
												</li>
											</ul>
										</div>
									</div>
								</div>
							</div>
						)}

						{/* Usage Tips Content */}
						{activeTab === 'usage' && (
							<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
								<UsageTipsContent />
							</div>
						)}

						{/* Policy & Compliance Content */}
						{activeTab === 'policy' && (
							<div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300">
								<PolicyComplianceContent />
							</div>
						)}
					</div>
				</main>
			</div>
		</div>
	)
}

function UsageTipsContent() {
	const [openItems, setOpenItems] = useState<string[]>([])

	const toggleItem = (item: string) => {
		setOpenItems((prev) =>
			prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
		)
	}

	return (
		<div className="bg-white text-gray-900 rounded-xl border border-gray-200 shadow-sm">
			<div className="flex flex-col space-y-1.5 p-6">
				<div className="leading-none font-semibold tracking-tight flex items-center gap-2">
					<Lightbulb className="h-5 w-5 text-emerald-600" aria-hidden="true" />
					Usage Tips
				</div>
				<div className="text-gray-500 text-sm">
					Complete guide to maximize platform usage
				</div>
			</div>
			<div className="p-6 pt-0 space-y-6">
				<div className="w-full space-y-2">
					<AccordionItem
						title="Initial Setup and WABA Configuration"
						isOpen={openItems.includes('setup')}
						onToggle={() => toggleItem('setup')}
					>
						<div className="space-y-4 text-sm text-gray-700">
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									1. Connect Your WhatsApp Business Account (WABA)
								</h4>
								<ul className="list-disc pl-5 space-y-1">
									<li>Go to Settings → Channels → WhatsApp</li>
									<li>Click \"Connect WhatsApp Business API\"</li>
									<li>Follow the Meta verification process</li>
									<li>
										Ensure your business is verified on Meta Business Manager
									</li>
								</ul>
							</div>
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									2. Configure Webhook
								</h4>
								<ul className="list-disc pl-5 space-y-1">
									<li>Webhook URL will be automatically generated</li>
									<li>Copy and paste to your Meta App Configuration</li>
									<li>
										Subscribe to message, message_status, and
										message_template_status_update events
									</li>
								</ul>
							</div>
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									3. Test Connection
								</h4>
								<ul className="list-disc pl-5 space-y-1">
									<li>
										Send a test message from your phone to the connected number
									</li>
									<li>Check if the message appears in the inbox</li>
									<li>Reply to ensure two-way communication works</li>
								</ul>
							</div>
						</div>
					</AccordionItem>

					<AccordionItem
						title="Creating and Managing Message Templates"
						isOpen={openItems.includes('templates')}
						onToggle={() => toggleItem('templates')}
					>
						<div className="space-y-4 text-sm text-gray-700">
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									Why Templates are Important
								</h4>
								<p>
									WhatsApp requires approved templates to initiate conversations
									outside the 24-hour window.
								</p>
							</div>
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									Creating Templates
								</h4>
								<ul className="list-disc pl-5 space-y-1">
									<li>Navigate to Templates menu</li>
									<li>Click \"Create Template\"</li>
									<li>
										Choose category: Marketing, Utility, or Authentication
									</li>
									<li>Write clear, non-spammy content</li>
									<li>
										Add variables using {'{'}1{'}'}, {'{'}2{'}'} syntax for
										personalization
									</li>
									<li>Submit for Meta approval (usually 24-48 hours)</li>
								</ul>
							</div>
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									Best Practices
								</h4>
								<ul className="list-disc pl-5 space-y-1">
									<li>Keep messages clear and value-driven</li>
									<li>Avoid promotional language in utility templates</li>
									<li>Always include opt-out instructions</li>
									<li>Use variables for personalization</li>
									<li>Test templates before mass sending</li>
								</ul>
							</div>
						</div>
					</AccordionItem>

					<AccordionItem
						title="Maintaining Quality Rating"
						isOpen={openItems.includes('quality')}
						onToggle={() => toggleItem('quality')}
					>
						<div className="space-y-4 text-sm text-gray-700">
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									Quality Rating Levels
								</h4>
								<ul className="space-y-2">
									<li className="flex items-start gap-2">
										<span className="inline-block w-3 h-3 rounded-full bg-green-500 mt-1"></span>
										<div>
											<span className="font-medium">Green (High):</span>{' '}
											Excellent quality, no restrictions
										</div>
									</li>
									<li className="flex items-start gap-2">
										<span className="inline-block w-3 h-3 rounded-full bg-yellow-500 mt-1"></span>
										<div>
											<span className="font-medium">Yellow (Medium):</span>{' '}
											Warning level, improve engagement
										</div>
									</li>
									<li className="flex items-start gap-2">
										<span className="inline-block w-3 h-3 rounded-full bg-red-500 mt-1"></span>
										<div>
											<span className="font-medium">Red (Low):</span> Risk of
											restrictions or ban
										</div>
									</li>
								</ul>
							</div>
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									How to Improve Quality
								</h4>
								<ul className="list-disc pl-5 space-y-1">
									<li>Send relevant, personalized messages</li>
									<li>Respond quickly to customer inquiries</li>
									<li>Reduce block and report rates</li>
									<li>Only message opted-in contacts</li>
									<li>Monitor feedback in Meta Business Manager</li>
									<li>Maintain consistent engagement</li>
								</ul>
							</div>
						</div>
					</AccordionItem>

					<AccordionItem
						title="Using AI Auto-Reply"
						isOpen={openItems.includes('ai')}
						onToggle={() => toggleItem('ai')}
					>
						<div className="space-y-4 text-sm text-gray-700">
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									Setting Up AI Knowledge Base
								</h4>
								<ul className="list-disc pl-5 space-y-1">
									<li>Go to AI Settings</li>
									<li>Upload FAQs, product docs, or SOPs</li>
									<li>Train AI with common customer questions</li>
									<li>Review and refine AI responses regularly</li>
								</ul>
							</div>
							<div>
								<h4 className="font-semibold text-gray-900 mb-2">
									AI Usage Modes
								</h4>
								<ul className="space-y-2">
									<li>
										<span className="font-medium">Assist Agent:</span> AI
										suggests replies, agent reviews before sending
									</li>
									<li>
										<span className="font-medium">Auto Reply:</span> AI responds
										automatically based on knowledge base
									</li>
									<li>
										<span className="font-medium">Hybrid:</span> AI drafts,
										agent approves before sending
									</li>
								</ul>
							</div>
						</div>
					</AccordionItem>
				</div>
			</div>
		</div>
	)
}

function PolicyComplianceContent() {
	const [openItems, setOpenItems] = useState<string[]>([])

	const toggleItem = (item: string) => {
		setOpenItems((prev) =>
			prev.includes(item) ? prev.filter((i) => i !== item) : [...prev, item],
		)
	}

	return (
		<div className="space-y-6">
			{/* Disclaimer */}
			<div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
				<TriangleAlert className="h-5 w-5 text-red-600 shrink-0 mt-0.5" />
				<div>
					<h5 className="font-semibold text-red-900 mb-1">
						Disclaimer Penting!
					</h5>
					<p className="text-sm text-red-800">
						Tidak ada jaminan 100% \"anti-banned\". Semua keputusan suspend atau
						banned akun sepenuhnya berada di tangan Meta/WhatsApp. Panduan ini
						hanya berisi best practices untuk meminimalkan risiko pelanggaran
						policy Meta.
					</p>
				</div>
			</div>

			<div className="bg-white text-gray-900 rounded-xl border border-gray-200 shadow-sm">
				<div className="flex flex-col space-y-1.5 p-6 border-b border-gray-100">
					<div className="leading-none font-semibold tracking-tight text-lg flex items-center gap-2">
						<ShieldAlert
							className="h-5 w-5 text-emerald-600"
							aria-hidden='true'
						/>
						Panduan Mematuhi Policy WhatsApp Business
					</div>
					<div className="text-gray-500 text-sm">
						Best practices untuk mengikuti aturan Meta dan meminimalkan risiko
						pelanggaran
					</div>
				</div>
				<div className="p-6 space-y-6">
					<div className="w-full space-y-2">
						<AccordionItem
							title="Penyebab Utama Account Banned"
							isOpen={openItems.includes('banned')}
							onToggle={() => toggleItem('banned')}
						>
							<div className="space-y-4 text-sm text-gray-700">
								<div>
									<h4 className="font-semibold text-gray-900 mb-2">
										1. Mengirim Spam atau Pesan Tidak Relevan
									</h4>
									<ul className="list-disc pl-5 space-y-1">
										<li>Mengirim broadcast ke kontak yang tidak opt-in</li>
										<li>Pesan promosi berlebihan tanpa value</li>
										<li>Konten tidak sesuai dengan kategori template</li>
									</ul>
								</div>
								<div>
									<h4 className="font-semibold text-gray-900 mb-2">
										2. Tingkat Block dan Report Tinggi
									</h4>
									<ul className="list-disc pl-5 space-y-1">
										<li>Banyak user memblokir nomor bisnis Anda</li>
										<li>User melaporkan pesan sebagai spam</li>
									</ul>
								</div>
							</div>
						</AccordionItem>

						<AccordionItem
							title="Pentingnya Opt-In dan Consent Management"
							isOpen={openItems.includes('optin')}
							onToggle={() => toggleItem('optin')}
						>
							<div className="space-y-4 text-sm text-gray-700">
								<div>
									<h4 className="font-semibold text-gray-900 mb-2">
										Apa Itu Opt-In?
									</h4>
									<p>
										Opt-in adalah persetujuan eksplisit dari customer untuk
										menerima pesan dari bisnis Anda via WhatsApp. Ini adalah{' '}
										<strong>WAJIB</strong> menurut WhatsApp Business Policy.
									</p>
								</div>
								<div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
									<p className="text-sm text-yellow-800">
										<strong>⚠️ Penting:</strong> Mengirim pesan tanpa opt-in
										adalah pelanggaran SERIUS dan bisa langsung banned!
									</p>
								</div>
							</div>
						</AccordionItem>
					</div>

					<div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-start gap-3">
						<ShieldAlert className="h-5 w-5 text-gray-600 shrink-0 mt-0.5" />
						<div>
							<h5 className="font-semibold text-gray-900 mb-1">
								Catatan Penting
							</h5>
							<p className="text-sm text-gray-700">
								WhatsApp Business API adalah tools untuk berkomunikasi dengan
								customer secara profesional, bukan untuk spam marketing.
								Prioritaskan memberikan value dan pengalaman positif kepada
								user.
							</p>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

function AccordionItem({
	title,
	children,
	isOpen,
	onToggle,
}: {
	title: string
	children: React.ReactNode
	isOpen: boolean
	onToggle: () => void
}) {
	return (
		<div className="border-b border-gray-100 last:border-0">
			<button
				onClick={onToggle}
				className="flex w-full items-center justify-between py-4 text-sm font-semibold text-left text-gray-900 hover:text-emerald-600 transition-colors"
				type="button"
			>
				{title}
				<ChevronDown
					className={`h-4 w-4 text-gray-500 shrink-0 transition-transform duration-200 ${isOpen ? 'rotate-180 text-emerald-600' : ''}`}
				/>
			</button>
			{isOpen && (
				<div className="pb-6 animate-in slide-in-from-top-2 duration-200">
					{children}
				</div>
			)}
		</div>
	)
}
