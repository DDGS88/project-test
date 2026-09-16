import React, { useState } from 'react';

const VERIDROP_URL = '/veridrop/';

/**
 * 中转站检测（veridrop）
 *
 * veridrop 是独立部署的 Python 服务，由 Go 后端反向代理到 /veridrop 下，
 * 这里直接用 iframe 内嵌，保持其完整的检测 / 历史记录 / 报告页面体验。
 */
export const VeridropView: React.FC = () => {
  const [reloadKey, setReloadKey] = useState(0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#c3c6d7] rounded-xl px-5 py-4 shadow-2xs">
        <div>
          <h2 className="text-[16px] font-bold text-[#191c1e]">中转站检测</h2>
          <p className="text-[12px] text-[#434655]">
            检测第三方中转站是否为真 Claude / GPT / Gemini，每次探测生成独立检测报告并保留历史记录
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-[#c3c6d7] text-[13px] font-medium text-[#434655] hover:bg-[#f2f4f6] transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">refresh</span>
            重新加载
          </button>
          <a
            href={VERIDROP_URL}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#004ac6] text-white text-[13px] font-medium hover:opacity-90 transition-opacity"
          >
            <span className="material-symbols-outlined text-[18px]">open_in_new</span>
            新窗口打开
          </a>
        </div>
      </div>

      <iframe
        key={reloadKey}
        src={VERIDROP_URL}
        title="中转站检测"
        className="w-full h-[calc(100vh-200px)] min-h-[600px] bg-white border border-[#c3c6d7] rounded-xl shadow-2xs"
      />
    </div>
  );
};
