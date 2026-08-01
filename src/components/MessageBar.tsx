import { useState } from 'react';

type TabId = 'msg' | 'commlog' | 'commprop' | 'omake';

interface TabDef {
  id: TabId;
  label: string;
  icon?: string;
}

const TABS: TabDef[] = [
  { id: 'msg', label: 'Message List', icon: '⚠' },
  { id: 'commlog', label: 'Comm. Log List' },
  { id: 'commprop', label: 'Comm. properties' },
  { id: 'omake', label: 'OMAKE Note' },
];

const TAB_CONTENT: Record<TabId, string[]> = {
  msg: ['[0001] Wellcome. M@MEp2006 Advance! world'],
  commlog: ['（通信报文日志 — 敬请期待）'],
  commprop: ['（通信属性 — 敬请期待）'],
  omake: ['（自定义备注 — 敬请期待）'],
};

export default function MessageBar() {
  const [activeTab, setActiveTab] = useState<TabId>('msg');

  return (
    <div className="bg-white border-t border-gray-200 select-none">
      <div className="flex items-center bg-gray-100 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1 text-xs border-r border-gray-200 transition-colors ${
              activeTab === tab.id
                ? 'bg-white text-gray-800 font-medium'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-50'
            }`}
          >
            {tab.icon && <span className="mr-1">{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
        <div className="flex-1 bg-gray-100" />
      </div>

      <div className="px-3 py-1.5 text-xs text-gray-600 font-mono bg-gray-50 min-h-[1.75rem]">
        {TAB_CONTENT[activeTab].map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
    </div>
  );
}
