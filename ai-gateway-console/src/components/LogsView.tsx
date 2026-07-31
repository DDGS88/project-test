import React, { useState } from 'react';
import { AlertLog } from '../types';

interface LogsViewProps {
  logs: AlertLog[];
  onClearLogs?: () => void;
}

export const LogsView: React.FC<LogsViewProps> = ({ logs }) => {
  const [logSearch, setLogSearch] = useState('');
  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [inspectLog, setInspectLog] = useState<AlertLog | null>(null);

  const filteredLogs = logs.filter((log) => {
    if (selectedStatus !== 'all' && log.status !== selectedStatus) return false;
    if (logSearch.trim()) {
      const q = logSearch.toLowerCase();
      return (
        log.ruleName.toLowerCase().includes(q) ||
        log.channel.toLowerCase().includes(q) ||
        log.model.toLowerCase().includes(q) ||
        log.matchedContent.toLowerCase().includes(q)
      );
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-[24px] font-bold text-[#191c1e]">Alert Trigger & Audit Logs</h2>
          <p className="text-[14px] text-[#434655]">
            Historical log of rule evaluations, matches, and webhook delivery status.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={logSearch}
            onChange={(e) => setLogSearch(e.target.value)}
            placeholder="Search log content..."
            className="bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[#004ac6]"
          />
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            className="bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[13px] outline-none focus:ring-2 focus:ring-[#004ac6]"
          >
            <option value="all">All Statuses</option>
            <option value="delivered">Delivered (200 OK)</option>
            <option value="failed">Delivery Failed</option>
            <option value="cooldown">Cooldown Skipped</option>
          </select>
        </div>
      </div>

      {/* Logs Table */}
      <div className="bg-white border border-[#c3c6d7] rounded-xl overflow-hidden shadow-2xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-[13px]">
            <thead>
              <tr className="bg-[#f2f4f6] border-b border-[#c3c6d7] text-[#434655] font-semibold">
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Rule Name</th>
                <th className="py-3 px-4">Type</th>
                <th className="py-3 px-4">Channel / Model</th>
                <th className="py-3 px-4">Matched Details</th>
                <th className="py-3 px-4">Webhook Status</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e0e3e5]">
              {filteredLogs.map((log) => (
                <tr key={log.id} className="hover:bg-[#f7f9fb] transition-colors">
                  <td className="py-3 px-4 font-mono text-[12px] text-[#434655] whitespace-nowrap">
                    {log.timestamp}
                  </td>
                  <td className="py-3 px-4 font-bold text-[#191c1e]">{log.ruleName}</td>
                  <td className="py-3 px-4">
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase bg-[#d0e1fb] text-[#54647a]">
                      {log.type}
                    </span>
                  </td>
                  <td className="py-3 px-4 text-[#434655]">
                    {log.channel} / <span className="font-semibold text-[#191c1e]">{log.model}</span>
                  </td>
                  <td className="py-3 px-4 font-mono text-[12px] text-[#006242] max-w-xs truncate">
                    {log.matchedContent}
                  </td>
                  <td className="py-3 px-4 whitespace-nowrap">
                    {log.status === 'delivered' && (
                      <span className="inline-flex items-center gap-1 text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded text-[11px] font-bold">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600"></span>
                        200 OK ({log.latencyMs}ms)
                      </span>
                    )}
                    {log.status === 'failed' && (
                      <span className="inline-flex items-center gap-1 text-[#93000a] bg-[#ffdad6] px-2 py-0.5 rounded text-[11px] font-bold">
                        HTTP 500 Error
                      </span>
                    )}
                    {log.status === 'cooldown' && (
                      <span className="inline-flex items-center gap-1 text-[#434655] bg-[#e0e3e5] px-2 py-0.5 rounded text-[11px] font-bold">
                        Cooldown Active
                      </span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right whitespace-nowrap">
                    <button
                      onClick={() => setInspectLog(log)}
                      className="text-[#004ac6] hover:underline font-semibold text-[12px]"
                    >
                      Inspect Payload
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {filteredLogs.length === 0 && (
            <div className="p-8 text-center text-[#737686]">
              No alert logs match your filter criteria.
            </div>
          )}
        </div>
      </div>

      {/* Inspect Log Payload Modal */}
      {inspectLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden flex flex-col animate-scale-in">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
              <h3 className="text-[16px] font-bold text-[#191c1e]">
                Alert Event Payload: {inspectLog.ruleName}
              </h3>
              <button
                onClick={() => setInspectLog(null)}
                className="text-[#434655] hover:text-[#191c1e] p-1 rounded-lg"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div className="space-y-1 text-[13px]">
                <p>
                  <strong>Log ID:</strong> {inspectLog.id}
                </p>
                <p>
                  <strong>Timestamp:</strong> {inspectLog.timestamp}
                </p>
                <p>
                  <strong>Matched Content:</strong>{' '}
                  <span className="font-mono text-[#006242]">{inspectLog.matchedContent}</span>
                </p>
              </div>

              <div className="space-y-1">
                <label className="text-[12px] font-bold text-[#434655] uppercase">
                  Dispatched Webhook Payload
                </label>
                <pre className="bg-[#2d3133] text-[#bdffdb] p-3 rounded-lg font-mono text-[12px] overflow-x-auto">
                  {JSON.stringify(
                    {
                      event: 'alert.rule_triggered',
                      log_id: inspectLog.id,
                      rule_name: inspectLog.ruleName,
                      type: inspectLog.type,
                      channel: inspectLog.channel,
                      model: inspectLog.model,
                      matched_content: inspectLog.matchedContent,
                      webhook_response_code: inspectLog.webhookResponseCode,
                      timestamp: inspectLog.timestamp,
                    },
                    null,
                    2
                  )}
                </pre>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={() => setInspectLog(null)}
                  className="px-4 py-2 bg-[#004ac6] text-white text-[13px] font-semibold rounded-lg hover:opacity-90"
                >
                  Close Inspection
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
