import React, { useState } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';

const TIME_SERIES_DATA = [
  { time: '00:00', requests: 1200, errors: 4, tokens: 42000, latency: 420 },
  { time: '02:00', requests: 850, errors: 2, tokens: 28000, latency: 380 },
  { time: '04:00', requests: 600, errors: 1, tokens: 19000, latency: 350 },
  { time: '06:00', requests: 1400, errors: 8, tokens: 52000, latency: 510 },
  { time: '08:00', requests: 3100, errors: 42, tokens: 110000, latency: 890 },
  { time: '10:00', requests: 4800, errors: 68, tokens: 185000, latency: 1250 },
  { time: '12:00', requests: 5200, errors: 110, tokens: 210000, latency: 1420 },
  { time: '14:00', requests: 4900, errors: 85, tokens: 195000, latency: 1180 },
  { time: '16:00', requests: 4300, errors: 35, tokens: 160000, latency: 780 },
  { time: '18:00', requests: 3600, errors: 18, tokens: 135000, latency: 620 },
  { time: '20:00', requests: 2800, errors: 12, tokens: 98000, latency: 510 },
  { time: '22:00', requests: 1900, errors: 6, tokens: 68000, latency: 440 },
];

const MODEL_BREAKDOWN = [
  { model: 'gpt-4o', count: 24500, share: '45%' },
  { model: 'claude-3-5-sonnet', count: 18200, share: '33%' },
  { model: 'deepseek-r1', count: 8100, share: '15%' },
  { model: 'gemini-2.5-flash', count: 3800, share: '7%' },
];

export const MonitoringView: React.FC = () => {
  const [metricTimeframe, setMetricTimeframe] = useState<'1小时' | '24小时' | '7天'>('24小时');
  const [isSimulatingTraffic, setIsSimulatingTraffic] = useState(false);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-[26px] md:text-[30px] font-semibold text-[#191c1e] tracking-[-0.02em]">
            网关遥测与实时监控
          </h2>
          <p className="text-[14px] text-[#434655] leading-[22px]">
            实时监测 API 请求吞吐量、错误率、各模型响应延迟及告警阈值评估状态。
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsSimulatingTraffic(!isSimulatingTraffic)}
            className={`px-3.5 py-1.5 rounded-lg text-[13px] font-medium flex items-center gap-1.5 transition-all ${
              isSimulatingTraffic
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-[#d0e1fb] text-[#003ea8] hover:bg-[#b4c5ff]'
            }`}
          >
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            {isSimulatingTraffic ? '突发流量模拟中' : '模拟突发流量测试'}
          </button>

          <div className="flex bg-[#f2f4f6] p-1 rounded-lg border border-[#c3c6d7]">
            {(['1小时', '24小时', '7天'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setMetricTimeframe(t)}
                className={`px-3 py-1 text-[12px] font-semibold rounded-md transition-colors ${
                  metricTimeframe === t
                    ? 'bg-white text-[#004ac6] shadow-2xs'
                    : 'text-[#434655] hover:text-[#191c1e]'
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metric Cards Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <span className="text-[12px] font-semibold text-[#434655]">总请求量 (Requests)</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold text-[#191c1e]">41,450</span>
            <span className="text-[12px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">
              +12.4%
            </span>
          </div>
          <p className="text-[11px] text-[#737686] mt-1">平均 1,720 次/分钟</p>
        </div>

        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <span className="text-[12px] font-semibold text-[#434655]">错误率 (Error Rate)</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold text-[#ba1a1a]">0.95%</span>
            <span className="text-[12px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">
              -0.2%
            </span>
          </div>
          <p className="text-[11px] text-[#737686] mt-1">设定的告警上限阈值: 5.0%</p>
        </div>

        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <span className="text-[12px] font-semibold text-[#434655]">Token 吞吐量</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold text-[#191c1e]">1.42 M</span>
            <span className="text-[12px] text-amber-700 font-bold bg-amber-50 px-2 py-0.5 rounded">
              峰值 210k/分
            </span>
          </div>
          <p className="text-[11px] text-[#737686] mt-1">今日累计消耗 Token</p>
        </div>

        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <span className="text-[12px] font-semibold text-[#434655]">P95 响应延迟</span>
          <div className="mt-2 flex items-baseline justify-between">
            <span className="text-[28px] font-extrabold text-[#191c1e]">840 ms</span>
            <span className="text-[12px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded">
              正常健康
            </span>
          </div>
          <p className="text-[11px] text-[#737686] mt-1">目标 SLA 延迟 &lt; 2500ms</p>
        </div>
      </div>

      {/* Main Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Request Volume Chart */}
        <div className="lg:col-span-2 bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-[16px] font-bold text-[#191c1e]">请求量与错误率趋势</h3>
              <p className="text-[12px] text-[#434655]">24 小时 API 网关流量与错误监测曲线</p>
            </div>
            <div className="flex items-center gap-4 text-[12px] font-medium">
              <span className="flex items-center gap-1.5 text-[#004ac6]">
                <span className="w-3 h-3 bg-[#004ac6] rounded-xs inline-block" /> 请求量
              </span>
              <span className="flex items-center gap-1.5 text-[#ba1a1a]">
                <span className="w-3 h-3 bg-[#ba1a1a] rounded-xs inline-block" /> 错误数
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={TIME_SERIES_DATA} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorReq" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#004ac6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#004ac6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorErr" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ba1a1a" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#ba1a1a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e5" />
                <XAxis dataKey="time" stroke="#737686" fontSize={11} />
                <YAxis stroke="#737686" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#c3c6d7',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                />
                <Area type="monotone" dataKey="requests" stroke="#004ac6" strokeWidth={2} fillOpacity={1} fill="url(#colorReq)" />
                <Area type="monotone" dataKey="errors" stroke="#ba1a1a" strokeWidth={2} fillOpacity={1} fill="url(#colorErr)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Model Distribution */}
        <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
          <div>
            <h3 className="text-[16px] font-bold text-[#191c1e]">模型流量占比分布</h3>
            <p className="text-[12px] text-[#434655]">各上游大模型 API 调用的份额占比</p>
          </div>

          <div className="h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={MODEL_BREAKDOWN} layout="vertical" margin={{ top: 0, right: 10, left: 40, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e5" horizontal={false} />
                <XAxis type="number" stroke="#737686" fontSize={10} />
                <YAxis dataKey="model" type="category" stroke="#191c1e" fontSize={11} />
                <Tooltip />
                <Bar dataKey="count" fill="#004ac6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="space-y-2 border-t border-[#e0e3e5] pt-3">
            {MODEL_BREAKDOWN.map((item) => (
              <div key={item.model} className="flex justify-between items-center text-[12px]">
                <span className="text-[#191c1e] font-semibold">{item.model}</span>
                <span className="text-[#434655] font-mono">{item.share} ({item.count.toLocaleString()} 次)</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
