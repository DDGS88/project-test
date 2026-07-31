import React, { useState } from 'react';

export const SettingsView: React.FC = () => {
  const [globalCooldown, setGlobalCooldown] = useState(300);
  const [maxRetries, setMaxRetries] = useState(3);
  const [enableDeduplication, setEnableDeduplication] = useState(true);
  const [saved, setSaved] = useState(false);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-[24px] font-bold text-[#191c1e]">Gateway Settings</h2>
        <p className="text-[14px] text-[#434655]">
          Global alert notification triggers, webhook retry strategies, and rate-limiting rules.
        </p>
      </div>

      {saved && (
        <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 p-3 rounded-lg text-[13px] font-semibold flex items-center gap-2 animate-scale-in">
          <span className="material-symbols-outlined text-[18px]">check_circle</span>
          Gateway settings saved successfully!
        </div>
      )}

      <form onSubmit={handleSave} className="bg-white border border-[#c3c6d7] rounded-xl p-6 shadow-2xs space-y-6">
        <div className="space-y-4">
          <h3 className="text-[16px] font-bold text-[#191c1e] border-b border-[#e0e3e5] pb-2">
            Notification & Dispatch Rules
          </h3>

          <div className="space-y-1">
            <label className="text-[14px] font-bold text-[#191c1e]">
              Global Default Cooldown Period (seconds)
            </label>
            <input
              type="number"
              value={globalCooldown}
              onChange={(e) => setGlobalCooldown(Number(e.target.value))}
              className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[14px]"
            />
            <p className="text-[12px] text-[#737686]">
              Minimum delay between consecutive duplicate alerts across channels.
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-[14px] font-bold text-[#191c1e]">
              Webhook Max Retry Attempts
            </label>
            <select
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 text-[14px]"
            >
              <option value={1}>1 attempt (No retry)</option>
              <option value={3}>3 retries with exponential backoff</option>
              <option value={5}>5 retries with exponential backoff</option>
            </select>
          </div>

          <div className="flex items-center gap-3 pt-2">
            <input
              type="checkbox"
              id="dedup"
              checked={enableDeduplication}
              onChange={(e) => setEnableDeduplication(e.target.checked)}
              className="w-4 h-4 rounded text-[#004ac6] focus:ring-[#004ac6]"
            />
            <label htmlFor="dedup" className="text-[14px] font-medium text-[#191c1e]">
              Enable alert event deduplication across clusters
            </label>
          </div>
        </div>

        <div className="pt-4 border-t border-[#e0e3e5] flex justify-end">
          <button
            type="submit"
            className="px-6 py-2 bg-[#004ac6] text-white text-[13px] font-semibold rounded-lg hover:opacity-90 transition-all shadow-2xs"
          >
            Save Gateway Settings
          </button>
        </div>
      </form>
    </div>
  );
};
