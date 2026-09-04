import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { getChannelErrorRate, ChannelErrorRateResult } from '../api/rules';

const COLORS = [
  '#004ac6',
  '#ba1a1a',
  '#006242',
  '#e65100',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
  '#9333ea',
  '#b45309',
];

const WINDOW_OPTIONS = [
  { value: 1, label: '最近 1 小时' },
  { value: 2, label: '最近 2 小时' },
  { value: 6, label: '最近 6 小时' },
  { value: 12, label: '最近 12 小时' },
  { value: 24, label: '最近 24 小时' },
];

function rateTone(r: number): string {
  if (r <= 1) return 'text-[#006242]';
  if (r <= 5) return 'text-[#e65100]';
  return 'text-[#ba1a1a]';
}

export const ChannelErrorRateView: React.FC = () => {
  const [windowHours, setWindowHours] = useState(2);
  const [data, setData] = useState<ChannelErrorRateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timerRef = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      setError('');
      const res = await getChannelErrorRate(windowHours);
      setData(res);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [windowHours]);

  // 初次加载 + 窗口切换
  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  // 每 30 秒自动刷新，反映实时滚动窗口
  useEffect(() => {
    timerRef.current = window.setInterval(load, 30000);
    return () => {
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, [load]);

  const rows = data
    ? data.buckets.map((bucket, i) => {
        const row: Record<string, string | number | null> = { time: bucket };
        for (const s of data.series) {
          const v = s.values[i];
          row[s.name] = v == null ? null : Number(v.toFixed(2));
        }
        return row;
      })
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-bold text-[#191c1e]">渠道错误率</h2>
          <p className="text-[14px] text-[#434655]">
            各渠道滚动窗口内的错误率趋势，错误率 = type=5 错误日志数 / 该渠道全部日志数（按请求量取 Top
            10，每 30 秒自动刷新）。
          </p>
        </div>
        <select
          value={windowHours}
          onChange={(e) => setWindowHours(Number(e.target.value))}
          className="border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[13px] bg-white text-[#191c1e] focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30"
        >
          {WINDOW_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
        {loading && (
          <div className="h-72 flex items-center justify-center text-[#434655] text-[13px]">
            加载中...
          </div>
        )}
        {!loading && error && (
          <div className="h-72 flex items-center justify-center text-[#ba1a1a] text-[13px]">{error}</div>
        )}
        {!loading && !error && (!data || data.series.length === 0) && (
          <div className="h-72 flex items-center justify-center text-[#737686] text-[13px]">
            当前窗口暂无日志数据
          </div>
        )}
        {!loading && !error && data && data.series.length > 0 && (
          <div className="h-96 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={rows} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e5" />
                <XAxis dataKey="time" stroke="#737686" fontSize={11} minTickGap={30} />
                <YAxis stroke="#737686" fontSize={11} unit="%" domain={[0, 100]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#ffffff',
                    borderColor: '#c3c6d7',
                    borderRadius: '8px',
                    fontSize: '12px',
                  }}
                  formatter={(value: unknown) =>
                    value == null ? '无数据' : `${Number(value).toFixed(2)}%`
                  }
                />
                <Legend />
                {data.series.map((s, i) => (
                  <Line
                    key={s.name}
                    type="monotone"
                    dataKey={s.name}
                    stroke={COLORS[i % COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
        <div>
          <h3 className="text-[16px] font-bold text-[#191c1e]">平均错误率</h3>
          <p className="text-[12px] text-[#434655]">
            各渠道在所选窗口内的平均错误率（= 错误日志数 / 全部日志数），按请求量降序。
          </p>
        </div>
        {loading && (
          <div className="flex items-center justify-center text-[#434655] text-[13px] py-8">
            加载中...
          </div>
        )}
        {!loading && (!data || data.series.length === 0) && (
          <div className="flex items-center justify-center text-[#737686] text-[13px] py-8">
            当前窗口暂无日志数据
          </div>
        )}
        {!loading && data && data.series.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-left text-[12px] text-[#737686] border-b border-[#e0e3e5]">
                  <th className="py-2 pr-3 font-medium">#</th>
                  <th className="py-2 pr-3 font-medium">渠道</th>
                  <th className="py-2 pr-3 font-medium text-right">错误日志</th>
                  <th className="py-2 pr-3 font-medium text-right">全部日志</th>
                  <th className="py-2 font-medium text-right">平均错误率</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((s, i) => (
                  <tr key={s.name} className="border-b border-[#f1f2f5] last:border-b-0">
                    <td className="py-2.5 pr-3 text-[#737686]">{i + 1}</td>
                    <td className="py-2.5 pr-3 font-semibold text-[#191c1e]">{s.name}</td>
                    <td className="py-2.5 pr-3 text-right text-[#434655]">{s.errors}</td>
                    <td className="py-2.5 pr-3 text-right text-[#434655]">{s.requests}</td>
                    <td
                      className={`py-2.5 text-right font-bold ${rateTone(s.avg_rate)}`}
                    >
                      {s.avg_rate.toFixed(2)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
