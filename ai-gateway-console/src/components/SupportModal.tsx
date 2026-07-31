import React from 'react';

interface SupportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const SupportModal: React.FC<SupportModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4">
      <div className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden flex flex-col animate-scale-in">
        <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-[#004ac6]">help</span>
            <h3 className="text-[18px] font-bold text-[#191c1e]">AI Gateway Support</h3>
          </div>
          <button onClick={onClose} className="text-[#434655] hover:text-[#191c1e]">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 space-y-4 text-[14px] text-[#434655]">
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 p-3 rounded-lg text-[13px]">
            <strong>Diagnostic Status:</strong> All gateway proxies operating normally (ping: 12ms).
          </div>

          <div className="space-y-2">
            <p className="font-semibold text-[#191c1e]">Need Help with Alert Configuration?</p>
            <p className="text-[13px]">
              Contact our platform engineering team for custom regex rules, high-throughput webhook endpoints, or dedicated cluster monitoring.
            </p>
          </div>

          <div className="p-3 bg-[#f2f4f6] rounded-lg text-[13px] font-mono space-y-1">
            <p><strong>DevOps Email:</strong> devops-gateway@company.internal</p>
            <p><strong>On-Call Slack:</strong> #ai-gateway-oncall</p>
          </div>
        </div>

        <div className="px-6 py-3 bg-[#f2f4f6] border-t border-[#c3c6d7] flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 bg-[#004ac6] text-white text-[13px] font-semibold rounded-lg hover:opacity-90"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
