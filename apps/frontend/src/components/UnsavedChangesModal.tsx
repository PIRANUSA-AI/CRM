import type React from 'react'

interface UnsavedChangesModalProps {
	isOpen: boolean
	onClose: () => void
	onSave: () => void
	onDiscard: () => void
}

const UnsavedChangesModal: React.FC<UnsavedChangesModalProps> = ({
	isOpen,
	onClose,
	onSave,
	onDiscard,
}) => {
	if (!isOpen) return null

	return (
		<div className="fixed inset-0 flex items-center justify-center z-[100] bg-black bg-opacity-40 animate-in fade-in duration-200">
			<div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
				<div className="flex justify-end">
					<button
						onClick={onClose}
						className="text-2xl font-semibold cursor-pointer text-gray-400 hover:text-gray-600 transition p-1"
					>
						&times;
					</button>
				</div>
				<div className="text-center">
					<h3 className="text-xl font-bold mb-1 text-gray-900">
						You have unsaved changes
					</h3>
					<p className="text-sm text-gray-500 mb-6">
						Would you like to save your changes before do any action?
					</p>
				</div>
				<div className="w-full flex justify-center gap-4 px-2">
					<button
						onClick={onSave}
						className="w-full px-4 py-2.5 bg-[#0A7AFE] text-white font-semibold rounded-lg hover:bg-[#0861CB] transition shadow-sm"
					>
						Save
					</button>
					<button
						onClick={onDiscard}
						className="w-full px-4 py-2.5 rounded-lg text-[#0A7AFE] font-semibold border border-[#0A7AFE] hover:bg-blue-50 transition"
					>
						Discard
					</button>
				</div>
			</div>
		</div>
	)
}

export default UnsavedChangesModal
