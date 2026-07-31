import React, { useState, useEffect } from 'react';
import { AlertRule, RuleType, NotificationChannel } from '../types';
import { listChannelsWithModels, ChannelWithModels } from '../api/rules';

interface CreateRuleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (rule: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> & { id?: string }) => void;
  initialRule?: AlertRule | null;
  channels: NotificationChannel[];
}

export const CreateRuleModal: React.FC<CreateRuleModalProps> = ({
  isOpen,
  onClose,
  onSave,
  initialRule,
  channels,
}) => {
  const [name, setName] = useState('');
  const [type, setType] = useState<RuleType>('Regex');
  const [channelId, setChannelId] = useState<number>(0);
  const [channelLabel, setChannelLabel] = useState('全部渠道');
  const [model, setModel] = useState('全部模型');
  const [pattern, setPattern] = useState('(timeout|rate.?limit|error)');
  const [matchField, setMatchField] = useState('content');
  const [windowSeconds, setWindowSeconds] = useState(300);
  const [thresholdNumber, setThresholdNumber] = useState(10);
  const [cooldownSeconds, setCooldownSeconds] = useState(600);
  const [webhookUrl, setWebhookUrl] = useState('https://feishu.cn/webhook/v2/4a89bc21-09df-41ef-bc82-9011abf88123');
  const [description, setDescription] = useState('');
  const [showPayloadPreview, setShowPayloadPreview] = useState(false);
  const [negate, setNegate] = useState(false);
  const [excludeEmpty, setExcludeEmpty] = useState(false);

  // 从 API 加载渠道和模型列表
  const [backendChannels, setBackendChannels] = useState<ChannelWithModels[]>([]);
  const [channelModels, setChannelModels] = useState<string[]>([]);
  const [loadingChannels, setLoadingChannels] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingChannels(true);
    listChannelsWithModels()
      .then((data) => {
        setBackendChannels(data);
      })
      .catch(() => {
        // 接口不可用时静默降级
      })
      .finally(() => setLoadingChannels(false));
  }, [isOpen]);

  // 渠道变化时更新模型列表
  useEffect(() => {
    if (channelId === 0) {
      setChannelModels([]);
      return;
    }
    const ch = backendChannels.find((c) => c.channel_id === channelId);
    setChannelModels(ch?.models || []);
  }, [channelId, backendChannels]);

  useEffect(() => {
    if (initialRule) {
      setName(initialRule.name);
      setType(initialRule.type);
      setChannelId(initialRule._channelId || 0);
      setChannelLabel(initialRule.channel);
      setModel(initialRule.model);
      setPattern(initialRule.pattern || '');
      setMatchField(initialRule._matchField || 'content');
      setWindowSeconds(initialRule.windowSeconds);
      setThresholdNumber(initialRule.thresholdNumber || 10);
      setCooldownSeconds(initialRule.cooldownSeconds);
      setWebhookUrl(initialRule.webhookUrl);
      setDescription(initialRule.description || '');
      setNegate(initialRule._negate || false);
      setExcludeEmpty(initialRule._excludeEmpty || false);
    } else {
      setName('');
      setType('Regex');
      setChannelId(0);
      setChannelLabel('全部渠道');
      setModel('全部模型');
      setPattern('(timeout|rate.?limit|error)');
      setMatchField('content');
      setWindowSeconds(300);
      setThresholdNumber(10);
      setCooldownSeconds(600);
      setWebhookUrl(channels[0]?.url || 'https://feishu.cn/webhook/v2/4a89bc21-09df-41ef-bc82-9011abf88123');
      setDescription('');
      setNegate(false);
      setExcludeEmpty(false);
    }
  }, [initialRule, isOpen, channels]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    let thresholdValue = `> ${thresholdNumber}`;
    if (type === 'Regex') thresholdValue = `> ${thresholdNumber} 次匹配`;
    if (type === 'Token') thresholdValue = `${thresholdNumber >= 1000 ? `${thresholdNumber / 1000}k` : thresholdNumber} / 分钟`;
    if (type === 'Error Rate') thresholdValue = `> ${thresholdNumber}% 错误率`;
    if (type === 'Latency') thresholdValue = `> ${thresholdNumber} ms`;

    onSave({
      id: initialRule?.id,
      name,
      type,
      enabled: initialRule ? initialRule.enabled : true,
      channel: channelLabel,
      channelId,
      model,
      matchField,
      windowSeconds,
      thresholdValue,
      thresholdNumber,
      pattern: type === 'Regex' ? pattern : undefined,
      webhookUrl,
      description,
      cooldownSeconds,
      lastTriggered: initialRule?.lastTriggered || '从未触发',
      _negate: negate,
      _excludeEmpty: excludeEmpty,
    } as any);

    onClose();
  };

  const samplePayload = {
    msg_type: "text",
    content: {
      text: `🚨 [AI Gateway 告警] ${name || '告警规则被触发'}\n- 规则类型: ${type}\n- 渠道: ${channelLabel}\n- 模型: ${model}\n- 时间窗口: ${windowSeconds}s\n- 触发阈值: ${thresholdNumber}\n- 触发时间: ${new Date().toISOString()}`
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden flex flex-col my-8 animate-scale-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6]">
              {initialRule ? 'edit_note' : 'add_alert'}
            </span>
            <h2 className="text-[18px] md:text-[20px] font-semibold text-[#191c1e]">
              {initialRule ? '编辑告警规则' : '创建新告警规则'}
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-[#434655] hover:text-[#191c1e] p-1 rounded-lg hover:bg-[#e0e3e5] transition-colors"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Modal Form */}
        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto max-h-[75vh] space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className="text-[13px] font-semibold text-[#191c1e]">规则名称 *</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：超时持续监控规则"
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px] focus:ring-2 focus:ring-[#004ac6] focus:border-transparent outline-none transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[13px] font-semibold text-[#191c1e]">规则类型</label>
              <select
                value={type}
                onChange={(e) => setType(e.target.value as RuleType)}
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px] focus:ring-2 focus:ring-[#004ac6] outline-none transition-all"
              >
                <option value="Regex">正则模式匹配 (Regex)</option>
                <option value="Error Rate">错误率 (%)</option>
                <option value="Token">Token 消费限制</option>
                <option value="Latency">响应延迟 (ms)</option>
              </select>
            </div>
          </div>

          {/* Conditions Panel */}
          <div className="bg-[#f2f4f6] p-4 rounded-xl space-y-4 border border-[#c3c6d7]">
            <h4 className="text-[12px] font-bold text-[#004ac6] tracking-wider">
              触发条件与目标筛选
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {type === 'Regex' && (<>
                <div className="col-span-1 md:col-span-2 space-y-1">
                  <label className="text-[13px] font-semibold text-[#191c1e]">正则表达式模式</label>
                  <input
                    type="text"
                    value={pattern}
                    onChange={(e) => setPattern(e.target.value)}
                    placeholder="(timeout|rate.?limit|error)"
                    className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 font-mono text-[13px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[13px] font-semibold text-[#191c1e]">匹配字段</label>
                  <select
                    value={matchField}
                    onChange={(e) => setMatchField(e.target.value)}
                    className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px]"
                  >
                    <option value="content">Content (日志内容)</option>
                    <option value="other">Other (扩展字段)</option>
                    <option value="response_id">Response ID</option>
                    <option value="request_id">Request ID</option>
                    <option value="upstream_request_id">Upstream Request ID</option>
                  </select>
                </div>
                <div className="col-span-1 md:col-span-2 flex items-center gap-6 pt-1">
                  <label className="flex items-center gap-2 text-[13px] text-[#434655] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={negate}
                      onChange={(e) => setNegate(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#004ac6]"
                    />
                    反向匹配 (NOT REGEXP/!~*)
                  </label>
                  <label className="flex items-center gap-2 text-[13px] text-[#434655] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={excludeEmpty}
                      onChange={(e) => setExcludeEmpty(e.target.checked)}
                      className="w-4 h-4 rounded accent-[#004ac6]"
                    />
                    排除空字符串
                  </label>
                </div>
              </>)}

              <div className="space-y-1">
                <label className="text-[13px] font-semibold text-[#191c1e]">针对渠道</label>
                <select
                  value={channelId}
                  onChange={(e) => {
                    const cid = Number(e.target.value);
                    setChannelId(cid);
                    if (cid === 0) {
                      setChannelLabel('全部渠道');
                    } else {
                      const ch = backendChannels.find((c) => c.channel_id === cid);
                      setChannelLabel(ch?.name || `渠道 #${cid}`);
                    }
                  }}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px]"
                  disabled={loadingChannels}
                >
                  <option value={0}>全部渠道</option>
                  {backendChannels.map((ch) => (
                    <option key={ch.channel_id} value={ch.channel_id}>
                      {ch.name || `渠道 #${ch.channel_id}`}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-[13px] font-semibold text-[#191c1e]">针对模型</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px]"
                >
                  <option value="全部模型">全部模型</option>
                  {channelModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Windows & Threshold Parameters */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="space-y-1">
              <label className="text-[13px] font-semibold text-[#191c1e]">时间窗口 (秒)</label>
              <input
                type="number"
                min="10"
                max="86400"
                value={windowSeconds}
                onChange={(e) => setWindowSeconds(Number(e.target.value))}
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[13px] font-semibold text-[#191c1e]">
                {type === 'Regex' && '匹配次数阈值'}
                {type === 'Token' && 'Token / 分钟阈值'}
                {type === 'Error Rate' && '错误率 % 阈值'}
                {type === 'Latency' && '最大延迟 (ms)'}
              </label>
              <input
                type="number"
                min="1"
                value={thresholdNumber}
                onChange={(e) => setThresholdNumber(Number(e.target.value))}
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[13px] font-semibold text-[#191c1e]">告警冷却时间 (秒)</label>
              <input
                type="number"
                min="0"
                value={cooldownSeconds}
                onChange={(e) => setCooldownSeconds(Number(e.target.value))}
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px]"
              />
            </div>
          </div>

          {/* Webhook Endpoint */}
          <div className="space-y-1.5">
            <div className="flex justify-between items-center">
              <label className="text-[13px] font-semibold text-[#191c1e]">Webhook 回调地址</label>
              <div className="flex gap-1.5 text-[11px]">
                {channels.map((chan) => (
                  <button
                    key={chan.id}
                    type="button"
                    onClick={() => setWebhookUrl(chan.url)}
                    className="px-2 py-0.5 bg-[#e0e3e5] hover:bg-[#d0e1fb] text-[#434655] rounded font-medium transition-colors"
                  >
                    使用 {chan.name.slice(0, 4)}
                  </button>
                ))}
              </div>
            </div>
            <input
              type="url"
              required
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder="https://feishu.cn/webhook/v2/..."
              className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 font-mono text-[13px]"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-[13px] font-semibold text-[#191c1e]">规则说明</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="描述此规则的监控目的与注意事项..."
              className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[13px]"
            />
          </div>

          {/* Payload Toggle Preview */}
          <div>
            <button
              type="button"
              onClick={() => setShowPayloadPreview(!showPayloadPreview)}
              className="text-[12px] font-medium text-[#004ac6] hover:underline flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-[16px]">code</span>
              {showPayloadPreview ? '隐藏 Payload 报文预览' : '查看告警 Webhook Payload JSON 报文示例'}
            </button>
            {showPayloadPreview && (
              <pre className="mt-2 bg-[#2d3133] text-[#bdffdb] p-3 rounded-lg font-mono text-[12px] overflow-x-auto">
                {JSON.stringify(samplePayload, null, 2)}
              </pre>
            )}
          </div>

          {/* Footer Buttons */}
          <div className="pt-4 border-t border-[#e6e8ea] flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-[#434655] font-medium text-[13px] hover:bg-[#e0e3e5] rounded-lg transition-colors"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-6 py-2 bg-[#004ac6] text-white font-medium text-[13px] rounded-lg shadow-xs hover:opacity-90 active:scale-95 transition-all"
            >
              {initialRule ? '保存规则修改' : '确认创建规则'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
