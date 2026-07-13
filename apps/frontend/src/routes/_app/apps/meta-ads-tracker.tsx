import { useRef, useState, useEffect } from 'react'
import {
	createFileRoute,
} from '@tanstack/react-router'
import { API_BASE } from '@/lib/api'
import PageHeader from '@/components/PageHeader'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import {
	Megaphone,
	Settings2,
	BarChart3,
	Database,
	ScrollText,
} from 'lucide-react'
import IntegrationSettings from '@/components/apps/meta-ads-tracker/integration'
import AdsPerformance from '@/components/apps/meta-ads-tracker/ads-performance'

// Placeholder for Webhook Log
const WebhookLog = () => (
	<div className="p-8 text-center text-gray-500">Webhook Logs Coming Soon</div>
)

export const Route = createFileRoute('/_app/apps/meta-ads-tracker')({
	component: MetaAdsTrackerPage,
})

function MetaAdsTrackerPage() {
	const [activeTab, setActiveTab] = useState('integration')

	return (
		<main className="flex-1 overflow-y-auto h-full bg-gray-50/50">
			<PageHeader
				title="Ads Tracker Settings"
				description="Track your Click to WhatsApp Ads performance here. Data are from Meta Ads Manager"
				backButton={{
					to: '/apps',
					label: 'Back To Your Installed Apps',
				}}
			/>

			<div className="w-full mx-auto px-4 lg:px-8 pb-8 mt-6">
				<Tabs
					defaultValue="integration"
					value={activeTab}
					onValueChange={setActiveTab}
					className="space-y-6"
				>
					<TabsList className="bg-gray-100 p-1 rounded-lg inline-flex">
						<TabsTrigger
							value='integration'
							className="px-4 py-2 rounded-md text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500"
						>
							Integration
						</TabsTrigger>
						<TabsTrigger
							value='performance'
							className="px-4 py-2 rounded-md text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500"
						>
							Ads Performance
						</TabsTrigger>
						<TabsTrigger
							value='webhook'
							className="px-4 py-2 rounded-md text-sm font-medium data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm text-gray-500"
						>
							Webhook Log
						</TabsTrigger>
					</TabsList>

					<TabsContent
						value="integration"
						className="m-0 focus-visible:ring-0 focus-visible:outline-none"
					>
						<IntegrationSettings />
					</TabsContent>

					<TabsContent
						value="performance"
						className="m-0 focus-visible:ring-0 focus-visible:outline-none"
					>
						<AdsPerformance />
					</TabsContent>

					<TabsContent
						value='webhook'
						className="m-0 focus-visible:ring-0 focus-visible:outline-none"
					>
						<WebhookLog />
					</TabsContent>
				</Tabs>
			</div>
		</main>
	)
}
