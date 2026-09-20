import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  ProbeAvailabilityConfig,
  ProbeQualityConfig,
  ProbeRuntimeStatus,
  ProbeConfigResponse,
  ProbeRun,
  ProbeResult,
} from '../types';
import {
  getProbeConfig,
  updateProbeAvailabilityConfig,
  updateProbeQualityConfig,
  validateProbeCron,
  triggerProbeAvailability,
  triggerProbeQuality,
  listProbeRuns,
  listProbeResults,
  testProbeWebhook,
  listChannels,
} from '../api/rules';
import type { ChannelOption } from '../api/rules';

type ProbeKind = 'availability' | 'quality';

// ── 默认配置（后端返回缺省字段时兜底） ──

const DEFAULT_AVAILABILITY: ProbeAvailabilityConfig = {
  enabled: false,
  cron: '0 */6 * * *',
  channel_ids: [],
  max_models_per_channel: 0,
  concurrency: 4,
  timeout_sec: 30,
  max_tokens: 1,
  prompt: 'ping',
  cooldown_sec: 600,
  feishu_webhook: '',
  at_users: '',
};

const DEFAULT_QUALITY: ProbeQualityConfig = {
  enabled: false,
  cron: '0 8 * * *',
  mode: 'standard',
  score_threshold: 60,
  timeout_sec: 120,
  cooldown_sec: 3600,
  feishu_webhook: '',
  at_users: '',
};

// 表单控件统一样式，复用现有设计语言
const INPUT_CLASS =
  'w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 text-[13px] text-[#191c1e] outline-none focus:ring-2 focus:ring-[#004ac6]/30 focus:border-[#004ac6] transition-colors';
const LABEL_CLASS = 'block text-[12px] font-semibold text-[#434655] mb-1';

// RFC3339 → 本地可读时间；空字符串统一显示为占位符
function formatTime(value: string): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// 运行状态徽标样式
function runStatusMeta(status: string): { label: string; className: string } {
  switch (status) {
    case 'done':
      return { label: '已完成', className: 'text-[#006242] bg-[#e6f4ea] border-[#a5d6a7]' };
    case 'running':
      return { label: '运行中', className: 'text-[#004ac6] bg-[#d0e1fb] border-[#b4c5ff]' };
    case 'failed':
      return { label: '失败', className: 'text-[#c62828] bg-[#ffe0e0] border-[#ef9a9a]' };
    case '':
      return { label: '—', className: 'text-[#737686] bg-[#e0e3e5] border-[#c3c6d7]' };
    default:
      return { label: status, className: 'text-[#737686] bg-[#e0e3e5] border-[#c3c6d7]' };
  }
}

// 明细条目状态徽标样式
function resultStatusMeta(status: string): { label: string; className: string } {
  switch (status) {
    case 'ok':
      return { label: '成功', className: 'text-[#006242] bg-[#e6f4ea]' };
    case 'fail':
      return { label: '失败', className: 'text-[#c62828] bg-[#ffe0e0]' };
    case 'skip':
      return { label: '跳过', className: 'text-[#e65100] bg-[#fff3e0]' };
    default:
      return { label: status || '—', className: 'text-[#737686] bg-[#e0e3e5]' };
  }
}

// 表单字段包裹
const Field: React.FC<{
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}> = ({ label, hint, className, children }) => (
  <div className={className}>
    <label className={LABEL_CLASS}>{label}</label>
    {children}
    {hint && <p className="text-[11px] text-[#737686] mt-1 leading-[16px]">{hint}</p>}
  </div>
);

// 开关组件
const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void }> = ({
  checked,
  onChange,
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
      checked ? 'bg-[#004ac6]' : 'bg-[#c3c6d7]'
    }`}
  >
    <span
      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
        checked ? 'translate-x-6' : 'translate-x-1'
      }`}
    />
  </button>
);

