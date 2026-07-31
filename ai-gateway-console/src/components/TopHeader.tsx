import React, { useState } from 'react';
import { HeaderSubTab } from '../types';

interface TopHeaderProps {
  currentSubTab: HeaderSubTab;
  setSubTab: (tab: HeaderSubTab) => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  onCreateRule: () => void;
  onToggleMobileSidebar: () => void;
}

export const TopHeader: React.FC<TopHeaderProps> = ({
  currentSubTab,
  setSubTab,
  searchQuery,
  setSearchQuery,
  onCreateRule,
  onToggleMobileSidebar,
}) => {
  const [showUserDropdown, setShowUserDropdown] = useState(false);

  const subTabs: HeaderSubTab[] = ['规则', '监控', '日志', '设置'];

  return (
    <header className="bg-[#f7f9fb] border-b border-[#c3c6d7] z-10 sticky top-0 shadow-2xs">
      <div className="flex justify-between items-center w-full px-4 md:px-8 max-w-[1440px] mx-auto h-16 gap-4 md:gap-8">
        <div className="flex items-center gap-4 md:gap-8 flex-1 min-w-0">
          {/* Mobile menu button */}
          <button
            onClick={onToggleMobileSidebar}
            className="md:hidden p-1.5 text-[#434655] hover:bg-[#e0e3e5] rounded-lg transition-colors"
            title="切换菜单"
          >
            <span className="material-symbols-outlined text-[24px]">menu</span>
          </button>

          <div className="flex items-center gap-2 shrink-0">
            <span className="text-[18px] md:text-[20px] leading-[28px] font-bold text-[#004ac6] tracking-[-0.01em]">
              tt-inspector
            </span>
            <span className="hidden sm:inline-block px-2 py-0.5 bg-[#d0e1fb] text-[#003ea8] text-[10px] font-bold rounded tracking-wider">
              网关 v2.4
            </span>
          </div>

          {/* Search Box */}
          <div className="relative w-full max-w-xs md:max-w-sm">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[#434655] text-[18px]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索规则、模型、告警日志..."
              className="w-full bg-[#f2f4f6] border border-[#c3c6d7] rounded-lg pl-9 pr-8 py-1.5 text-[13px] text-[#191c1e] focus:ring-2 focus:ring-[#004ac6] focus:border-transparent outline-none transition-all placeholder:text-[#737686]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#737686] hover:text-[#191c1e] text-[16px]"
              >
                ×
              </button>
            )}
          </div>

          {/* Sub Nav Tabs */}
          <nav className="hidden lg:flex items-center gap-6 h-full pt-1">
            {subTabs.map((tab) => {
              const isActive = currentSubTab === tab;
              return (
                <button
                  key={tab}
                  onClick={() => setSubTab(tab)}
                  className={`font-semibold text-[13px] leading-[18px] py-1 transition-all rounded px-2.5 ${
                    isActive
                      ? 'text-[#004ac6] border-b-2 border-[#004ac6] font-bold'
                      : 'text-[#434655] hover:bg-[#eceef0]'
                  }`}
                >
                  {tab}
                </button>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={onCreateRule}
            className="bg-[#004ac6] text-white font-semibold text-[13px] leading-[18px] px-3.5 py-2 rounded-lg hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 shadow-xs whitespace-nowrap"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            <span className="hidden sm:inline">创建规则</span>
          </button>

          {/* Profile User Icon */}
          <div className="relative">
            <button
              onClick={() => setShowUserDropdown(!showUserDropdown)}
              className="h-9 w-9 rounded-full bg-primary flex items-center justify-center border border-primary hover:ring-2 hover:ring-[#2563eb] transition-all"
              title="用户"
            >
              <span className="material-symbols-outlined text-white text-[20px]">person</span>
            </button>

            {showUserDropdown && (
              <div className="absolute right-0 mt-2 w-56 bg-white border border-[#c3c6d7] rounded-xl shadow-lg p-2 z-50 animate-scale-in">
                <div className="px-3 py-2 border-b border-[#e6e8ea]">
                  <p className="text-[14px] font-semibold text-[#191c1e]">Admin</p>
                  <p className="text-[12px] text-[#434655]">Administrator</p>
                  <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 bg-[#d0e1fb] text-[#003ea8] rounded font-semibold">
                    超级管理员
                  </span>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => {
                      setSubTab('设置');
                      setShowUserDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#434655] hover:bg-[#f2f4f6] rounded-lg flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">settings</span>
                    网关全局设置
                  </button>
                  <button
                    onClick={() => setShowUserDropdown(false)}
                    className="w-full text-left px-3 py-2 text-[13px] text-[#ba1a1a] hover:bg-[#ffdad6] rounded-lg flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">logout</span>
                    退出登录
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Sub Tabs Mobile Ribbon */}
      <div className="lg:hidden flex border-t border-[#c3c6d7] px-4 py-1.5 gap-2 bg-[#f2f4f6] overflow-x-auto">
        {subTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-3 py-1 rounded-md text-[12px] font-semibold whitespace-nowrap transition-colors ${
              currentSubTab === tab
                ? 'bg-[#004ac6] text-white shadow-xs'
                : 'text-[#434655] hover:bg-[#e0e3e5]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>
    </header>
  );
};
