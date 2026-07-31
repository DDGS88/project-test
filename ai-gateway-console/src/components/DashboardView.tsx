import React from 'react';
import { AlertRule, MainTab, HeaderSubTab } from '../types';

interface DashboardViewProps {
  rules: AlertRule[];
  onNavigate: (mainTab: MainTab, subTab?: HeaderSubTab) => void;
  onCreateRule: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  rules,
  onNavigate,
  onCreateRule,
}) => {
  const activeRulesCount = rules.filter((r) => r.enabled).length;
  const totalRules = rules.length;

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-[#004ac6] to-[#003ea8] text-white rounded-2xl p-6 shadow-md flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[24px]">verified_user</span>
            <h2 className="text-[20px] md:text-[22px] font-bold">AI Gateway 告警管理控制台</h2>
          </div>
          <p className="text-[13px] opacity-95 max-w-xl leading-[20px]">
            当前 {activeRulesCount} 条规则已激活，持续监控日志数据并实时评估告警条件。
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => onNavigate('alert-rules', '规则')}
            className="bg-white text-[#004ac6] font-semibold text-[13px] px-4 py-2 rounded-lg hover:bg-[#eeefff] transition-colors"
          >
            规则管理
          </button>
          <button
            onClick={onCreateRule}
            className="bg-[#2563eb] border border-white/30 text-white font-semibold text-[13px] px-4 py-2 rounded-lg hover:bg-white/10 transition-colors"
          >
            + 新建告警
          </button>
        </div>
      </div>

      {/* Quick Summary Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div
          onClick={() => onNavigate('alert-rules', '规则')}
          className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs hover:border-[#004ac6] cursor-pointer transition-all"
        >
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">告警规则</span>
            <span className="material-symbols-outlined text-[20px] text-[#004ac6]">
              notification_important
            </span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {activeRulesCount} <span className="text-[13px] text-[#737686] font-normal">已激活 / 共 {totalRules} 条</span>
          </p>
          <p className="text-[11px] text-[#434655] mt-1 font-medium">实时轮询评估告警条件</p>
        </div>

        <div
          onClick={() => onNavigate('alert-rules', '日志')}
          className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs hover:border-[#004ac6] cursor-pointer transition-all"
        >
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">已禁用规则</span>
            <span className="material-symbols-outlined text-[20px] text-[#434655]">toggle_off</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {totalRules - activeRulesCount}
          </p>
          <p className="text-[11px] text-[#737686] mt-1 font-medium">未启用的告警规则数量</p>
        </div>

        <div
          onClick={() => onNavigate('alert-rules')}
          className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs hover:border-[#004ac6] cursor-pointer transition-all"
        >
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">规则类型分布</span>
            <span className="material-symbols-outlined text-[20px] text-[#004ac6]">category</span>
          </div>
          <div className="mt-2 space-y-1">
            {(['Regex', 'Error Rate', 'Token', 'Latency'] as const).map((type) => {
              const count = rules.filter((r) => r.type === type).length;
              if (count === 0) return null;
              return (
                <div key={type} className="flex justify-between text-[13px]">
                  <span className="text-[#434655]">{type}</span>
                  <span className="font-semibold text-[#191c1e]">{count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Rules Preview */}
      {rules.length > 0 && (
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <h3 className="text-[18px] font-bold text-[#191c1e]">告警规则预览</h3>
            <button
              onClick={() => onNavigate('alert-rules', '规则')}
              className="text-[13px] font-medium text-[#004ac6] hover:underline flex items-center gap-1"
            >
              查看全部 ({totalRules})
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {rules.slice(0, 4).map((rule) => (
              <div key={rule.id} className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="font-semibold text-[#191c1e] text-[16px]">{rule.name}</h4>
                  <span className="text-[11px] font-bold px-2 py-0.5 rounded bg-[#d0e1fb] text-[#003ea8]">
                    {rule.type}
                  </span>
                </div>
                {rule.description && (
                  <p className="text-[13px] text-[#434655] leading-[20px]">{rule.description}</p>
                )}
                <div className="flex items-center gap-4 text-[12px] text-[#434655]">
                  <span>渠道: {rule.channel}</span>
                  <span>阈值: {rule.thresholdValue}</span>
                  {rule.enabled ? (
                    <span className="text-[11px] text-[#006242] font-medium">● 已激活</span>
                  ) : (
                    <span className="text-[11px] text-[#737686] font-medium">○ 未启用</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {totalRules === 0 && (
        <div className="bg-white border border-dashed border-[#c3c6d7] rounded-xl p-12 text-center space-y-4">
          <span className="material-symbols-outlined text-[48px] text-[#737686]">add_alert</span>
          <h3 className="text-[18px] font-semibold text-[#191c1e]">暂无告警规则</h3>
          <p className="text-[14px] text-[#434655]">
            创建您的第一条告警规则，开始监控 AI 网关日志。
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
