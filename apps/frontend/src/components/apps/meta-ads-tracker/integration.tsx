import { useRef, useState, useEffect } from 'react'
import { API_BASE } from '@/lib/api'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
	CardDescription,
} from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
	Check,
	Copy,
	Info,
	Loader2,
	RefreshCw,
	Trash2,
	Link,
	Facebook,
	Upload,
	X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from '@/components/ui/dialog'

interface MetaAccount {
	id: string
	fb_account_id: string
	fb_account_name: string
	is_active: boolean
	currency: string
	last_synced_at?: string
}

export default function IntegrationSettings() {
	const appId =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_org_slug') || ''
			: ''
	const [accounts, setAccounts] = useState<MetaAccount[]>([])
	const [loading, setLoading] = useState(true)
	const [webhookUrl, setWebhookUrl] = useState('')
	const [copied, setCopied] = useState(false)
	const [isConnecting, setIsConnecting] = useState(false)
	const [dialogOpen, setDialogOpen] = useState(false)
	const [fbAppId, setFbAppId] = useState<string>('')
	const [availableAccounts, setAvailableAccounts] = useState<any[]>([])
	const [step, setStep] = useState<'connect' | 'select'>('connect')

	// Mock state for badge upload
	const [badgeImage, setBadgeImage] = useState<string | null>(null)

	useEffect(() => {
		fetchAccounts()
		fetchConfig()
		const url = `${API_BASE}/webhooks/meta-ads/${appId}`.replace('/api', '')
		setWebhookUrl(url)
	}, [appId])

	const fetchConfig = async () => {
		try {
			const token = localStorage.getItem('scalechat_token')
			const res = await fetch(`${API_BASE}/meta-ads/config`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success && data.appId) {
				setFbAppId(data.appId)
				initFacebookSdk(data.appId)
			}
		} catch (e) {
			console.error('Failed to fetch config', e)
		}
	}

	const initFacebookSdk = (id: string) => {
		if ((window as any).FB) return

		;(window as any).fbAsyncInit = () => {
			;(window as any).FB.init({
				appId: id,
				cookie: true,
				xfbml: true,
				version: 'v19.0',
			})
		}

		;((d, s, id) => {
			var js,
				fjs = d.getElementsByTagName(s)[0]
			if (d.getElementById(id)) {
				return
			}
			js = d.createElement(s) as any
			js.id = id
			js.src = 'https://connect.facebook.net/en_US/sdk.js'
			;(fjs.parentNode as any).insertBefore(js, fjs)
		})(document, 'script', 'facebook-jssdk')
	}

	const fetchAccounts = async () => {
		try {
			const token = localStorage.getItem('scalechat_token')
			const res = await fetch(`${API_BASE}/meta-ads/accounts`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success) {
				setAccounts(data.accounts)
			}
		} catch (error) {
			console.error('Failed to fetch accounts:', error)
		} finally {
			setLoading(false)
		}
	}

	const handleCopy = () => {
		navigator.clipboard.writeText(webhookUrl)
		setCopied(true)
		setTimeout(() => setCopied(false), 2000)
		toast.success('Webhook URL copied to clipboard')
	}

	const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (file) {
			const reader = new FileReader()
			reader.onload = (e) => {
				setBadgeImage(e.target?.result as string)
			}
			reader.readAsDataURL(file)
		}
	}

	const handleConnect = () => {
		if (!(window as any).FB) {
			toast.error('Facebook SDK not loaded yet')
			return
		}

		setIsConnecting(true)
		;(window as any).FB.login(
			(response: any) => {
				if (response.authResponse) {
					connectToBackend(response.authResponse.accessToken)
				} else {
					toast.error('User cancelled login or did not fully authorize.')
					setIsConnecting(false)
				}
			},
			{ scope: 'ads_read,read_insights' },
		)
	}

	const connectToBackend = async (shortToken: string) => {
		try {
			const token = localStorage.getItem('scalechat_token')
			const res = await fetch(`${API_BASE}/meta-ads/connect`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({ access_token: shortToken }),
			})
			const data = await res.json()

			if (data.success) {
				setAvailableAccounts(data.accounts)
				setStep('select')
			} else {
				toast.error('Failed to connect: ' + data.error)
			}
		} catch (e) {
			toast.error('Connection error')
		} finally {
			setIsConnecting(false)
		}
	}

	const handleSelectAccount = async (account: any) => {
		setIsConnecting(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const res = await fetch(`${API_BASE}/meta-ads/accounts`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					fb_account_id: account.account_id,
					fb_account_name: account.name,
					access_token: account.access_token,
					currency: account.currency,
					country_code: 'ID', // Defaulting for now
				}),
			})
			const data = await res.json()
			if (data.success) {
				toast.success('Account connected successfully')
				setDialogOpen(false)
				fetchAccounts()
				setStep('connect') // Reset
			} else {
				toast.error('Failed to save account')
			}
		} catch (e) {
			toast.error('Error saving account')
		} finally {
			setIsConnecting(false)
		}
	}

	return (
		<div className="space-y-6">
			<Card className="border-gray-200">
				<CardHeader>
					<CardTitle>Webhook Configuration</CardTitle>
					<CardDescription>
						Configure this webhook URL in your Meta App Dashboard to receive
						Real-time updates.
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<Label
								htmlFor="webhook-url"
								className="text-sm font-medium text-gray-700"
							>
								Webhook URL
							</Label>
							<div className="flex items-center gap-2">
								<Switch id="webhook-active" defaultChecked />
								<Label
									htmlFor="webhook-active"
									className="text-sm text-gray-500"
								>
									Active
								</Label>
							</div>
						</div>
						<div className="flex gap-2">
							<Input
								id="webhook-url"
								value={webhookUrl}
								readOnly
								className="bg-gray-50 font-mono text-sm border-gray-200"
							/>
							<Button
								variant="outline"
								size="icon"
								onClick={handleCopy}
								className="border-gray-200"
							>
								{copied ? (
									<Check className="h-4 w-4 text-emerald-500" />
								) : (
									<Copy className="h-4 w-4" />
								)}
							</Button>
						</div>
						<div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 p-3 rounded-lg border border-emerald-100">
							<Info className="h-4 w-4" />
							Use this webhook URL for Webhooks product in Meta App Dashboard.
							Verify token is configured in your CRM environment.
						</div>
					</div>
				</CardContent>
			</Card>

			<div className="grid grid-cols-1 md:grid-cols-2 gap-6">
				{/* Connected Accounts List */}
				{accounts.map((account) => (
					<Card
						key={account.id}
						className="overflow-hidden border-emerald-100 shadow-sm"
					>
						<CardContent className="p-6">
							<div className="flex justify-between items-start mb-4">
								<div className="flex items-center gap-3">
									<div className="w-10 h-10 bg-blue-50 rounded-full flex items-center justify-center text-blue-600">
										<Facebook className="w-5 h-5" />
									</div>
									<div>
										<h3 className="font-semibold text-gray-900">
											{account.fb_account_name}
										</h3>
										<p className="text-xs text-gray-500 font-mono">
											{account.fb_account_id}
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<span
										className={`w-2 h-2 rounded-full ${account.is_active ? 'bg-emerald-500' : 'bg-gray-300'}`}
									/>
									<span className="text-xs font-medium text-gray-600">
										{account.is_active ? 'Active' : 'Inactive'}
									</span>
								</div>
							</div>

							<div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
								<p className="text-xs text-gray-400">
									Last synced:{' '}
									{account.last_synced_at
										? new Date(account.last_synced_at).toLocaleString()
										: 'Never'}
								</p>
								<Button
									variant="ghost"
									size="sm"
									className="text-red-500 hover:text-red-700 hover:bg-red-50"
								>
									<Trash2 className="w-4 h-4 mr-2" />
									Disconnect
								</Button>
							</div>
						</CardContent>
					</Card>
				))}

				{/* Add New Account Card / Dialog */}
				<Dialog
					open={dialogOpen}
					onOpenChange={(val: boolean) => {
						setDialogOpen(val)
						if (!val) setStep('connect')
					}}
				>
					<DialogTrigger asChild>
						<Card className="border-dashed border-2 border-gray-200 shadow-none hover:border-emerald-200 transition-colors cursor-pointer group rounded-xl">
							<CardContent className="flex flex-col items-center justify-center p-8 h-full min-h-[180px]">
								<div className="w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center mb-4 group-hover:bg-emerald-50 transition-colors">
									<Link className="w-6 h-6 text-gray-400 group-hover:text-emerald-500" />
								</div>
								<h3 className="font-semibold text-gray-900 mb-1">
									Connect Ad Account
								</h3>
								<p className="text-sm text-gray-500 text-center">
									Link your Facebook Ad Account to track performance
								</p>
							</CardContent>
						</Card>
					</DialogTrigger>
					<DialogContent className="sm:max-w-[600px] p-0 overflow-hidden rounded-xl">
						<div className="p-6 pb-2">
							<h2 className="text-lg font-bold text-gray-900">
								Add New Facebook Account
							</h2>
							<p className="text-sm text-gray-500 mt-2 leading-relaxed">
								{step === 'connect'
									? 'Please make sure your Facebook Account has access to Business Account, and the Ads Account is placed under Business Account.'
									: 'Select which Ad Account you want to track.'}
							</p>
						</div>

						<div className="px-6 py-4 space-y-6">
							{step === 'connect' ? (
								<>
									<div className="flex items-start gap-4">
										<div className="relative group shrink-0">
											<div className="w-20 h-20 rounded-full bg-[#1877F2] flex items-center justify-center overflow-hidden border border-gray-100">
												{badgeImage ? (
													<img
														src={badgeImage}
														alt="Badge"
														className="w-full h-full object-cover"
													/>
												) : (
													<Facebook className="w-10 h-10 text-white" />
												)}
											</div>
											<label className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer rounded-full text-white text-xs font-medium">
												Upload
												<input
													type="file"
													className="hidden"
													accept="image/*"
													onChange={handleFileUpload}
												/>
											</label>
										</div>
										<div>
											<h3 className="text-sm font-bold text-gray-900">
												Channel Badge Icon
											</h3>
											<p className="text-sm text-gray-500 mt-1 leading-relaxed">
												Upload an image that will be used as your Channel Badge
												icon. We recommend you to upload image 100px x 100px
												(square image) for better result.
											</p>
										</div>
									</div>

									<div className="border-t border-gray-100 pt-6">
										<h3 className="text-sm font-bold text-gray-900 mb-2">
											Connect Channel
										</h3>
										<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
											<p className="text-sm text-gray-500 leading-relaxed max-w-sm">
												Ensure that you have a Facebook Account and a Facebook
												Business Page. Connect to your Facebook Page by simply
												clicking the button beside.
											</p>
											<Button
												className="bg-[#1877F2] hover:bg-[#166fe5] text-white shrink-0"
												onClick={handleConnect}
												disabled={isConnecting}
											>
												{isConnecting ? (
													<Loader2 className="w-4 h-4 animate-spin mr-2" />
												) : (
													<Facebook className="w-4 h-4 mr-2" />
												)}
												Continue with Facebook
											</Button>
										</div>
									</div>
								</>
							) : (
								<div className="space-y-2 max-h-[300px] overflow-y-auto">
									{availableAccounts.length === 0 && (
										<p className="text-center text-sm text-gray-500">
											No ad accounts found.
										</p>
									)}
									{availableAccounts.map((acc) => (
										<div
											key={acc.id}
											onClick={() => handleSelectAccount(acc)}
											className="flex items-center justify-between p-3 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
										>
											<div className="flex items-center gap-3">
												<div className="w-8 h-8 rounded bg-blue-100 text-blue-600 flex items-center justify-center font-bold text-xs">
													A
												</div>
												<div>
													<p className="font-semibold text-sm text-gray-900">
														{acc.name}
													</p>
													<p className="text-xs text-gray-500">
														ID: {acc.account_id} • {acc.currency}
													</p>
												</div>
											</div>
											<Button size="sm" variant="ghost" disabled={isConnecting}>
												Select
											</Button>
										</div>
									))}
								</div>
							)}
						</div>
						<div className="p-4 bg-gray-50 border-t border-gray-100 text-xs text-center text-gray-400">
							Secure connection via Meta Graph API
						</div>
					</DialogContent>
				</Dialog>
			</div>
		</div>
	)
}
