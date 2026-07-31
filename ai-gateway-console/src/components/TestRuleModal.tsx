import React, { useState } from 'react';
import { AlertRule } from '../types';

interface TestRuleModalProps {
  rule: AlertRule | null;
  onClose: () => void;
  onTriggerSimulatedLog: (rule: AlertRule, content: string) => void;
}

export const TestRuleModal: React.FC<TestRuleModalProps> = ({
  rule,
  onClose,
  onTriggerSimulatedLog,
}) => {
  const [testPayloadText, setTestPayloadText] = useState(
    'Error: ConnectTimeoutError: Connection timed out to api.openai.com after 30000ms'
  );
  const [testResult, setTestResult] = useState<{
    matched: boolean;
    reason: string;
  } | null>(null);

  if (!rule) return null;

  const handleRunTest = () => {
    let matched = false;
    let reason = '';

    if (rule.type === 'Regex') {
      try {
        const regexStr = rule.pattern ? rule.pattern.replace(/^\/|\/[a-z]*$/gi, '') : 'timeout';
        const flags = rule.pattern && rule.pattern.endsWith('i') ? 'i' : '';
        const regex = new RegExp(regexStr, flags);
        matched = regex.test(testPayloadText);
        reason = matched
          ? `Pattern "${rule.pattern}" matched test payload successfully!`
          : `Pattern "${rule.pattern}" did NOT match the test log content.`;
      } catch {
        matched = testPayloadText.toLowerCase().includes('timeout') || testPayloadText.toLowerCase().includes('error');
        reason = matched ? 'Matched fallback keyword match' : 'No pattern match';
      }
    } else {
      matched = true;
      reason = `Simulated ${rule.type} metric evaluated against threshold (${rule.thresholdValue})`;
    }

    setTestResult({ matched, reason });

    if (matched) {
      onTriggerSimulatedLog(rule, testPayloadText);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4">
      <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden flex flex-col animate-scale-in">
        <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6]">play_circle</span>
            <h3 className="text-[17px] md:text-[18px] font-semibold text-[#191c1e]">
              测试触发规则: {rule.name}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="text-[#434655] hover:text-[#191c1e] p-1 rounded-lg hover:bg-[#e0e3e5]"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-[13px] bg-[#f2f4f6] p-3 rounded-lg space-y-1">
            <p>
              <strong className="text-[#191c1e]">目标渠道:</strong> {rule.channel} |{' '}
              <strong className="text-[#191c1e]">匹配模型:</strong> {rule.model}
            </p>
            <p>
              <strong className="text-[#191c1e]">告警阈值:</strong> {rule.thresholdValue}
            </p>
            {rule.pattern && (
              <p className="font-mono text-[12px] text-[#004ac6]">
                <strong>正则模式:</strong> {rule.pattern}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label className="text-[13px] font-semibold text-[#191c1e]">
              模拟测试日志内容 / 报文
            </label>
            <textarea
              rows={3}
              value={testPayloadText}
              onChange={(e) => setTestPayloadText(e.target.value)}
              className="w-full bg-white border border-[#c3c6d7] rounded-lg p-3 font-mono text-[13px] focus:ring-2 focus:ring-[#004ac6] outline-none"
            />
          </div>

          {testResult && (
            <div
              className={`p-3 rounded-lg text-[13px] font-medium flex items-start gap-2 ${
                testResult.matched
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border border-amber-200'
              }`}
            >
              <span className="material-symbols-outlined text-[18px]">
                {testResult.matched ? 'check_circle' : 'warning'}
              </span>
              <div>
                <p className="font-bold">
                  {testResult.matched ? '匹配成功并已模拟发送 Webhook 告警' : '未匹配到任何告警条件'}
                </p>
                <p className="text-[12px] mt-0.5 opacity-90">{testResult.reason}</p>
              </div>
            </div>
          )}

          <div className="pt-2 flex justify-end gap-2 border-t border-[#e6e8ea]">
            <button
              onClick={onClose}
              className="px-4 py-2 text-[#434655] text-[13px] font-medium hover:bg-[#e0e3e5] rounded-lg"
            >
              关闭
            </button>
            <button
              onClick={handleRunTest}
              className="px-5 py-2 bg-[#004ac6] text-white text-[13px] font-medium rounded-lg hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5"
            >
              <span className="material-symbols-outlined text-[18px]">bolt</span>
              执行测试评估
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
