import { Link, createFileRoute } from '@tanstack/react-router'
import { ArrowLeftIcon, DownloadIcon } from 'lucide-react'

import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import {
	developersBackButtonClass,
	messagesFixtures,
	resolveMessagesState,
} from './-model'

const statusPillClasses: Record<'delivered' | 'read' | 'failed', string> = {
	delivered: 'bg-emerald-50 text-emerald-700',
	read: 'bg-blue-50 text-blue-700',
	failed: 'bg-destructive/10 text-destructive',
}

function DevelopersMessagesSentByApiPage() {
	const search = Route.useSearch()
	const requestedState = (search as { state?: string }).state
	const state = resolveMessagesState(requestedState)
	const fixture = messagesFixtures[state]
	const rows = fixture.rows ?? []

	return (
		<div className="flex-1 flex flex-col h-full bg-white px-6 py-8">
			<Link
				to="/developers"
				data-testid="messages-api-back-button"
				className={developersBackButtonClass}
			>
				<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
				Back to Developers
			</Link>

			<header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div className="space-y-1">
					<h1
						className="text-2xl font-semibold text-gray-900"
						data-testid="messages-api-page-title"
					>
						Messages sent by API
					</h1>
					<p
						className="text-sm text-gray-500"
						data-testid="messages-api-page-description"
					>
						Review API-delivered message events in a deterministic table view.
					</p>
				</div>

				<button
					type="button"
					disabled
					data-testid="messages-api-export-action"
					className={buttonVariants({ variant: 'outline', size: 'sm' })}
				>
					<DownloadIcon className="size-4" aria-hidden="true" />
					Export to Excel
				</button>
			</header>

			<section
				className="mt-6 space-y-4"
				data-testid="messages-api-table-shell"
			>
				<div>
					<p className="text-lg font-semibold text-gray-900">
						{fixture.heading}
					</p>
					<p className="text-sm text-gray-500">{fixture.description}</p>
				</div>

				<div className="rounded-2xl border border-gray-100 bg-white p-1 overflow-x-auto">
					<Table data-testid="messages-api-table" className="min-w-[760px]">
						<TableHeader className="bg-gray-50">
							<TableRow>
								<TableHead>MESSAGE</TableHead>
								<TableHead>CREATED AT</TableHead>
								<TableHead>STATUS</TableHead>
								<TableHead>ERROR</TableHead>
								<TableHead>INBOX</TableHead>
								<TableHead>CONTACT</TableHead>
								<TableHead>ACTIONS</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{state === 'ready' && rows.length > 0 ? (
								rows.map((row) => (
									<TableRow key={row.id}>
										<TableCell className="font-medium text-gray-900">
											{row.message}
										</TableCell>
										<TableCell className="text-gray-500">
											{row.createdAt}
										</TableCell>
										<TableCell>
											<span
												className={cn(
													'inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold capitalize',
													statusPillClasses[row.status],
												)}
											>
												{row.status}
											</span>
										</TableCell>
										<TableCell className="text-xs text-destructive">
											{row.error ?? '—'}
										</TableCell>
										<TableCell className="text-gray-500">{row.inbox}</TableCell>
										<TableCell className="text-gray-500">
											{row.contact}
										</TableCell>
										<TableCell className="text-blue-600 underline">
											{row.actionLabel}
										</TableCell>
									</TableRow>
								))
							) : (
								<TableRow>
									<TableCell
										colSpan={7}
										className="whitespace-normal px-4 py-8 text-center text-sm text-gray-500"
									>
										<p>{fixture.description}</p>
										{fixture.errorText ? (
											<p className="mt-2 text-xs font-semibold text-destructive">
												{fixture.errorText}
											</p>
										) : null}
									</TableCell>
								</TableRow>
							)}
						</TableBody>
					</Table>
				</div>
			</section>
		</div>
	)
}

export const Route = createFileRoute('/_app/developers/messages-sent-by-api')({
	component: DevelopersMessagesSentByApiPage,
})
