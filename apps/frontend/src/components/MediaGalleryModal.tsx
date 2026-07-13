import { useState, useEffect, useCallback, useRef } from 'react'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Spinner } from '@/components/ui/spinner'
import {
	Upload,
	Image as ImageIcon,
	FileText,
	Film,
	Music,
	File,
	Check,
} from 'lucide-react'
import { media } from '@/lib/api'

interface GalleryFile {
	id: string
	media_type: string | null
	mime_type: string | null
	filename: string | null
	file_size: number | null
	url: string | null
	created_at: string | null
}

interface MediaGalleryModalProps {
	open: boolean
	onClose: () => void
	onSelectFile: (file: GalleryFile) => void
	onUploadNew: () => void
	platform?: 'whatsapp' | 'instagram' | 'tiktok'
}

function formatFileSize(bytes: number | null) {
	if (!bytes) return ''
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function FileTypeIcon({ type }: { type: string | null }) {
	switch (type) {
		case 'image':
			return <ImageIcon className="w-5 h-5" />
		case 'video':
			return <Film className="w-5 h-5" />
		case 'audio':
			return <Music className="w-5 h-5" />
		case 'document':
			return <FileText className="w-5 h-5" />
		default:
			return <File className="w-5 h-5" />
	}
}

export function MediaGalleryModal({
	open,
	onClose,
	onSelectFile,
	onUploadNew,
}: MediaGalleryModalProps) {
	const [files, setFiles] = useState<GalleryFile[]>([])
	const [loading, setLoading] = useState(false)
	const [activeTab, setActiveTab] = useState('all')
	const [selected, setSelected] = useState<GalleryFile | null>(null)
	const [previewFile, setPreviewFile] = useState<GalleryFile | null>(null)
	const fetchedRef = useRef(false)

	const fetchGallery = useCallback(
		async (type?: string) => {
			setLoading(true)
			const result = await media.gallery({
				type: type === 'all' ? undefined : type,
				take: 30,
			})
			if (result.success && result.payload) {
				setFiles(result.payload)
			}
			setLoading(false)
		},
		[],
	)

	useEffect(() => {
		if (open && !fetchedRef.current) {
			fetchedRef.current = true
			fetchGallery()
		}
		if (!open) {
			fetchedRef.current = false
			setSelected(null)
			setPreviewFile(null)
			setActiveTab('all')
		}
	}, [open, fetchGallery])

	const handleTabChange = (value: unknown) => {
		const tab = String(value)
		setActiveTab(tab)
		setSelected(null)
		fetchGallery(tab === 'all' ? undefined : tab)
	}

	const handleConfirm = () => {
		if (selected) {
			onSelectFile(selected)
			onClose()
		}
	}

	return (
		<Dialog open={open} onOpenChange={(o) => !o && onClose()}>
			<DialogContent className="sm:max-w-2xl max-h-[80vh] flex flex-col">
				<DialogHeader>
					<DialogTitle>Media Gallery</DialogTitle>
				</DialogHeader>

				<Tabs
					value={activeTab}
					onValueChange={handleTabChange}
				>
					<div className="flex items-center justify-between gap-2">
						<TabsList variant="line">
							<TabsTrigger value="all">All</TabsTrigger>
							<TabsTrigger value="image">Images</TabsTrigger>
							<TabsTrigger value="video">Videos</TabsTrigger>
							<TabsTrigger value="document">Docs</TabsTrigger>
							<TabsTrigger value="audio">Audio</TabsTrigger>
						</TabsList>
						<Button
							variant="outline"
							size="sm"
							onClick={() => {
								onClose()
								onUploadNew()
							}}
						>
							<Upload className="w-4 h-4" data-icon="inline-start" />
							Upload New
						</Button>
					</div>

					<TabsContent value={activeTab} className="mt-2">
						{loading ? (
							<div className="flex items-center justify-center py-12">
								<Spinner className="w-6 h-6" />
							</div>
						) : files.length === 0 ? (
							<div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
								<ImageIcon className="w-10 h-10" />
								<p className="text-sm">No files yet</p>
								<Button
									variant="outline"
									size="sm"
									onClick={() => {
										onClose()
										onUploadNew()
									}}
								>
									Upload your first file
								</Button>
							</div>
						) : (
							<ScrollArea className="h-[400px]">
								{/* Preview area */}
								{previewFile && previewFile.media_type === 'image' && previewFile.url && (
									<div className="mb-3 rounded-lg overflow-hidden border bg-gray-50">
										<img
											src={previewFile.url}
											alt={previewFile.filename || 'Preview'}
											className="w-full max-h-48 object-contain"
										/>
									</div>
								)}
								{previewFile && previewFile.media_type === 'video' && previewFile.url && (
									<div className="mb-3 rounded-lg overflow-hidden border bg-gray-50">
										<video
											src={previewFile.url}
											className="w-full max-h-48"
											controls
										/>
									</div>
								)}

								{/* Grid */}
								<div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
									{files.map((file) => {
										const isSelected = selected?.id === file.id
										return (
											<button
												key={file.id}
												type="button"
												onClick={() => {
													setSelected(isSelected ? null : file)
													setPreviewFile(isSelected ? null : file)
												}}
												className={`relative group rounded-lg border overflow-hidden transition-all text-left ${
													isSelected
														? 'ring-2 ring-emerald-500 border-emerald-500'
														: 'hover:border-gray-300'
												}`}
											>
												{file.media_type === 'image' && file.url ? (
													<img
														src={file.url}
														alt={file.filename || ''}
														className="w-full h-24 object-cover"
													/>
												) : (
													<div className="w-full h-24 flex flex-col items-center justify-center gap-1 bg-gray-50 text-gray-500">
														<FileTypeIcon type={file.media_type} />
														<span className="text-[10px] px-1 truncate max-w-full">
															{file.filename || 'Untitled'}
														</span>
													</div>
												)}
												<div className="px-1.5 py-1 text-[10px] text-gray-500 truncate">
													{file.filename || 'Untitled'}
													{file.file_size ? (
														<span className="ml-1">
															· {formatFileSize(file.file_size)}
														</span>
													) : null}
												</div>
												{isSelected && (
													<div className="absolute top-1 right-1 bg-emerald-500 text-white rounded-full p-0.5">
														<Check className="w-3 h-3" />
													</div>
												)}
											</button>
										)
									})}
								</div>
							</ScrollArea>
						)}
					</TabsContent>
				</Tabs>

				{selected && (
					<div className="flex justify-end gap-2 pt-2 border-t">
						<Button variant="outline" size="sm" onClick={() => setSelected(null)}>
							Cancel
						</Button>
						<Button size="sm" onClick={handleConfirm}>
							Send File
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	)
}
