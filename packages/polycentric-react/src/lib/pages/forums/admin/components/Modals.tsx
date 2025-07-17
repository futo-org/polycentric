interface BanUserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBan: () => void;
  banReason: string;
  setBanReason: (reason: string) => void;
  isBanning: boolean;
}

export function BanUserModal({
  isOpen,
  onClose,
  onBan,
  banReason,
  setBanReason,
  isBanning,
}: BanUserModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-md w-full mx-4">
        <h3 className="text-lg font-medium mb-4">Ban User</h3>
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-2">
            Reason (optional)
          </label>
          <textarea
            value={banReason}
            onChange={(e) => setBanReason(e.target.value)}
            rows={3}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
            placeholder="Enter reason for banning this user..."
          />
        </div>
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300"
          >
            Cancel
          </button>
          <button
            onClick={onBan}
            disabled={isBanning}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50"
          >
            {isBanning ? 'Banning...' : 'Ban User'}
          </button>
        </div>
      </div>
    </div>
  );
}
