interface TabToolbarProps {
  uploading: boolean;
  onUpload: () => void;
}

export default function TabToolbar({ uploading, onUpload }: TabToolbarProps) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-white border-b border-gray-200 select-none">
      <button
        onClick={onUpload}
        disabled={uploading}
        className={`px-4 py-1 text-sm font-medium rounded transition-colors ${
          uploading
            ? 'bg-indigo-100 text-indigo-400 cursor-not-allowed'
            : 'bg-brand-600 text-white hover:bg-brand-700 active:bg-brand-700'
        }`}
      >
        {uploading ? 'Uploading...' : 'Upload'}
      </button>

      <button
        disabled
        className="px-4 py-1 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded cursor-not-allowed"
        title="Coming Soon"
      >
        Enter(ROM)
      </button>

      <button
        disabled
        className="px-4 py-1 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded cursor-not-allowed"
        title="Coming Soon"
      >
        Enter(RAM)
      </button>

      <div className="w-px h-6 bg-gray-200 mx-1" />

      <span className="text-sm text-gray-400">Slave Address</span>
      <select
        disabled
        defaultValue="31"
        className="px-2 py-1 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded cursor-not-allowed"
      >
        <option>31</option>
      </select>
    </div>
  );
}
