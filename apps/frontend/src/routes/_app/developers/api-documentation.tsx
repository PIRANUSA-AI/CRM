import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon } from 'lucide-react'

import { developersBackButtonClass } from './-model'

function DevelopersApiDocumentationPage() {
	return (
		<div className="flex-1 flex flex-col h-full bg-white px-6 py-8">
			<Link
				to="/developers"
				className={developersBackButtonClass}
			>
				<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
				Back to Developers
			</Link>

			<header className="space-y-1">
				<h1
					className="text-2xl font-semibold text-gray-900"
					data-testid="api-documentation-page-title"
				>
					API Documentation
				</h1>
				<p
					className="text-sm text-gray-500"
					data-testid="api-documentation-page-description"
				>
					Browse the available endpoints, request schemas, and example payloads
					used by CRM.
				</p>
			</header>

			<section className="mt-6 rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-6 text-sm text-gray-600">
				<p>
					We surface a simple reference here until the full spec is published.
					Reach out to
					<span className="font-medium text-gray-900"> the API team</span> for
					detailed contracts.
				</p>
			</section>
		</div>
	)
}

export const Route = createFileRoute('/_app/developers/api-documentation')({
	component: DevelopersApiDocumentationPage,
})
