import React, { useState } from 'react';
import { ApiKey } from '../types';

interface ApiKeysViewProps {
  apiKeys: ApiKey[];
  onGenerateKey: (name: string, rateLimit: string) => void;
  onRevokeKey: (keyId: string) => void;
}

export const ApiKeysView: React.FC<ApiKeysViewProps> = ({
  apiKeys,
  onGenerateKey,
  onRevokeKey,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [keyName, setKeyName] = useState('');
  const [rateLimit, setRateLimit] = useState('5,000 次/分');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text || 'sk-aigw-prod-8f92xxxx');
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!keyName) return;
    onGenerateKey(keyName, rateLimit);
    setKeyName('');
    setShowModal(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[26px] md:text-[30px] font-semibold text-[#191c1e] tracking-[-0.02em]">
            网关 API 密钥管理
          </h2>
          <p className="text-[14px] text-[#434655] leading-[22px]">
            管理客户端、微服务与下游应用接入 AI 网关时使用的身份鉴权 API Key。
          </p>
        </div>

        <button
          onClick={() => setShowModal(true)}
          className="bg-[#004ac6] text-white font-medium text-[13px] px-4 py-2 rounded-lg hover:opacity-90 transition-all flex items-center gap-1.5 shadow-2xs self-start"
        >
          <span className="material-symbols-outlined text-[18px]">key</span>
          生成新密钥
        </button>
      </div>

      <div className="bg-white border border-[#c3c6d7] rounded-xl overflow-hidden shadow-2xs">
        <table className="w-full text-left text-[13px] border-collapse">
          <thead>
            <tr className="bg-[#f2f4f6] border-b border-[#c3c6d7] text-[#434655] font-semibold">
              <th className="py-3 px-4">密钥标识 / 应用名称</th>
              <th className="py-3 px-4">Key 前缀</th>
              <th className="py-3 px-4">状态</th>
              <th className="py-3 px-4">速率限制 (QPS)</th>
              <th className="py-3 px-4">今日已用请求</th>
              <th className="py-3 px-4">创建时间</th>
              <th className="py-3 px-4 text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e0e3e5]">
            {apiKeys.map((key) => (
              <tr key={key.id} className="hover:bg-[#f7f9fb] transition-colors">
                <td className="py-3 px-4 font-semibold text-[#191c1e]">{key.name}</td>
                <td className="py-3 px-4 font-mono text-[#004ac6] font-semibold">
                  {key.keyPrefix}••••••••
                </td>
                <td className="py-3 px-4">
                  <span
                    className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                      key.status === 'active'
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-[#ffdad6] text-[#93000a]'
                    }`}
                  >
                    {key.status === 'active' ? '正常激活' : '已撤销'}
                  </span>
                </td>
                <td className="py-3 px-4 text-[#434655] font-mono">{key.rateLimit}</td>
                <td className="py-3 px-4 text-[#191c1e] font-semibold">
                  {key.usageToday.toLocaleString()} 次
                </td>
                <td className="py-3 px-4 text-[#737686]">{key.createdAt}</td>
                <td className="py-3 px-4 text-right space-x-2">
                  <button
                    onClick={() => handleCopy(key.id, key.keyPrefix)}
                    className="px-2.5 py-1 bg-[#f2f4f6] hover:bg-[#e0e3e5] text-[#191c1e] font-medium rounded text-[12px] inline-flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[14px]">content_copy</span>
                    {copiedId === key.id ? '已复制' : '复制 Prefix'}
                  </button>
                  {key.status === 'active' && (
                    <button
                      onClick={() => onRevokeKey(key.id)}
                      className="px-2.5 py-1 text-[#ba1a1a] hover:bg-[#ffdad6] font-medium rounded text-[12px]"
                    >
                      撤销密钥
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
              <h3 className="text-[16px] font-bold text-[#191c1e]">生成全新网关 API Key</h3>
              <button onClick={() => setShowModal(false)} className="text-[#434655]">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1">
                <label className="text-[13px] font-semibold text-[#191c1e]">密钥标识 / 应用名称</label>
                <input
                  type="text"
                  required
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  placeholder="如：智能客服前端代理 Key"
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[13px] font-semibold text-[#191c1e]">限流配额 (Rate Limit)</label>
                <select
                  value={rateLimit}
                  onChange={(e) => setRateLimit(e.target.value)}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 text-[13px]"
                >
                  <option value="1,000 次/分">1,000 次/分</option>
                  <option value="5,000 次/分">5,000 次/分</option>
                  <option value="10,000 次/分">10,000 次/分</option>
                  <option value="无限制 (内部专线)">无限制 (内部专线)</option>
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-[#e0e3e5]">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-[#434655] text-[13px] font-medium hover:bg-[#e0e3e5] rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#004ac6] text-white text-[13px] font-medium rounded-lg hover:opacity-90"
                >
                  确认生成
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
