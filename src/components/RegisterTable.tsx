import type { RegisterRow } from '../lib/types';

interface RegisterTableProps {
  rows: RegisterRow[];
  uploading: boolean;
  onTmChange: (rowId: number, checked: boolean) => void;
  onNameChange: (rowId: number, name: string) => void;
  onRegisterHexChange: (rowId: number, hex: string) => void;
  onRead: (rowId: number) => void;
  onDataChange: (rowId: number, data: string) => void;
  onWrite: (rowId: number) => void;
  onTypeChange: (rowId: number, type: 'HEX' | 'Unsigned Dec.' | 'Signed Dec.') => void;
  onCommentChange: (rowId: number, comment: string) => void;
}

export default function RegisterTable({
  rows,
  uploading,
  onTmChange,
  onNameChange,
  onRegisterHexChange,
  onRead,
  onDataChange,
  onWrite,
  onTypeChange,
  onCommentChange,
}: RegisterTableProps) {
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-auto">
        <table className="w-full border-collapse table-fixed">
          <thead>
            <tr className="bg-gray-50 text-sm text-gray-600 sticky top-0 z-10">
              <th className="w-10 px-1 py-1.5 border border-gray-200 font-medium">No</th>
              <th className="w-10 px-1 py-1.5 border border-gray-200 font-medium">TM</th>
              <th className="px-2 py-1.5 border border-gray-200 font-medium text-left">Name</th>
              <th className="w-28 px-2 py-1.5 border border-gray-200 font-medium">Register[HEX]</th>
              <th className="w-10 px-1 py-1.5 border border-gray-200 font-medium">WP</th>
              <th className="w-[72px] px-1 py-1.5 border border-gray-200 font-medium">Read</th>
              <th className="px-2 py-1.5 border border-gray-200 font-medium">Data</th>
              <th className="w-[72px] px-1 py-1.5 border border-gray-200 font-medium">Write</th>
              <th className="w-32 px-2 py-1.5 border border-gray-200 font-medium">Type</th>
              <th className="px-2 py-1.5 border border-gray-200 font-medium text-left">Comment</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.id}
                className={`text-sm transition-colors ${
                  row.error
                    ? 'bg-red-50 border-l-2 border-l-red-400'
                    : row.id % 2 === 0
                      ? 'bg-emerald-50'
                      : 'bg-white'
                }`}
              >
                <td className="px-1 py-1 border border-gray-200 text-center text-gray-500 select-none">
                  {row.id}
                </td>

                <td className="px-1 py-1 border border-gray-200 text-center">
                  <input
                    type="checkbox"
                    checked={row.tm}
                    onChange={(e) => onTmChange(row.id, e.target.checked)}
                    className="w-4 h-4 cursor-pointer accent-brand-600"
                  />
                </td>

                <td className="px-1 py-1 border border-gray-200">
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => onNameChange(row.id, e.target.value)}
                    placeholder="备注"
                    className="w-full px-1 py-0.5 text-sm border border-transparent focus:border-brand-500 focus:outline-none rounded bg-transparent"
                  />
                </td>

                <td className="px-1 py-1 border border-gray-200">
                  <input
                    type="text"
                    value={row.registerHex}
                    onChange={(e) => onRegisterHexChange(row.id, e.target.value)}
                    placeholder="0000"
                    className="w-full px-1 py-0.5 text-sm text-center font-mono border border-transparent focus:border-brand-500 focus:outline-none rounded bg-transparent"
                  />
                </td>

                <td className="px-1 py-1 border border-gray-200 text-center">
                  <input
                    type="radio"
                    disabled
                    checked={false}
                    readOnly
                    className="w-3.5 h-3.5 cursor-not-allowed opacity-30"
                    title="敬请期待"
                  />
                </td>

                <td className="px-1 py-1 border border-gray-200 text-center">
                  <button
                    onClick={() => onRead(row.id)}
                    disabled={uploading || !row.registerHex.trim()}
                    className="px-2 py-0.5 text-xs font-medium bg-brand-600 text-white rounded hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    READ
                  </button>
                </td>

                <td className="px-1 py-1 border border-gray-200">
                  <input
                    type="text"
                    value={row.data}
                    onChange={(e) => onDataChange(row.id, e.target.value)}
                    placeholder={row.tm ? '---' : ''}
                    className="w-full px-1 py-0.5 text-sm text-center font-mono border border-transparent focus:border-brand-500 focus:outline-none rounded bg-transparent"
                  />
                </td>

                <td className="px-1 py-1 border border-gray-200 text-center">
                  <button
                    onClick={() => onWrite(row.id)}
                    disabled={uploading || !row.registerHex.trim()}
                    className="px-2 py-0.5 text-xs font-medium bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    WRITE
                  </button>
                </td>

                <td className="px-1 py-1 border border-gray-200">
                  <select
                    value={row.type}
                    onChange={(e) =>
                      onTypeChange(row.id, e.target.value as 'HEX' | 'Unsigned Dec.' | 'Signed Dec.')
                    }
                    className="w-full px-1 py-0.5 text-xs border border-gray-200 rounded bg-white focus:border-brand-500 focus:outline-none"
                  >
                    <option>HEX</option>
                    <option>Unsigned Dec.</option>
                    <option>Signed Dec.</option>
                  </select>
                </td>

                <td className="px-1 py-1 border border-gray-200">
                  <input
                    type="text"
                    value={row.comment}
                    onChange={(e) => onCommentChange(row.id, e.target.value)}
                    placeholder="注释"
                    className="w-full px-1 py-0.5 text-sm border border-transparent focus:border-brand-500 focus:outline-none rounded bg-transparent"
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2 px-3 py-2 bg-white border-t border-gray-200">
        <button
          disabled
          className="px-3 py-1 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded cursor-not-allowed"
          title="敬请期待"
        >
          + Add Row
        </button>
        <button
          disabled
          className="px-3 py-1 text-sm text-gray-400 bg-gray-50 border border-gray-200 rounded cursor-not-allowed"
          title="敬请期待"
        >
          - Delete Row
        </button>
      </div>
    </div>
  );
}
