import React from 'react';

interface DocModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const DocModal: React.FC<DocModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4">
      <div className="bg-white w-full max-w-2xl rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden flex flex-col max-h-[85vh] animate-scale-in">
        <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6]">description</span>
            <h3 className="text-[18px] font-bold text-[#191c1e]">Alert Rules Syntax & Docs</h3>
          </div>
          <button onClick={onClose} className="text-[#434655] hover:text-[#191c1e]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-5 text-[14px] text-[#434655]">
          <section className="space-y-2">
            <h4 className="font-bold text-[#191c1e] text-[15px]">1. Regex Match Pattern Syntax</h4>
            <p>
              Alert rules support standard JavaScript regular expressions for pattern matching on response bodies, header exceptions, and error strings.
            </p>
            <div className="bg-[#2d3133] text-[#bdffdb] p-3 rounded-lg font-mono text-[12px] space-y-1">
              <p>/[timeout|connect_error]/i - Matches any timeout or connection error case-insensitively</p>
              <p>/HTTP 429/ - Matches rate limit HTTP status code</p>
              <p>/invalid_api_key/i - Detects unauthorized API key usage</p>
            </div>
          </section>

          <section className="space-y-2">
            <h4 className="font-bold text-[#191c1e] text-[15px]">2. Token Threshold Evaluation</h4>
            <p>
              Token rules evaluate total input and output token consumption across model clusters over the specified time window (e.g. 60 seconds).
            </p>
          </section>

          <section className="space-y-2">
            <h4 className="font-bold text-[#191c1e] text-[15px]">3. Feishu & Slack Webhook Format</h4>
            <p>
              Alert payloads are dispatched in standard webhook schema compatible with Feishu bot webhooks, Slack incoming webhooks, and custom endpoints.
            </p>
          </section>
        </div>

        <div className="px-6 py-3 bg-[#f2f4f6] border-t border-[#c3c6d7] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#004ac6] text-white text-[13px] font-semibold rounded-lg hover:opacity-90"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};
