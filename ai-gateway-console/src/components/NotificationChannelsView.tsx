import React from 'react';
import { AlertRule } from '../types';

interface NotificationChannelsViewProps {
  rules: AlertRule[];
}

export const NotificationChannelsView: React.FC<NotificationChannelsViewProps> = ({ rules }) => {
  // 从告警规则中提取唯一的 webhook URL
  const urlMap = new Map<string, { url: string; rules: AlertRule[] }>();
  rules.forEach((r) => {
    const key = r.webhookUrl;
    const entry = urlMap.get(key);
    if (entry) {
      entry.rules.push(r);
    } else {
      urlMap.set(key, { url: key, rules: [r] });
    }
  });

  const channels = Array.from(urlMap.values());

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[26px] md:text-[30px] font-semibold text-[#191c1e] tracking-[-0.02em]">
          告警通知渠道
        </h2>
        <p className="text-[14px] text-[#434655] leading-[22px]">
          Webhook 地址由每条告警规则独立配置，以下展示当前所有已使用的通知渠道。
        </p>
      </div>

      {channels.length === 0 && (
        <div className="bg-white border border-dashed border-[#c3c6d7] rounded-xl p-12 text-center space-y-4">
          <span className="material-symbols-outlined text-[48px] text-[#737686]">webhook</span>
          <h3 className="text-[18px] font-semibold text-[#191c1e]">暂无通知渠道</h3>
          <p className="text-[14px] text-[#434655] max-w-md mx-auto">
            创建告警规则时配置 Webhook 地址，此处将自动汇总展示。
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {channels.map((chan) => (
          <div
            key={chan.url}
            className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs hover:border-[#004ac6] transition-all"
          >
            <div className="flex items-start gap-3 mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#d0e1fb] flex items-center justify-center text-[#004ac6] shrink-0">
                <span className="material-symbols-outlined text-[24px]">webhook</span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="inline-block text-[11px] font-bold px-2 py-0.5 rounded bg-[#d0e1fb] text-[#003ea8] mb-1">
                  关联 {chan.rules.length} 条规则
                </span>
                <div className="bg-[#f2f4f6] p-2.5 rounded-lg font-mono text-[12px] text-[#434655] truncate mt-2">
                  {chan.url}
                </div>
              </div>
            </div>

            <div className="border-t border-[#e0e3e5] pt-3 space-y-1">
              {chan.rules.map((r) => (
                <div key={r.id} className="flex items-center justify-between text-[12px]">
                  <span className="text-[#191c1e] font-medium truncate mr-2">{r.name}</span>
                  <span className="text-[#737686] shrink-0">
                    {r.type} · {r.enabled ? '启用' : '禁用'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
