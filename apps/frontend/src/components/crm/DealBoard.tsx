import {
	DndContext,
	DragOverlay,
	PointerSensor,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
	type DragEndEvent,
	type DragStartEvent,
} from '@dnd-kit/core'
import { Building2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DealColumn, DealStage, Opportunity } from '@/lib/api'

/**
 * The deal board.
 *
 * One column per stage, in the order the sales team already reads them. Won is a
 * single column filtered by year rather than the two literal "Won 2025" / "Won
 * 2026" columns it replaces. A year is a property of when a deal closed, not a
 * step in how it closed, and stages-per-year means somebody has to create a
 * column every January and drag deals into it.
 */

const IDR = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0,
})

function formatValue(value: number | null): string {
	if (!value) return '-'
	return IDR.format(value)
}

function formatDate(value: string | null): string {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: '2-digit' })
}

/** How long the deal has sat in its current column. The board's staleness signal. */
function daysAtStage(value: string | null): number | null {
	if (!value) return null
	const then = new Date(value).getTime()
	if (Number.isNaN(then)) return null
	return Math.max(0, Math.floor((Date.now() - then) / 86_400_000))
}

function DealCard({ deal, onOpen }: { deal: Opportunity; onOpen: (deal: Opportunity) => void }) {
	const days = daysAtStage(deal.stageChangedAt)
	// Two weeks without moving is the point where a leader wants to notice. Only
	// flagged on open deals: a won deal sitting still is not a problem.
	const stale = deal.status === 'open' && days !== null && days >= 14

	return (
		<div className="rounded-lg border border-border bg-card p-2.5 shadow-sm">
			<button
				type="button"
				onClick={() => onOpen(deal)}
				className="block w-full truncate text-left text-[13px] font-semibold text-primary hover:underline"
			>
				{deal.name}
			</button>
			{deal.value ? (
				<p className="mt-0.5 text-xs font-medium tabular-nums">{formatValue(deal.value)}</p>
			) : null}
			<p className="mt-0.5 truncate text-[11px] text-muted-foreground">
				{deal.contactName || 'Tanpa kontak'}
			</p>
			{deal.companyName ? (
				<p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
					<Building2 size={10} className="shrink-0" />
					<span className="truncate">{deal.companyName}</span>
				</p>
			) : null}
			<dl className="mt-2 space-y-0.5 text-[10px] leading-tight text-muted-foreground">
				<div className="flex justify-between gap-2">
					<dt>Dibuat</dt>
					<dd className="tabular-nums">{formatDate(deal.createdAt)}</dd>
				</div>
				<div className="flex justify-between gap-2">
					<dt>Diperbarui</dt>
					<dd className="tabular-nums">{formatDate(deal.updatedAt)}</dd>
				</div>
			</dl>
			<div className="mt-1.5 flex items-center justify-between gap-2">
				<span className="truncate text-[10px] text-muted-foreground">{deal.ownerName || '-'}</span>
				<span
					className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums ${
						stale ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'text-muted-foreground'
					}`}
					title={stale ? 'Belum bergerak lebih dari dua minggu' : undefined}
				>
					{days === null ? '-' : `${days} hari di tahap ini`}
				</span>
			</div>
		</div>
	)
}

function DraggableCard({
	deal,
	onOpen,
}: {
	deal: Opportunity
	onOpen: (deal: Opportunity) => void
}) {
	const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: deal.id })
	return (
		<div
			ref={setNodeRef}
			{...listeners}
			{...attributes}
			// The card stays in place while dragging and the DragOverlay follows the
			// cursor instead, so the column below does not reflow under the pointer.
			className={`cursor-grab touch-none active:cursor-grabbing ${isDragging ? 'opacity-40' : ''}`}
		>
			<DealCard deal={deal} onOpen={onOpen} />
		</div>
	)
}

function StageColumn({
	stage,
	deals,
	count,
	total,
	onOpen,
	onLoadMore,
	loadingMore,
	headerExtra,
}: {
	stage: DealStage
	deals: Opportunity[]
	/** The whole column, which may be larger than `deals`. */
	count: number
	total: number
	onOpen: (deal: Opportunity) => void
	onLoadMore: (stageId: string) => void
	loadingMore: boolean
	headerExtra?: React.ReactNode
}) {
	const { setNodeRef, isOver } = useDroppable({ id: stage.id })
	const hidden = Math.max(0, count - deals.length)

	return (
		<div className="flex w-64 shrink-0 flex-col">
			<div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2">
				<span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide">
					{stage.label}
					{stage.probability === null ? '' : ` ${stage.probability}%`}
				</span>
				<span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary">
					{count}
				</span>
			</div>
			{headerExtra}
			<div
				ref={setNodeRef}
				className={`flex-1 space-y-2 rounded-lg p-1 transition-colors ${
					isOver ? 'bg-primary/10 ring-1 ring-primary/40' : ''
				}`}
			>
				{deals.map((deal) => (
					<DraggableCard key={deal.id} deal={deal} onOpen={onOpen} />
				))}
				{deals.length === 0 ? (
					<p className="rounded-lg border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
						Kosong
					</p>
				) : null}
				{hidden > 0 ? (
					<button
						type="button"
						onClick={() => onLoadMore(stage.id)}
						disabled={loadingMore}
						className="w-full rounded-lg border border-dashed border-border p-2 text-center text-[10px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
					>
						{loadingMore ? 'Memuat...' : `Muat ${hidden} lagi`}
					</button>
				) : null}
			</div>
			<div className="mt-2 border-t border-border px-2 py-1.5 text-right text-[11px] font-semibold tabular-nums">
				TOTAL: {total ? IDR.format(total) : 'Rp 0'}
			</div>
		</div>
	)
}

export function DealBoard({
	stages,
	columns,
	wonYear,
	wonYears,
	onWonYearChange,
	onMove,
	onOpen,
	onLoadMore,
	loadingStage,
}: {
	stages: DealStage[]
	/** Server-side per-stage totals plus the cards to render. */
	columns: DealColumn[]
	wonYear: string
	wonYears: string[]
	onWonYearChange: (year: string) => void
	onMove: (deal: Opportunity, stageId: string) => void
	onOpen: (deal: Opportunity) => void
	onLoadMore: (stageId: string) => void
	/** The one column currently fetching its next page, if any. */
	loadingStage: string | null
}) {
	const [draggingId, setDraggingId] = useState<string | null>(null)

	// A small drag threshold, so clicking a card title still opens the editor
	// rather than being swallowed as a drag.
	const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

	const columnByStage = useMemo(
		() => new Map(columns.map((column) => [column.stage, column])),
		[columns],
	)

	const loadedDeals = useMemo(() => columns.flatMap((column) => column.deals), [columns])

	const handleDragEnd = (event: DragEndEvent) => {
		setDraggingId(null)
		const stageId = event.over?.id
		if (typeof stageId !== 'string') return
		const deal = loadedDeals.find((row) => row.id === event.active.id)
		if (!deal || deal.stage === stageId) return
		onMove(deal, stageId)
	}

	const dragging = draggingId ? loadedDeals.find((deal) => deal.id === draggingId) : null

	return (
		<DndContext
			sensors={sensors}
			onDragStart={(event: DragStartEvent) => setDraggingId(String(event.active.id))}
			onDragCancel={() => setDraggingId(null)}
			onDragEnd={handleDragEnd}
		>
			<div className="overflow-x-auto p-3">
				<div className="flex items-stretch gap-3">
					{stages.map((stage) => {
						const column = columnByStage.get(stage.id)
						return (
							<StageColumn
								key={stage.id}
								stage={stage}
								deals={column?.deals ?? []}
								count={column?.count ?? 0}
								total={column?.value ?? 0}
								onOpen={onOpen}
								onLoadMore={onLoadMore}
								loadingMore={loadingStage === stage.id}
								headerExtra={
									stage.status === 'won' && wonYears.length > 1 ? (
										<select
											value={wonYear}
											onChange={(event) => onWonYearChange(event.target.value)}
											className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1 text-[11px] focus:outline-none focus:ring-2 focus:ring-ring"
											aria-label="Filter tahun deal menang"
										>
											<option value="all">Semua tahun</option>
											{wonYears.map((year) => (
												<option key={year} value={year}>
													{year}
												</option>
											))}
										</select>
									) : null
								}
							/>
						)
					})}
				</div>
			</div>

			<DragOverlay dropAnimation={null}>
				{dragging ? (
					<div className="w-64 rotate-1">
						<DealCard deal={dragging} onOpen={() => undefined} />
					</div>
				) : null}
			</DragOverlay>
		</DndContext>
	)
}
