interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: string;
  active: boolean;
  disabled: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'register', label: 'Project Bar (Register Mode)', icon: '📋', active: true, disabled: false },
  { id: 'address', label: 'Project Bar (Address Mode)', icon: '📁', active: false, disabled: true },
];

export default function Sidebar({ collapsed, onToggle }: SidebarProps) {
  return (
    <aside
      className={`flex-shrink-0 bg-slate-50 border-r border-gray-200 flex flex-col select-none transition-all duration-200 ${
        collapsed ? 'w-12' : 'w-52'
      }`}
    >
      {/* Toggle 按钮 */}
      <div className="flex justify-end px-1 py-2">
        <button
          onClick={onToggle}
          className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors text-xs"
          title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
        >
          {collapsed ? '▶' : '◀'}
        </button>
      </div>

      {/* 导航项 */}
      <div className="flex flex-col gap-0.5 px-1.5">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            disabled={item.disabled}
            title={collapsed ? item.label : undefined}
            className={`flex items-center gap-2.5 px-2 py-2 text-sm rounded transition-colors ${
              item.active
                ? 'bg-brand-50 text-brand-700 font-medium'
                : item.disabled
                  ? 'text-gray-400 cursor-not-allowed'
                  : 'text-gray-600 hover:bg-gray-100'
            } ${collapsed ? 'justify-center px-1' : ''}`}
          >
            <span className="text-base flex-shrink-0">{item.icon}</span>
            <span
              className={`truncate transition-opacity duration-200 ${
                collapsed ? 'opacity-0 w-0 overflow-hidden' : 'opacity-100'
              }`}
            >
              {item.label}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}
