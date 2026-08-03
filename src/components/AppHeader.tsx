import type { ConnectionStatus } from '../lib/types';

interface AppHeaderProps {
  status: ConnectionStatus;
  portInfo: string;
  onOpenConfig: () => void;
}

export default function AppHeader({ status, portInfo, onOpenConfig }: AppHeaderProps) {
  const statusColor =
    status === 'connected' ? 'bg-emerald-400' :
    status === 'connecting' ? 'bg-amber-400 animate-pulse' :
    'bg-gray-400';

  const statusText =
    status === 'connected' ? portInfo :
    status === 'connecting' ? '正在连接...' :
    '未连接';

  return (
    <header className="bg-slate-900 text-white px-4 py-2 flex items-center justify-between select-none">
      <div className="flex items-center gap-3">
        <span className="text-lg font-bold tracking-wide">Mamep2026 Demo</span>
        <span className="text-[10px] text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded border border-slate-700">v0.0.1</span>
        <span className="text-xs text-slate-400 hidden sm:inline">Modbus RTU 调试工具</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm text-slate-300">
          <span className={`inline-block w-2 h-2 rounded-full ${statusColor}`} />
          <span className="hidden sm:inline">{statusText}</span>
        </div>

        <button
          onClick={onOpenConfig}
          className="px-3 py-1.5 text-sm bg-brand-600 hover:bg-brand-700 border border-brand-700 rounded transition-colors"
        >
          ⚙ 串口设置
        </button>

        <button
          disabled
          className="px-3 py-1.5 text-sm bg-slate-700 text-slate-500 border border-slate-600 rounded cursor-not-allowed"
          title="敬请期待"
        >
          🔌 插件
        </button>
      </div>
    </header>
  );
}
