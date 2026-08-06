import React from 'react';
import { MainTab } from '../types';

interface SidebarProps {
  activeTab: MainTab;
  setActiveTab: (tab: MainTab) => void;
  onOpenDocs: () => void;
  onOpenSupport: () => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  onOpenDocs,
  onOpenSupport,
  isMobileOpen,
  setIsMobileOpen,
}) => {
  const navItems: { id: MainTab; label: string; icon: string }[] = [
    { id: 'dashboard', label: '控制台概览', icon: 'dashboard' },
    { id: 'alert-rules', label: '告警规则管理', icon: 'notification_important' },
    { id: 'error-scan', label: '错误日志分析告警', icon: 'error' },
    { id: 'notification-channels', label: '通知渠道配置', icon: 'hub' },
    { id: 'api-keys', label: 'API 密钥管理', icon: 'vpn_key' },
  ];

  const sidebarContent = (
    <div className="flex flex-col h-full py-6 px-4 gap-2 bg-[#f2f4f6] border-r border-[#c3c6d7] w-64 shrink-0">
      <div className="px-2 mb-6">
        <h1 className="text-[20px] leading-[28px] tracking-[-0.01em] font-black text-[#004ac6]">
          AI Gateway
        </h1>
        <p className="text-[12px] leading-[16px] tracking-[0.05em] font-medium text-[#434655]">
          网关告警控制台
        </p>
      </div>

      <nav className="flex-1 space-y-1">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveTab(item.id);
                setIsMobileOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-left text-[14px] leading-[20px] font-medium rounded-lg transition-all ${
                isActive
                  ? 'bg-[#d0e1fb] text-[#004ac6] font-bold shadow-xs'
                  : 'text-[#434655] hover:bg-[#e0e3e5]'
              }`}
            >
              <span className="material-symbols-outlined text-[20px] shrink-0">{item.icon}</span>
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </nav>

      <div className="mt-auto pt-4 border-t border-[#c3c6d7] space-y-1">
        <button
          onClick={() => {
            onOpenDocs();
            setIsMobileOpen(false);
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-[#434655] hover:bg-[#e0e3e5] transition-all text-[13px] leading-[18px] font-medium rounded-lg"
        >
          <span className="material-symbols-outlined text-[18px] shrink-0">description</span>
          <span className="truncate">使用文档</span>
        </button>
        <button
          onClick={() => {
            onOpenSupport();
            setIsMobileOpen(false);
          }}
          className="w-full flex items-center gap-3 px-3 py-2.5 text-left text-[#434655] hover:bg-[#e0e3e5] transition-all text-[13px] leading-[18px] font-medium rounded-lg"
        >
          <span className="material-symbols-outlined text-[18px] shrink-0">help</span>
          <span className="truncate">技术支持与帮助</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex flex-col h-full shrink-0">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Overlay */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs"
            onClick={() => setIsMobileOpen(false)}
          />
          <div className="relative z-10 w-64 h-full bg-[#f2f4f6]">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};
