import React, { useState } from 'react';
import { AlertRule, RuleType } from '../types';

interface AlertRulesViewProps {
  rules: AlertRule[];
  searchQuery: string;
  onToggleRule: (ruleId: string) => void;
  onEditRule: (rule: AlertRule) => void;
  onDeleteRule: (ruleId: string) => void;
  onDuplicateRule: (rule: AlertRule) => void;
  onTestRule: (rule: AlertRule) => void;
  onCreateRule: () => void;
}

export const AlertRulesView: React.FC<AlertRulesViewProps> = ({
  rules,
  searchQuery,
  onToggleRule,
  onEditRule,
  onDeleteRule,
  onDuplicateRule,
  onTestRule,
  onCreateRule,
}) => {
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<'全部' | RuleType>('全部');
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  const filterTabs: { id: '全部' | RuleType; label: string }[] = [
    { id: '全部', label: '全部规则' },
    { id: 'Regex', label: '正则匹配' },
    { id: 'Error Rate', label: '错误率' },
    { id: 'Token', label: 'Token 消耗' },
    { id: 'Latency', label: '响应延迟' },
  ];

  const filteredRules = rules.filter((rule) => {
    // Type Filter
    if (selectedTypeFilter !== '全部' && rule.type !== selectedTypeFilter) {
      return false;
    }
    // Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      return (
        rule.name.toLowerCase().includes(q) ||
        rule.channel.toLowerCase().includes(q) ||
        rule.model.toLowerCase().includes(q) ||
        (rule.pattern && rule.pattern.toLowerCase().includes(q)) ||
        (rule.description && rule.description.toLowerCase().includes(q))
      );
    }
    return true;
  });

  const getTypeBadgeStyle = (type: RuleType) => {
    switch (type) {
      case 'Regex':
        return 'bg-[#d0e1fb] text-[#003ea8]';
      case 'Token':
        return 'bg-[#bdffdb] text-[#005236]';
      case 'Error Rate':
        return 'bg-[#ffdad6] text-[#93000a]';
      case 'Latency':
        return 'bg-[#dbe1ff] text-[#003ea8]';
      default:
        return 'bg-[#e0e3e5] text-[#434655]';
    }
  };

  const getTypeLabel = (type: RuleType) => {
    switch (type) {
      case 'Regex': return '正则匹配';
      case 'Token': return 'Token 消耗';
      case 'Error Rate': return '错误率';
      case 'Latency': return '响应延迟';
      default: return type;
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header & Filtering */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-[26px] md:text-[30px] leading-[38px] tracking-[-0.02em] font-semibold text-[#191c1e]">
            告警规则管理
          </h2>
          <p className="text-[14px] leading-[22px] text-[#434655] max-w-2xl font-normal">
            配置监控阈值与通知触发条件，保障系统稳定性并优化各模型 API 资源消耗。
          </p>
        </div>

        {/* Filter Tabs */}
        <div className="flex bg-[#f2f4f6] p-1 rounded-xl border border-[#c3c6d7] self-start overflow-x-auto max-w-full">
          {filterTabs.map((tab) => {
            const isActive = selectedTypeFilter === tab.id;
            const count = tab.id === '全部' ? rules.length : rules.filter((r) => r.type === tab.id).length;
            return (
              <button
                key={tab.id}
                onClick={() => setSelectedTypeFilter(tab.id)}
                className={`px-3.5 py-1.5 font-semibold text-[13px] leading-[18px] rounded-lg transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  isActive
                    ? 'bg-white text-[#004ac6] shadow-xs border border-[#c3c6d7]'
                    : 'text-[#434655] hover:text-[#191c1e]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[11px] px-1.5 py-0.2 rounded-full font-bold ${
                    isActive ? 'bg-[#d0e1fb] text-[#003ea8]' : 'bg-[#e0e3e5] text-[#434655]'
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Rules Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredRules.map((rule) => {
          const isMenuOpen = activeMenuId === rule.id;

          return (
            <div
              key={rule.id}
              className={`bg-white border border-[#c3c6d7] rounded-xl p-6 transition-all group relative flex flex-col shadow-2xs hover:shadow-md ${
                !rule.enabled ? 'grayscale-[0.3] opacity-85 bg-[#f7f9fb]' : 'hover:border-[#004ac6]'
              }`}
            >
              {/* Card Top Header */}
              <div className="flex justify-between items-start mb-4">
                <div className="space-y-1.5 pr-2">
                  <h3 className="text-[18px] md:text-[20px] leading-[26px] font-semibold text-[#191c1e] group-hover:text-[#004ac6] transition-colors line-clamp-1">
                    {rule.name}
                  </h3>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`text-[11px] tracking-wide font-bold px-2 py-0.5 rounded ${getTypeBadgeStyle(
                        rule.type
                      )}`}
                    >
                      {getTypeLabel(rule.type)}
                    </span>

                    {rule.enabled ? (
                      <span className="flex items-center gap-1 text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded text-[11px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 animate-pulse"></span>
                        已启用
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[#434655] bg-[#e0e3e5] px-2 py-0.5 rounded text-[11px] font-bold">
                        未启用
                      </span>
                    )}
                  </div>
                </div>

                {/* More Vert Options Menu */}
                <div className="relative shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setActiveMenuId(isMenuOpen ? null : rule.id);
                    }}
                    className="text-[#434655] hover:bg-[#e6e8ea] p-1.5 rounded-lg transition-colors"
                    title="更多操作"
                  >
                    <span className="material-symbols-outlined text-[20px]">more_vert</span>
                  </button>

                  {isMenuOpen && (
                    <div
                      className="absolute right-0 mt-1 w-44 bg-white border border-[#c3c6d7] rounded-xl shadow-lg p-1 z-30 animate-scale-in"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        onClick={() => {
                          onEditRule(rule);
                          setActiveMenuId(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-[#191c1e] hover:bg-[#f2f4f6] rounded-md flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">edit</span>
                        编辑规则
                      </button>
                      <button
                        onClick={() => {
                          onTestRule(rule);
                          setActiveMenuId(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-[#004ac6] hover:bg-[#d0e1fb] rounded-md flex items-center gap-2 font-medium"
                      >
                        <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                        测试触发
                      </button>
                      <button
                        onClick={() => {
                          onDuplicateRule(rule);
                          setActiveMenuId(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-[#191c1e] hover:bg-[#f2f4f6] rounded-md flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">content_copy</span>
                        复制规则
                      </button>
                      <button
                        onClick={() => {
                          onToggleRule(rule.id);
                          setActiveMenuId(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-[#434655] hover:bg-[#f2f4f6] rounded-md flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">
                          {rule.enabled ? 'power_settings_new' : 'check_circle'}
                        </span>
                        {rule.enabled ? '停用规则' : '启用规则'}
                      </button>
                      <div className="border-t border-[#e6e8ea] my-1" />
                      <button
                        onClick={() => {
                          onDeleteRule(rule.id);
                          setActiveMenuId(null);
                        }}
                        className="w-full text-left px-3 py-1.5 text-[13px] text-[#ba1a1a] hover:bg-[#ffdad6] rounded-md flex items-center gap-2"
                      >
                        <span className="material-symbols-outlined text-[16px]">delete</span>
                        删除规则
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Card Body Metrics */}
              <div className="flex-1 space-y-4 flex flex-col justify-between">
                <div className="grid grid-cols-2 gap-3 text-[13px]">
                  <div className="space-y-0.5">
                    <span className="text-[12px] font-medium text-[#434655] block">关联渠道</span>
                    <span className="text-[#191c1e] font-semibold truncate block">{rule.channel}</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[12px] font-medium text-[#434655] block">匹配模型</span>
                    <span className="text-[#191c1e] font-semibold truncate block">{rule.model}</span>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[12px] font-medium text-[#434655] block">告警阈值</span>
                    <span className="text-[#191c1e] font-semibold block">{rule.thresholdValue}</span>
                  </div>
                  <div className="space-y-0.5 text-right">
                    <span className="text-[12px] font-medium text-[#434655] block">上次触发</span>
                    <span className="text-[#434655] block">{rule.lastTriggered || '从未触发'}</span>
                  </div>
                </div>

                {/* Pattern or Description box */}
                {rule.pattern && (
                  <div className="bg-[#2d3133] rounded-lg p-3 font-mono text-[13px] text-[#bdffdb] overflow-x-auto flex items-center justify-between">
                    <div>
                      <span className="text-[#737686] opacity-60 mr-2 uppercase text-[10px] font-sans">
                        正则模式:
                      </span>
                      <span>{rule.pattern}</span>
                    </div>
                  </div>
                )}

                {rule.description && (
                  <p className="text-[13px] leading-[20px] text-[#434655] italic line-clamp-2">
                    {rule.description}
                  </p>
                )}

                {/* Webhook link footer */}
                <div className="flex items-center gap-2 text-[12px] font-medium text-[#434655] border-t border-[#c3c6d7] pt-3 mt-auto">
                  <span className="material-symbols-outlined text-[16px] shrink-0 text-[#004ac6]">
                    webhook
                  </span>
                  <span className="truncate flex-1 font-mono text-[11px] text-[#54647a]">
                    {rule.webhookUrl}
                  </span>
                </div>

                {/* Quick Action Footer Buttons */}
                <div className="pt-2 flex gap-2">
                  <button
                    onClick={() => onEditRule(rule)}
                    className="flex-1 bg-[#e0e3e5] text-[#191c1e] font-medium text-[13px] py-2 rounded-lg hover:bg-[#c3c6d7] transition-colors"
                  >
                    编辑规则
                  </button>
                  <button
                    onClick={() => onToggleRule(rule.id)}
                    className={`flex-1 font-medium text-[13px] py-2 rounded-lg transition-colors border ${
                      rule.enabled
                        ? 'border-[#c3c6d7] text-[#434655] hover:bg-[#ffdad6] hover:text-[#ba1a1a] hover:border-transparent'
                        : 'border-[#004ac6] text-[#004ac6] hover:bg-[#dbe1ff]'
                    }`}
                  >
                    {rule.enabled ? '停用' : '启用'}
                  </button>
                </div>
              </div>
            </div>
          );
        })}

        {/* Create New Rule Card (Dashed Button) */}
        <button
          onClick={onCreateRule}
          className="border-2 border-dashed border-[#c3c6d7] rounded-xl p-6 flex flex-col items-center justify-center gap-3 text-[#434655] hover:border-[#004ac6] hover:text-[#004ac6] transition-all group bg-white hover:bg-[#f2f4f6] min-h-[260px] shadow-2xs"
        >
          <div className="w-12 h-12 rounded-full bg-[#f2f4f6] flex items-center justify-center group-hover:bg-[#dbe1ff] transition-colors">
            <span className="material-symbols-outlined text-[32px] text-[#004ac6]">add</span>
          </div>
          <span className="text-[18px] font-semibold tracking-[-0.01em]">新建告警规则</span>
          <p className="text-[13px] text-[#737686] max-w-xs text-center leading-[20px]">
            设置自定义正则表达式匹配、错误率、Token 限制或 SLA 响应延迟阈值。
          </p>
        </button>
      </div>

      {filteredRules.length === 0 && (
        <div className="bg-white border border-[#c3c6d7] rounded-xl p-12 text-center space-y-4">
          <span className="material-symbols-outlined text-[48px] text-[#737686]">search_off</span>
          <h3 className="text-[18px] font-semibold text-[#191c1e]">未匹配到任何告警规则</h3>
          <p className="text-[14px] text-[#434655]">
            请尝试调整搜索关键词或类型筛选选项，或创建一条新的告警规则。
          </p>
          <button
            onClick={onCreateRule}
            className="px-4 py-2 bg-[#004ac6] text-white text-[13px] font-medium rounded-lg hover:opacity-90"
          >
            立即创建规则
          </button>
        </div>
      )}
    </div>
  );
};
