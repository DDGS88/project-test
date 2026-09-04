import React, { useEffect, useState } from 'react';
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
import { getCacheHitRate, CacheHitRateResult } from '../api/rules';

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

function buildRows(result: CacheHitRateResult | null) {
  if (!result) return [];
  return result.buckets.map((bucket, i) => {
    const row: Record<string, string | number | null> = { time: bucket };
    for (const s of result.series) {
      const v = s.values[i];
      row[s.name] = v == null ? null : Number(v.toFixed(2));
    }
    return row;
  });
}

interface ChartCardProps {
  title: string;
  subtitle: string;
  result: CacheHitRateResult | null;
  loading: boolean;
  error: string;
}

const ChartCard: React.FC<ChartCardProps> = ({ title, subtitle, result, loading, error }) => {
  const rows = buildRows(result);

  return (
    <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
      <div>
        <h3 className="text-[16px] font-bold text-[#191c1e]">{title}</h3>
        <p className="text-[12px] text-[#434655]">{subtitle}</p>
      </div>

      {loading && (
        <div className="h-72 flex items-center justify-center text-[#434655] text-[13px]">加载中...</div>
      )}
      {!loading && error && (
        <div className="h-72 flex items-center justify-center text-[#ba1a1a] text-[13px]">{error}</div>
      )}
      {!loading && !error && (!result || result.series.length === 0) && (
        <div className="h-72 flex items-center justify-center text-[#737686] text-[13px]">
          暂无缓存命中率数据
        </div>
      )}
      {!loading && !error && result && result.series.length > 0 && (
        <div className="h-72 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={rows} margin={{ top: 10, right: 20, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e0e3e5" />
              <XAxis dataKey="time" stroke="#737686" fontSize={11} minTickGap={24} />
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
              {result.series.map((s, i) => (
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
  );
};

export const CacheHitRateView: React.FC = () => {
  const [userData, setUserData] = useState<CacheHitRateResult | null>(null);
  const [channelData, setChannelData] = useState<CacheHitRateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError('');
      try {
        const [user, channel] = await Promise.all([
          getCacheHitRate('user'),
          getCacheHitRate('channel'),
        ]);
        if (cancelled) return;
        setUserData(user);
        setChannelData(channel);
      } catch (err: any) {
        if (!cancelled) setError(err.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const date = userData?.date || channelData?.date || '';

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[24px] font-bold text-[#191c1e]">缓存命中率</h2>
        <p className="text-[14px] text-[#434655]">
          当日（{date}）大模型缓存命中率趋势，按用户与渠道分别统计（10 分钟粒度，Top 10）。
        </p>
      </div>

      <ChartCard
        title="按用户"
        subtitle="各用户的缓存命中率（按请求量取 Top 10）"
        result={userData}
        loading={loading}
        error={error}
      />
      <ChartCard
        title="按渠道"
        subtitle="各渠道的缓存命中率（按请求量取 Top 10）"
        result={channelData}
        loading={loading}
        error={error}
      />
    </div>
  );
};
