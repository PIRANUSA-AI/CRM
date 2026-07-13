import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronLeft, MessageCircle, ExternalLink, Code } from 'lucide-react'

export const Route = createFileRoute('/_app/channels/livechat')({
	component: LiveChatChannelPage,
})

function LiveChatChannelPage() {
	const appId =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_app_id') || ''
			: ''

	return (
		<div className="flex h-screen bg-gray-50">
			<div className="flex-1 flex flex-col overflow-hidden">
				{/* Header */}
				<div className="bg-white p-6 pb-0">
					<div className="flex items-center gap-2 text-sm text-teal-600 mb-4">
						<Link
							to="/integration"
							className="hover:underline flex items-center gap-1"
						>
							<ChevronLeft size={16} />
							Integration
						</Link>
					</div>
					<div className="flex items-center gap-3 mb-4">
						<div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
							<MessageCircle className="text-white" size={18} />
						</div>
						<h1 className="text-2xl font-bold text-gray-900">CRM Live</h1>
					</div>
					<div className="flex gap-4 border-b border-gray-200">
						<button className="pb-3 px-1 font-medium text-sm text-gray-900 border-b-2 border-gray-900">
							Installation
						</button>
						<button className="pb-3 px-1 font-medium text-sm text-gray-500 hover:text-gray-700">
							Customization
						</button>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3">
					<div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4 mb-6">
						<p className="text-sm text-gray-700">
							Embed the CRM widget on your website to chat with visitors
							in real-time.
						</p>
					</div>

					<div className="bg-white rounded-xl border border-gray-200 p-6 max-w-3xl">
						<h3 className="text-lg font-medium text-gray-900 mb-4 flex items-center gap-2">
							<Code size={20} className="text-emerald-500" />
							Installation Code
						</h3>
						<p className="text-sm text-gray-600 mb-4">
							Copy and paste this code before the closing{' '}
							<code className="bg-gray-100 px-1 rounded">{'</body>'}</code> tag
							on every page of your website.
						</p>

						<div className="bg-gray-900 rounded-lg p-4 text-gray-300 font-mono text-sm overflow-x-auto">
							<pre>{`<script>
  window.scaleChatConfig = {
    appId: "${appId}"
  };
  (function(d, s, id) {
    var js, fjs = d.getElementsByTagName(s)[0];
    if (d.getElementById(id)) return;
    js = d.createElement(s); js.id = id;
    js.src = "https://cdn.crm.chat/widget.js";
    fjs.parentNode.insertBefore(js, fjs);
  }(document, 'script', 'scalechat-jssdk'));
</script>`}</pre>
						</div>

						<div className="mt-4 flex justify-end">
							<button className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium">
								Copy Code
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