export const ChannelProbeView: React.FC = () => {
  const [activeKind, setActiveKind] = useState<ProbeKind>('availability');

  // 配置与运行时状态
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState('');
  const [availConfig, setAvailConfig] = useState<ProbeAvailabilityConfig>(DEFAULT_AVAILABILITY);
  const [qualityConfig, setQualityConfig] = useState<ProbeQualityConfig>(DEFAULT_QUALITY);
  const [runtime, setRuntime] = useState<ProbeConfigResponse['runtime'] | null>(null);

  // 渠道列表（白名单多选）
  const [channels, setChannels] = useState<ChannelOption[]>([]);

  // 页内提示条（不依赖 App.tsx 的 showToast）
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null
  );
  const feedbackTimer = useRef<number | null>(null);

  // cron 校验状态（两类探测各自独立）
  const [availCron, setAvailCron] = useState<{ checking: boolean; valid: boolean | null; message: string }>(
    { checking: false, valid: null, message: '' }
  );
  const [qualityCron, setQualityCron] = useState<{ checking: boolean; valid: boolean | null; message: string }>(
    { checking: false, valid: null, message: '' }
  );

  // 运行历史 / 明细
  const [runs, setRuns] = useState<ProbeRun[]>([]);
  const [runsLoading, setRunsLoading] = useState(false);
  const [runsError, setRunsError] = useState('');
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [results, setResults] = useState<ProbeResult[]>([]);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [resultsError, setResultsError] = useState('');
  const [onlyFailed, setOnlyFailed] = useState(false);

  // 忙碌标志
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState<ProbeKind | null>(null);
  const [testingWebhook, setTestingWebhook] = useState(false);

  // 页内提示：4 秒后自动消失
  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setFeedback({ type, message });
    if (feedbackTimer.current != null) window.clearTimeout(feedbackTimer.current);
    feedbackTimer.current = window.setTimeout(() => setFeedback(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (feedbackTimer.current != null) window.clearTimeout(feedbackTimer.current);
    },
    []
  );

  // ── 数据加载 ──

  const loadConfig = useCallback(async () => {
    try {
      setConfigError('');
      const data = await getProbeConfig();
      setAvailConfig({ ...DEFAULT_AVAILABILITY, ...data.availability });
      setQualityConfig({ ...DEFAULT_QUALITY, ...data.quality });
      setRuntime(data.runtime);
    } catch (err) {
      setConfigError(err instanceof Error ? err.message : '加载探测配置失败');
    } finally {
      setConfigLoading(false);
    }
  }, []);

  const loadRuns = useCallback(async (kind: ProbeKind) => {
    setRunsLoading(true);
    setRunsError('');
    try {
      setRuns(await listProbeRuns(kind, 20));
    } catch (err) {
      setRunsError(err instanceof Error ? err.message : '加载运行历史失败');
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, []);

  // 首次进入加载配置
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  // 渠道列表仅需加载一次，失败静默降级（白名单功能不可用时不影响其它配置）
  useEffect(() => {
    listChannels()
      .then(setChannels)
      .catch(() => setChannels([]));
  }, []);

  // 切换页签时重载该类型的运行历史并清空明细
  useEffect(() => {
    setSelectedRunId(null);
    setResults([]);
    loadRuns(activeKind);
  }, [activeKind, loadRuns]);

  // 选中某次运行后加载明细；「仅看失败」变化时重新拉取
  useEffect(() => {
    if (selectedRunId == null) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setResultsLoading(true);
    setResultsError('');
    listProbeResults({ runId: selectedRunId, onlyFailed, limit: 500 })
      .then((data) => {
        if (!cancelled) setResults(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setResultsError(err instanceof Error ? err.message : '加载探测明细失败');
          setResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) setResultsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRunId, onlyFailed]);

  // ── 交互动作 ──

  const handleRefresh = async () => {
    await Promise.all([loadConfig(), loadRuns(activeKind)]);
  };

  const handleSave = async () => {
    const kind = activeKind;
    const cron = kind === 'availability' ? availConfig.cron : qualityConfig.cron;
    setSaving(true);
    try {
      // cron 由用户手填，保存前先校验：非法表达式直接在页面拦截，不提交到后端
      const cronCheck = await validateCronValue(kind, cron);
      if (!cronCheck.valid) {
        notify('error', `cron 表达式非法，配置未保存：${cronCheck.error}`);
        return;
      }

      if (kind === 'availability') {
        const saved = await updateProbeAvailabilityConfig(availConfig);
        setAvailConfig({ ...DEFAULT_AVAILABILITY, ...saved });
        notify('success', '可用性探测配置已保存');
      } else {
        const saved = await updateProbeQualityConfig(qualityConfig);
        setQualityConfig({ ...DEFAULT_QUALITY, ...saved });
        notify('success', '质量探测配置已保存');
      }
      await loadConfig();
    } catch (err) {
      notify('error', `保存失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleTrigger = async (kind: ProbeKind) => {
    setTriggering(kind);
    try {
      if (kind === 'availability') await triggerProbeAvailability();
      else await triggerProbeQuality();
      notify('success', '已触发探测任务，稍后可在运行历史中查看结果');
      await loadConfig();
      if (kind === activeKind) await loadRuns(kind);
    } catch (err) {
      notify('error', `触发失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setTriggering(null);
    }
  };

  const handleValidateCron = async (kind: ProbeKind) => {
    const cron = kind === 'availability' ? availConfig.cron : qualityConfig.cron;
    await validateCronValue(kind, cron);
  };

  // 校验 cron 并写入对应页签的校验状态，返回是否合法（保存前复用同一套校验）
  const validateCronValue = async (
    kind: ProbeKind,
    cron: string
  ): Promise<{ valid: boolean; error: string }> => {
    const setState = kind === 'availability' ? setAvailCron : setQualityCron;
    if (!cron.trim()) {
      setState({ checking: false, valid: false, message: 'cron 表达式不能为空' });
      return { valid: false, error: 'cron 表达式不能为空' };
    }
    setState({ checking: true, valid: null, message: '校验中...' });
    try {
      const res = await validateProbeCron(cron);
      if (res.valid) {
        setState({
          checking: false,
          valid: true,
          message: `表达式合法，下次运行：${formatTime(res.next_run)}`,
        });
        return { valid: true, error: '' };
      }
      const error = res.error || '无效的 cron 表达式';
      setState({ checking: false, valid: false, message: error });
      return { valid: false, error };
    } catch (err) {
      const error = `校验失败: ${err instanceof Error ? err.message : '未知错误'}`;
      setState({ checking: false, valid: false, message: error });
      return { valid: false, error };
    }
  };

  const handleTestWebhook = async () => {
    const url = activeKind === 'availability' ? availConfig.feishu_webhook : qualityConfig.feishu_webhook;
    if (!url.trim()) {
      notify('error', '请先填写飞书 Webhook 地址');
      return;
    }
    setTestingWebhook(true);
    try {
      const res = await testProbeWebhook(url);
      if (res.success) notify('success', '飞书 Webhook 发送成功');
      else notify('error', `Webhook 测试失败: ${res.error || '未知错误'}`);
    } catch (err) {
      notify('error', `Webhook 测试失败: ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setTestingWebhook(false);
    }
  };

  // 白名单渠道勾选 / 取消
  const toggleChannel = (id: number) => {
    setAvailConfig((prev) => {
      const exists = prev.channel_ids.includes(id);
      return {
        ...prev,
        channel_ids: exists ? prev.channel_ids.filter((c) => c !== id) : [...prev.channel_ids, id],
      };
    });
  };

  const selectedChannelCount = availConfig.channel_ids.length;

  // ── 顶部状态卡 ──

  const renderStatusCard = (kind: ProbeKind) => {
    const rt: ProbeRuntimeStatus | undefined = runtime ? runtime[kind] : undefined;
    const enabled = kind === 'availability' ? availConfig.enabled : qualityConfig.enabled;
    const title = kind === 'availability' ? '可用性探测' : '质量探测';
    const icon = kind === 'availability' ? 'health_and_safety' : 'workspace_premium';
    const meta = runStatusMeta(rt?.last_status || '');
    const isBusy = triggering === kind;

    const statusField = (label: string, value: React.ReactNode) => (
      <div className="space-y-0.5">
        <div className="text-[11px] text-[#737686]">{label}</div>
        <div className="text-[13px] font-semibold text-[#191c1e]">{value}</div>
      </div>
    );

    return (
      <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[20px] text-[#004ac6]">{icon}</span>
            <h3 className="text-[15px] font-bold text-[#191c1e] truncate">{title}</h3>
            <span
              className={`text-[11px] px-1.5 py-0.5 rounded border font-medium ${
                enabled
                  ? 'text-[#006242] bg-[#e6f4ea] border-[#a5d6a7]'
                  : 'text-[#737686] bg-[#e0e3e5] border-[#c3c6d7]'
              }`}
            >
              {enabled ? '已启用' : '已停用'}
            </span>
            {rt?.running && (
              <span className="text-[11px] px-1.5 py-0.5 rounded border font-medium text-[#004ac6] bg-[#d0e1fb] border-[#b4c5ff] flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-[#004ac6] animate-pulse" />
                运行中
              </span>
            )}
          </div>
          <button
            onClick={() => handleTrigger(kind)}
            disabled={isBusy}
            className="px-3 py-1.5 bg-[#004ac6] text-white font-semibold text-[12px] rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center gap-1 shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">play_arrow</span>
            {isBusy ? '触发中...' : '立即执行'}
          </button>
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3">
          {statusField('上次运行时间', formatTime(rt?.last_run_at || ''))}
          {statusField(
            '本次状态',
            <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded border ${meta.className}`}>
              {meta.label}
            </span>
          )}
          {statusField('下次预计运行时间', formatTime(rt?.next_run_at || ''))}
          {statusField('是否运行中', rt?.running ? '是' : '否')}
          {statusField(
            `上次运行结果${rt?.last_run_id ? ` #${rt.last_run_id}` : ''}`,
            rt?.last_run_id ? (
              <span className="font-normal text-[12px] text-[#434655]">
                总 {rt.total} · 成功 <span className="text-[#006242] font-semibold">{rt.ok_count}</span> · 失败{' '}
                <span className="text-[#c62828] font-semibold">{rt.fail_count}</span> · 跳过 {rt.skip_count}
              </span>
            ) : (
              '—'
            )
          )}
        </div>
      </div>
    );
  };

  // ── 运行历史列表 ──

  const renderRunList = () => (
    <div className="bg-white border border-[#c3c6d7] rounded-xl shadow-2xs p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[14px] font-bold text-[#191c1e] flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[18px] text-[#004ac6]">history</span>
          运行历史
        </h3>
        <button
          onClick={() => loadRuns(activeKind)}
          className="text-[12px] font-semibold text-[#004ac6] hover:underline flex items-center gap-0.5"
        >
          <span className="material-symbols-outlined text-[15px]">refresh</span>
          刷新
        </button>
      </div>

      {runsLoading && <div className="text-[13px] text-[#434655] py-6 text-center">加载中...</div>}
      {!runsLoading && runsError && (
        <div className="text-[12px] text-[#c62828] bg-[#ffe0e0] rounded-lg px-3 py-2">{runsError}</div>
      )}
      {!runsLoading && !runsError && runs.length === 0 && (
        <div className="text-[13px] text-[#737686] py-6 text-center">暂无运行记录</div>
      )}

      <div className="space-y-2 max-h-[600px] overflow-y-auto pr-1">
        {runs.map((run) => {
          const meta = runStatusMeta(run.status);
          const active = selectedRunId === run.id;
          return (
            <button
              key={run.id}
              onClick={() => setSelectedRunId(run.id)}
              className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors ${
                active
                  ? 'bg-[#d0e1fb] border-[#b4c5ff]'
                  : 'bg-white border-[#e0e3e5] hover:bg-[#f7f9fb]'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] font-semibold text-[#191c1e]">#{run.id}</span>
                <span className={`text-[11px] px-1.5 py-0.5 rounded border ${meta.className}`}>
                  {meta.label}
                </span>
              </div>
              <div className="text-[11px] text-[#737686] mt-1">
                {formatTime(run.started_at)} · {run.trigger === 'manual' ? '手动' : '定时'}
              </div>
              <div className="text-[11px] text-[#434655] mt-0.5">
                总 {run.total} · 成功 {run.ok_count} · 失败{' '}
                <span className="text-[#c62828] font-semibold">{run.fail_count}</span> · 跳过{' '}
                {run.skip_count}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );

  // ── 明细表格 ──

  const renderResults = () => {
    if (resultsLoading) {
      return <div className="text-[13px] text-[#434655] py-10 text-center">加载明细中...</div>;
    }
    if (resultsError) {
      return <div className="text-[12px] text-[#c62828] bg-[#ffe0e0] rounded-lg px-3 py-2">{resultsError}</div>;
    }
    if (results.length === 0) {
      return <div className="text-[13px] text-[#737686] py-10 text-center">该批次暂无明细数据</div>;
    }

    const isQuality = activeKind === 'quality';

    return (
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[12px] text-[#737686] border-b border-[#e0e3e5]">
              <th className="py-2 pr-3 font-medium">渠道</th>
              <th className="py-2 pr-3 font-medium">模型</th>
              <th className="py-2 pr-3 font-medium">协议</th>
              <th className="py-2 pr-3 font-medium">状态</th>
              {isQuality ? (
                <>
                  <th className="py-2 pr-3 font-medium text-right">分数</th>
                  <th className="py-2 pr-3 font-medium">结论</th>
                  <th className="py-2 font-medium">报告</th>
                </>
              ) : (
                <>
                  <th className="py-2 pr-3 font-medium text-right">状态码</th>
                  <th className="py-2 pr-3 font-medium text-right">耗时(ms)</th>
                  <th className="py-2 font-medium">错误原因</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {results.map((r) => {
              const meta = resultStatusMeta(r.status);
              return (
                <tr key={r.id} className="border-b border-[#f1f2f5] last:border-b-0 align-top">
                  <td className="py-2.5 pr-3 font-semibold text-[#191c1e]">
                    {r.channel_name || `#${r.channel_id}`}
                  </td>
                  <td className="py-2.5 pr-3 text-[#434655] font-mono text-[12px]">{r.model || '—'}</td>
                  <td className="py-2.5 pr-3">
                    {r.protocol ? (
                      <span className="inline-block text-[11px] px-1.5 py-0.5 rounded bg-[#f1f2f5] text-[#434655] font-mono">
                        {r.protocol}
                      </span>
                    ) : (
                      <span className="text-[#737686]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded ${meta.className}`}>
                      {meta.label}
                    </span>
                  </td>
                  {isQuality ? (
                    <>
                      <td className="py-2.5 pr-3 text-right font-bold text-[#191c1e]">
                        {r.score || r.score === 0 ? r.score : '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-[#434655]">{r.verdict || '—'}</td>
                      <td className="py-2.5">
                        {r.report_url ? (
                          <a
                            href={r.report_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-[#004ac6] hover:underline font-semibold"
                          >
                            查看报告
                          </a>
                        ) : (
                          <span className="text-[#737686]">—</span>
                        )}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2.5 pr-3 text-right text-[#434655]">
                        {r.status_code || '—'}
                      </td>
                      <td className="py-2.5 pr-3 text-right text-[#434655]">
                        {r.latency_ms || '—'}
                      </td>
                      <td className="py-2.5 text-[#c62828] max-w-[420px] break-words">{r.error || '—'}</td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const renderResultsSection = () => (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
      {renderRunList()}

      <div className="bg-white border border-[#c3c6d7] rounded-xl shadow-2xs p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[14px] font-bold text-[#191c1e] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px] text-[#004ac6]">list_alt</span>
            探测明细{selectedRunId != null ? ` #${selectedRunId}` : ''}
          </h3>
          <label className="flex items-center gap-1.5 text-[12px] text-[#434655] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={onlyFailed}
              onChange={(e) => setOnlyFailed(e.target.checked)}
              className="accent-[#004ac6]"
            />
            仅看失败
          </label>
        </div>
        {selectedRunId == null ? (
          <div className="text-[13px] text-[#737686] py-10 text-center">请选择左侧一次运行查看明细</div>
        ) : (
          renderResults()
        )}
      </div>
    </div>
  );

  // ── 可用性探测表单 ──

  const renderAvailabilityForm = () => (
    <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-[#191c1e]">可用性探测配置</h3>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#434655]">{availConfig.enabled ? '已启用' : '已停用'}</span>
          <Toggle
            checked={availConfig.enabled}
            onChange={(v) => setAvailConfig({ ...availConfig, enabled: v })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Cron 表达式" hint="标准 5 字段，例如 0 */6 * * *（每 6 小时）。失焦或用「校验」按钮验证。">
          <div className="flex gap-2">
            <input
              value={availConfig.cron}
              onChange={(e) => {
                setAvailConfig({ ...availConfig, cron: e.target.value });
                // 内容变了，清掉上一次的校验结果，避免提示与当前输入不一致
                setAvailCron({ checking: false, valid: null, message: '' });
              }}
              onBlur={() => handleValidateCron('availability')}
              placeholder="0 */6 * * *"
              className={`${INPUT_CLASS} font-mono`}
            />
            <button
              type="button"
              onClick={() => handleValidateCron('availability')}
              disabled={availCron.checking}
              className="px-3 py-2 bg-white border border-[#c3c6d7] text-[#191c1e] font-semibold text-[12px] rounded-lg hover:bg-[#eeefff] transition-colors shrink-0 disabled:opacity-50"
            >
              校验
            </button>
          </div>
          {availCron.message && (
            <p
              className={`text-[11px] mt-1 ${
                availCron.valid === false
                  ? 'text-[#c62828]'
                  : availCron.valid === true
                    ? 'text-[#006242]'
                    : 'text-[#737686]'
              }`}
            >
              {availCron.message}
            </p>
          )}
        </Field>

        <Field
          label={`渠道白名单${selectedChannelCount > 0 ? `（已选 ${selectedChannelCount}）` : ''}`}
          hint="为空表示探测全部启用且配置了 base_url/key 的渠道。"
        >
          <div className="border border-[#c3c6d7] rounded-lg bg-white max-h-44 overflow-y-auto p-1.5">
            {channels.length === 0 ? (
              <div className="text-[12px] text-[#737686] px-2 py-2">渠道列表为空或加载失败</div>
            ) : (
              channels.map((ch) => (
                <label
                  key={ch.id}
                  className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#f7f9fb] cursor-pointer text-[13px] text-[#191c1e]"
                >
                  <input
                    type="checkbox"
                    checked={availConfig.channel_ids.includes(ch.id)}
                    onChange={() => toggleChannel(ch.id)}
                    className="accent-[#004ac6]"
                  />
                  <span className="truncate">{ch.name}</span>
                  <span className="text-[11px] text-[#737686] ml-auto shrink-0">#{ch.id}</span>
                </label>
              ))
            )}
          </div>
        </Field>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Field label="每渠道最多模型数" hint="0 表示不限">
          <input
            type="number"
            min={0}
            value={availConfig.max_models_per_channel}
            onChange={(e) =>
              setAvailConfig({ ...availConfig, max_models_per_channel: Number(e.target.value) })
            }
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="并发数">
          <input
            type="number"
            min={1}
            value={availConfig.concurrency}
            onChange={(e) => setAvailConfig({ ...availConfig, concurrency: Number(e.target.value) })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="单请求超时(秒)">
          <input
            type="number"
            min={1}
            value={availConfig.timeout_sec}
            onChange={(e) => setAvailConfig({ ...availConfig, timeout_sec: Number(e.target.value) })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="max_tokens">
          <input
            type="number"
            min={1}
            value={availConfig.max_tokens}
            onChange={(e) => setAvailConfig({ ...availConfig, max_tokens: Number(e.target.value) })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="告警冷却(秒)">
          <input
            type="number"
            min={0}
            value={availConfig.cooldown_sec}
            onChange={(e) => setAvailConfig({ ...availConfig, cooldown_sec: Number(e.target.value) })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <Field label="探测内容 (prompt)">
        <textarea
          rows={3}
          value={availConfig.prompt}
          onChange={(e) => setAvailConfig({ ...availConfig, prompt: e.target.value })}
          className={`${INPUT_CLASS} resize-none`}
        />
      </Field>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="飞书 Webhook 地址">
          <div className="flex gap-2">
            <input
              value={availConfig.feishu_webhook}
              onChange={(e) => setAvailConfig({ ...availConfig, feishu_webhook: e.target.value })}
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={handleTestWebhook}
              disabled={testingWebhook}
              className="px-3 py-2 bg-white border border-[#c3c6d7] text-[#191c1e] font-semibold text-[12px] rounded-lg hover:bg-[#eeefff] transition-colors shrink-0 disabled:opacity-50"
            >
              {testingWebhook ? '测试中...' : '测试'}
            </button>
          </div>
        </Field>
        <Field label="@用户 open_id" hint="多个用户用英文逗号分隔。">
          <input
            value={availConfig.at_users}
            onChange={(e) => setAvailConfig({ ...availConfig, at_users: e.target.value })}
            placeholder="ou_xxx,ou_yyy"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
    </div>
  );

  // ── 质量探测表单 ──

  const renderQualityForm = () => (
    <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[15px] font-bold text-[#191c1e]">质量探测配置</h3>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[#434655]">{qualityConfig.enabled ? '已启用' : '已停用'}</span>
          <Toggle
            checked={qualityConfig.enabled}
            onChange={(v) => setQualityConfig({ ...qualityConfig, enabled: v })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Cron 表达式" hint="独立于可用性探测，标准 5 字段。失焦或用「校验」按钮验证。">
          <div className="flex gap-2">
            <input
              value={qualityConfig.cron}
              onChange={(e) => {
                setQualityConfig({ ...qualityConfig, cron: e.target.value });
                // 内容变了，清掉上一次的校验结果，避免提示与当前输入不一致
                setQualityCron({ checking: false, valid: null, message: '' });
              }}
              onBlur={() => handleValidateCron('quality')}
              placeholder="0 8 * * *"
              className={`${INPUT_CLASS} font-mono`}
            />
            <button
              type="button"
              onClick={() => handleValidateCron('quality')}
              disabled={qualityCron.checking}
              className="px-3 py-2 bg-white border border-[#c3c6d7] text-[#191c1e] font-semibold text-[12px] rounded-lg hover:bg-[#eeefff] transition-colors shrink-0 disabled:opacity-50"
            >
              校验
            </button>
          </div>
          {qualityCron.message && (
            <p
              className={`text-[11px] mt-1 ${
                qualityCron.valid === false
                  ? 'text-[#c62828]'
                  : qualityCron.valid === true
                    ? 'text-[#006242]'
                    : 'text-[#737686]'
              }`}
            >
              {qualityCron.message}
            </p>
          )}
        </Field>

        <Field label="检测模式" hint="standard 为快速检测，full 为完整检测（耗时更长）。">
          <select
            value={qualityConfig.mode}
            onChange={(e) => setQualityConfig({ ...qualityConfig, mode: e.target.value })}
            className={INPUT_CLASS}
          >
            <option value="standard">standard</option>
            <option value="full">full</option>
          </select>
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Field label="分数告警阈值">
          <input
            type="number"
            value={qualityConfig.score_threshold}
            onChange={(e) =>
              setQualityConfig({ ...qualityConfig, score_threshold: Number(e.target.value) })
            }
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="单任务超时(秒)">
          <input
            type="number"
            min={1}
            value={qualityConfig.timeout_sec}
            onChange={(e) => setQualityConfig({ ...qualityConfig, timeout_sec: Number(e.target.value) })}
            className={INPUT_CLASS}
          />
        </Field>
        <Field label="告警冷却(秒)">
          <input
            type="number"
            min={0}
            value={qualityConfig.cooldown_sec}
            onChange={(e) => setQualityConfig({ ...qualityConfig, cooldown_sec: Number(e.target.value) })}
            className={INPUT_CLASS}
          />
        </Field>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="飞书 Webhook 地址">
          <div className="flex gap-2">
            <input
              value={qualityConfig.feishu_webhook}
              onChange={(e) => setQualityConfig({ ...qualityConfig, feishu_webhook: e.target.value })}
              placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/..."
              className={INPUT_CLASS}
            />
            <button
              type="button"
              onClick={handleTestWebhook}
              disabled={testingWebhook}
              className="px-3 py-2 bg-white border border-[#c3c6d7] text-[#191c1e] font-semibold text-[12px] rounded-lg hover:bg-[#eeefff] transition-colors shrink-0 disabled:opacity-50"
            >
              {testingWebhook ? '测试中...' : '测试'}
            </button>
          </div>
        </Field>
        <Field label="@用户 open_id" hint="多个用户用英文逗号分隔。">
          <input
            value={qualityConfig.at_users}
            onChange={(e) => setQualityConfig({ ...qualityConfig, at_users: e.target.value })}
            placeholder="ou_xxx,ou_yyy"
            className={INPUT_CLASS}
          />
        </Field>
      </div>
    </div>
  );

  // 表单底部操作区
  const renderFormActions = () => (
    <div className="flex items-center justify-end gap-3">
      <button
        onClick={handleSave}
        disabled={saving}
        className="px-4 py-2 bg-white border border-[#c3c6d7] text-[#191c1e] font-semibold text-[13px] rounded-lg hover:bg-[#eeefff] transition-colors flex items-center gap-1.5 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[17px] text-[#004ac6]">save</span>
        {saving ? '保存中...' : '保存配置'}
      </button>
      <button
        onClick={() => handleTrigger(activeKind)}
        disabled={triggering != null}
        className="px-4 py-2 bg-[#004ac6] text-white font-semibold text-[13px] rounded-lg hover:opacity-90 transition-opacity flex items-center gap-1.5 disabled:opacity-50"
      >
        <span className="material-symbols-outlined text-[17px]">play_arrow</span>
        {triggering === activeKind ? '触发中...' : '立即执行'}
      </button>
    </div>
  );

  const tabs = useMemo(
    () =>
      [
        { key: 'availability' as const, label: '可用性探测', icon: 'health_and_safety' },
        { key: 'quality' as const, label: '质量探测', icon: 'workspace_premium' },
      ],
    []
  );

  return (
    <div className="space-y-6">
      {/* 标题 + 刷新 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-bold text-[#191c1e]">渠道探测</h2>
          <p className="text-[14px] text-[#434655]">
            按 cron 定时探测渠道模型可用性，并从最近一次可用性成功结果中抽样，调用 veridrop 检测中转站真伪与质量。
          </p>
        </div>
        <button
          onClick={handleRefresh}
          className="px-3 py-1.5 bg-white border border-[#c3c6d7] text-[#191c1e] font-semibold text-[12px] rounded-lg hover:bg-[#eeefff] transition-colors flex items-center gap-1 shrink-0"
        >
          <span className="material-symbols-outlined text-[16px] text-[#004ac6]">refresh</span>
          刷新
        </button>
      </div>

      {/* 页内提示条 */}
      {feedback && (
        <div
          className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px] font-medium ${
            feedback.type === 'success'
              ? 'bg-[#e6f4ea] border-[#a5d6a7] text-[#006242]'
              : 'bg-[#ffe0e0] border-[#ef9a9a] text-[#c62828]'
          }`}
        >
          <span className="material-symbols-outlined text-[18px] shrink-0">
            {feedback.type === 'success' ? 'check_circle' : 'error'}
          </span>
          <span className="flex-1 break-words">{feedback.message}</span>
          <button onClick={() => setFeedback(null)} className="shrink-0 opacity-70 hover:opacity-100">
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* 配置加载失败提示 */}
      {configError && (
        <div className="text-[13px] text-[#c62828] bg-[#ffe0e0] border border-[#ef9a9a] rounded-lg px-3 py-2.5 flex items-center gap-2">
          <span className="material-symbols-outlined text-[18px]">error</span>
          {configError}
        </div>
      )}

      {configLoading ? (
        <div className="bg-white border border-[#c3c6d7] rounded-xl p-10 text-center text-[#434655] text-[14px] shadow-2xs">
          加载探测配置中...
        </div>
      ) : (
        <>
          {/* 顶部状态卡 */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {renderStatusCard('availability')}
            {renderStatusCard('quality')}
          </div>

          {/* 页签 */}
          <div className="flex border-b border-[#c3c6d7] -mb-1">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveKind(tab.key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-colors -mb-[1px] ${
                  activeKind === tab.key
                    ? 'border-[#004ac6] text-[#004ac6] bg-[#f0f0ff]'
                    : 'border-transparent text-[#737686] hover:text-[#191c1e] hover:bg-[#f7f9fb]'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* 配置表单 + 操作 */}
          {activeKind === 'availability' ? renderAvailabilityForm() : renderQualityForm()}
          {renderFormActions()}

          {/* 运行历史 + 明细 */}
          {renderResultsSection()}
        </>
      )}
    </div>
  );
};
