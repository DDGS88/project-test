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
import { getCacheHitRate, listChannels, CacheHitRateResult, ChannelOption } from '../api/rules';

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
  heightClass?: string;
}

const ChartCard: React.FC<ChartCardProps> = ({
  title,
  subtitle,
  result,
  loading,
  error,
  heightClass = 'h-72',
}) => {
  const rows = buildRows(result);

  return (
    <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-4">
      <div>
        <h3 className="text-[16px] font-bold text-[#191c1e]">{title}</h3>
        <p className="text-[12px] text-[#434655]">{subtitle}</p>
      </div>

      {loading && (
        <div className={`${heightClass} flex items-center justify-center text-[#434655] text-[13px]`}>
          加载中...
        </div>
      )}
      {!loading && error && (
        <div className={`${heightClass} flex items-center justify-center text-[#ba1a1a] text-[13px]`}>
          {error}
        </div>
      )}
      {!loading && !error && (!result || result.series.length === 0) && (
        <div className={`${heightClass} flex items-center justify-center text-[#737686] text-[13px]`}>
          暂无缓存命中率数据
        </div>
      )}
      {!loading && !error && result && result.series.length > 0 && (
        <div className={`${heightClass} w-full`}>
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

const selectClass =
  'border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[13px] bg-white text-[#191c1e] focus:outline-none focus:ring-2 focus:ring-[#004ac6]/30';

export const CacheHitRateView: React.FC = () => {
  const [windowHours, setWindowHours] = useState(2);
  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [selectedChannel, setSelectedChannel] = useState<number | null>(null);
  const [userData, setUserData] = useState<CacheHitRateResult | null>(null);
  const [channelData, setChannelData] = useState<CacheHitRateResult | null>(null);
  const [modelData, setModelData] = useState<CacheHitRateResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const timerRef = useRef<number | null>(null);

  // 加载渠道列表，默认选中第一个
  useEffect(() => {
    listChannels()
      .then((list) => {
        const arr = list || [];
        setChannels(arr);
        if (arr.length > 0) setSelectedChannel(arr[0].id);
      })
      .catch(() => setChannels([]));
  }, []);

  const load = useCallback(async () => {
    setError('');
    try {
      const [user, channel] = await Promise.all([
        getCacheHitRate('user', windowHours),
        getCacheHitRate('channel', windowHours),
      ]);
      setUserData(user);
      setChannelData(channel);

      if (selectedChannel != null) {
        const model = await getCacheHitRate('model', windowHours, selectedChannel);
        setModelData(model);
      } else {
        setModelData(null);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [windowHours, selectedChannel]);

  // 初次加载 + 窗口/渠道切换
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

  const selectedChannelName = channels.find((c) => c.id === selectedChannel)?.name ?? '';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[24px] font-bold text-[#191c1e]">缓存命中率</h2>
          <p className="text-[14px] text-[#434655]">
            滚动窗口内大模型缓存命中率趋势，命中率 = 缓存读取 /（缓存读取 + 缓存写入），按请求量取 Top
            10，每 30 秒自动刷新。
          </p>
        </div>
        <div className="flex items-center gap-2">
          {channels.length > 0 && (
            <select
              value={selectedChannel ?? ''}
              onChange={(e) => setSelectedChannel(Number(e.target.value))}
              className={selectClass}
              title="选择渠道以查看其下各模型"
            >
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  渠道：{c.name || `#${c.id}`}
                </option>
              ))}
            </select>
          )}
          <select
            value={windowHours}
            onChange={(e) => setWindowHours(Number(e.target.value))}
            className={selectClass}
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
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
      <ChartCard
        title={`渠道内模型${selectedChannelName ? `：${selectedChannelName}` : ''}`}
        subtitle="所选渠道下各模型的缓存命中率（按请求量取 Top 10）"
        result={selectedChannel != null ? modelData : null}
        loading={loading}
        error={error}
        heightClass="h-80"
      />
    </div>
  );
};
