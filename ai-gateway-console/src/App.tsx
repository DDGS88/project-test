/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useCallback } from 'react';
import { Sidebar } from './components/Sidebar';
import { TopHeader } from './components/TopHeader';
import { AlertRulesView } from './components/AlertRulesView';
import { CreateRuleModal } from './components/CreateRuleModal';
import { TestRuleModal } from './components/TestRuleModal';
import { MonitoringView } from './components/MonitoringView';
import { LogsView } from './components/LogsView';
import { NotificationChannelsView } from './components/NotificationChannelsView';
import { ApiKeysView } from './components/ApiKeysView';
import { DashboardView } from './components/DashboardView';
import { SettingsView } from './components/SettingsView';
import { ErrorScanAlertsView } from './components/ErrorScanAlertsView';
import { DocModal } from './components/DocModal';
import { SupportModal } from './components/SupportModal';

import {
  listRules,
  createRule,
  updateRule,
  deleteRule,
  enableRule,
  disableRule,
  setToken,
  hasToken,
  listErrorScanRules,
  createErrorScanRule,
  deleteErrorScanRule,
  toggleErrorScanAlert,
  toggleErrorScanSuppressed,
  updateErrorScanFeishu,
  bulkUpdateErrorScanFeishu,
  updateErrorScanGranularity,
  updateErrorScanThresholdExcludes,
} from './api/rules';
import { AlertRule, ApiKey, AlertLog, MainTab, HeaderSubTab, ErrorScanCategory } from './types';
import LoginPage from './components/LoginPage';

export default function App() {
  const [authenticated, setAuthenticated] = useState(hasToken());
  const [activeMainTab, setActiveMainTab] = useState<MainTab>(() => {
    const saved = localStorage.getItem('activeMainTab');
    return (saved as MainTab) || 'alert-rules';
  });
  const [headerSubTab, setHeaderSubTab] = useState<HeaderSubTab>('Rules');
  const [searchQuery, setSearchQuery] = useState('');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Rules from API
  const [rules, setRules] = useState<AlertRule[]>([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState('');

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [logs, setLogs] = useState<AlertLog[]>([]);

  // Error Scan Categories state
  const [errorScanCategories, setErrorScanCategories] = useState<ErrorScanCategory[]>([]);

  // Modal Control States
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);
  const [testingRule, setTestingRule] = useState<AlertRule | null>(null);
  const [isDocsOpen, setIsDocsOpen] = useState(false);
  const [isSupportOpen, setIsSupportOpen] = useState(false);

  // Toast Banner State
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Dark mode (global)
  const [darkMode, setDarkMode] = useState(false);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3500);
  };

  const handleLogin = (token: string) => {
    setToken(token);
    setAuthenticated(true);
  };

  // Load rules from API on mount（hooks 必须在条件 return 之前）
  const loadRules = useCallback(async () => {
    try {
      setRulesError('');
      const data = await listRules();
      setRules(data);
    } catch (err: any) {
      setRulesError(err.message);
    } finally {
      setRulesLoading(false);
    }
  }, []);

  const loadErrorScanRules = useCallback(async () => {
    try {
      const data = await listErrorScanRules();
      setErrorScanCategories(data);
    } catch {
      // 静默降级
    }
  }, []);

  useEffect(() => {
    if (authenticated) {
      loadRules();
      loadErrorScanRules();
    }
  }, [loadRules, loadErrorScanRules, authenticated]);

  // Sync dark mode to body
  useEffect(() => {
    document.body.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  if (!authenticated) {
    return <LoginPage onLogin={handleLogin} />;
  }

  // Rule Actions (via API)
  const handleToggleRule = async (ruleId: string) => {
    const rule = rules.find((r) => r.id === ruleId);
    if (!rule) return;
    try {
      if (rule.enabled) {
        await disableRule(ruleId);
      } else {
        await enableRule(ruleId);
      }
      showToast(`Rule "${rule.name}" ${rule.enabled ? 'disabled' : 'enabled'}.`);
      await loadRules();
    } catch (err: any) {
      showToast(`Failed: ${err.message}`);
    }
  };

  const handleSaveRule = async (
    ruleData: Omit<AlertRule, 'id' | 'createdAt' | 'triggerCount'> & { id?: string }
  ) => {
    try {
      if (ruleData.id) {
        await updateRule(ruleData.id, ruleData);
        showToast(`Rule "${ruleData.name}" updated.`);
      } else {
        await createRule(ruleData);
        showToast(`Rule "${ruleData.name}" created.`);
      }
      setEditingRule(null);
      await loadRules();
    } catch (err: any) {
      showToast(`Failed: ${err.message}`);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    try {
      await deleteRule(ruleId);
      showToast('Rule deleted.');
      await loadRules();
    } catch (err: any) {
      showToast(`Failed: ${err.message}`);
    }
  };

  const handleDuplicateRule = (rule: AlertRule) => {
    handleSaveRule({
      name: `${rule.name} (Copy)`,
      type: rule.type,
      enabled: rule.enabled,
      channel: rule.channel,
      model: rule.model,
      windowSeconds: rule.windowSeconds,
      thresholdValue: rule.thresholdValue,
      thresholdNumber: rule.thresholdNumber,
      pattern: rule.pattern,
      webhookUrl: rule.webhookUrl,
      description: rule.description,
      cooldownSeconds: rule.cooldownSeconds,
      lastTriggered: '从未触发',
    });
  };

  const handleSimulateTriggerLog = (rule: AlertRule, matchedContent: string) => {
    const newLog: AlertLog = {
      id: `log-${Date.now()}`,
      timestamp: new Date().toISOString().replace('T', ' ').substring(0, 19),
      ruleId: rule.id,
      ruleName: rule.name,
      type: rule.type,
      channel: rule.channel,
      model: rule.model,
      matchedContent,
      status: 'delivered',
      webhookResponseCode: 200,
      latencyMs: Math.floor(Math.random() * 150) + 50,
    };
    setLogs((prev) => [newLog, ...prev]);
    showToast(`Triggered "${rule.name}" & sent alert payload to webhook!`);
  };

  // ── Error Scan Category Handlers ──

  const handleToggleErrorScanAlert = async (id: string) => {
    try {
      await toggleErrorScanAlert(id);
      await loadErrorScanRules();
      showToast('告警状态已切换');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`);
    }
  };

  const handleToggleErrorScanSuppressed = async (id: string) => {
    try {
      await toggleErrorScanSuppressed(id);
      await loadErrorScanRules();
      showToast('误报标记已切换');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`);
    }
  };

  const handleUpdateErrorScanGranularity = async (
    id: string,
    scanGranularity: import('./types').ScanGranularity,
    alertGranularity: import('./types').AlertGranularity
  ) => {
    try {
      await updateErrorScanGranularity(id, scanGranularity, alertGranularity);
      await loadErrorScanRules();
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`);
    }
  };

  const handleAddScanCategory = async (category: Omit<ErrorScanCategory, 'id' | 'lastScannedTime'>) => {
    try {
      await createErrorScanRule(category);
      await loadErrorScanRules();
      showToast(`已成功添加错误扫描分类: "${category.name}"`);
    } catch (err: any) {
      showToast(`添加失败: ${err.message}`);
    }
  };

  const handleUpdateFeishuWebhookUrl = async (id: string, url: string) => {
    try {
      await updateErrorScanFeishu(id, url);
      await loadErrorScanRules();
      showToast('飞书地址已更新');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`);
    }
  };

  const handleBulkUpdateFeishuWebhookUrl = async (url: string) => {
    try {
      await bulkUpdateErrorScanFeishu(url);
      await loadErrorScanRules();
      showToast(`已成功同步覆盖全量规则的飞书地址`);
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`);
    }
  };

  const handleDeleteScanCategory = async (id: string) => {
    try {
      await deleteErrorScanRule(id);
      await loadErrorScanRules();
      showToast('规则已删除');
    } catch (err: any) {
      showToast(`删除失败: ${err.message}`);
    }
  };

  const handleUpdateThresholdExcludes = async (
    id: string,
    alertThreshold: number,
    excludeChannels: string,
    excludeUsers: string,
    filterMode: string
  ) => {
    try {
      await updateErrorScanThresholdExcludes(id, alertThreshold, excludeChannels, excludeUsers, filterMode);
      await loadErrorScanRules();
      showToast('阈值与排除列表已更新');
    } catch (err: any) {
      showToast(`操作失败: ${err.message}`);
    }
  };

  // Notification / API Key actions kept as no-ops (no backend)
  const handleGenerateKey = () => showToast('API Key management coming soon.');
  const handleRevokeKey = () => showToast('API Key management coming soon.');

  const renderMainContent = () => {
    if (activeMainTab === 'dashboard') {
      return (
        <DashboardView
          rules={rules}
          onNavigate={(mTab, sTab) => {
            setActiveMainTab(mTab);
            if (sTab) setHeaderSubTab(sTab);
          }}
          onCreateRule={() => {
            setEditingRule(null);
            setIsCreateModalOpen(true);
          }}
        />
      );
    }

    if (activeMainTab === 'error-scan') {
      return (
        <ErrorScanAlertsView
          categories={errorScanCategories}
          onToggleAlertEnabled={handleToggleErrorScanAlert}
          onToggleSuppressed={handleToggleErrorScanSuppressed}
          onUpdateGranularity={handleUpdateErrorScanGranularity}
          onUpdateThresholdExcludes={handleUpdateThresholdExcludes}
          onAddScanCategory={handleAddScanCategory}
          onDeleteScanCategory={handleDeleteScanCategory}
          onUpdateFeishuWebhookUrl={handleUpdateFeishuWebhookUrl}
          onBulkUpdateFeishuWebhookUrl={handleBulkUpdateFeishuWebhookUrl}
          onShowToast={showToast}
        />
      );
    }

    if (activeMainTab === 'notification-channels') {
      return <NotificationChannelsView rules={rules} />;
    }

    if (activeMainTab === 'api-keys') {
      return (
        <ApiKeysView
          apiKeys={apiKeys}
          onGenerateKey={handleGenerateKey}
          onRevokeKey={handleRevokeKey}
        />
      );
    }

    if (headerSubTab === 'Monitoring') return <MonitoringView />;
    if (headerSubTab === 'Logs') return <LogsView logs={logs} />;
    if (headerSubTab === 'Settings') return <SettingsView />;

    return (
      <AlertRulesView
        rules={rules}
        searchQuery={searchQuery}
        onToggleRule={handleToggleRule}
        onEditRule={(rule) => {
          setEditingRule(rule);
          setIsCreateModalOpen(true);
        }}
        onDeleteRule={handleDeleteRule}
        onDuplicateRule={handleDuplicateRule}
        onTestRule={(rule) => setTestingRule(rule)}
        onCreateRule={() => {
          setEditingRule(null);
          setIsCreateModalOpen(true);
        }}
      />
    );
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[#f7f9fb]" data-theme={darkMode ? 'dark' : 'light'}>
      <style>{`
        [data-theme='light'] {
          --bg-page: #f5f6f8;
          --bg-card: #ffffff;
          --bg-card-alt: #f7f9fb;
          --bg-card-hover: #f2f4f6;
          --bg-input: #ffffff;
          --bg-header: #f2f4f6;
          --bg-tag: #e0e3e5;
          --bg-badge: #d0e1fb;
          --bg-success: #e6f4ea;
          --bg-warning: #fff3e0;
          --bg-danger: #ffe0e0;
          --bg-highlight: #f0f0ff;
          --text-primary: #191c1e;
          --text-secondary: #434655;
          --text-muted: #737686;
          --text-subtle: #80848f;
          --text-link: #004ac6;
          --text-success: #006242;
          --text-warning: #e65100;
          --text-danger: #c62828;
          --border-primary: #c3c6d7;
          --border-secondary: #e0e3e5;
          --border-accent: #b4c5ff;
          --accent: #004ac6;
          --accent-light: #d0e1fb;
          --scrollbar-thumb: #c3c6d7;
          --scrollbar-track: transparent;
        }
        [data-theme='dark'] {
          --bg-page: #0f0f1a;
          --bg-card: #1a1a2e;
          --bg-card-alt: #1e1e32;
          --bg-card-hover: #252540;
          --bg-input: #252540;
          --bg-header: #1a1a2e;
          --bg-tag: #2a2a40;
          --bg-badge: #1a2a4a;
          --bg-success: #1a3a2a;
          --bg-warning: #3a2a1a;
          --bg-danger: #3a1a1a;
          --bg-highlight: #1a1a3a;
          --text-primary: #e0e0e0;
          --text-secondary: #b0b0c0;
          --text-muted: #8888a0;
          --text-subtle: #707088;
          --text-link: #6aadff;
          --text-success: #4caf50;
          --text-warning: #ff9800;
          --text-danger: #ef5350;
          --border-primary: #2a2a40;
          --border-secondary: #1e1e32;
          --border-accent: #2a3a5a;
          --accent: #5b9bff;
          --accent-light: #1a2a4a;
          --scrollbar-thumb: #3a3a50;
          --scrollbar-track: #1a1a2e;
        }
        [data-theme='dark'] .bg-white { background-color: var(--bg-card) !important; }
        [data-theme='dark'] .bg-\\[\\#f7f9fb\\], [data-theme='dark'] .bg-\\[\\#f8f9fc\\] { background-color: var(--bg-card-alt) !important; }
        [data-theme='dark'] .bg-\\[\\#f2f4f6\\], [data-theme='dark'] .bg-\\[\\#fafafa\\] { background-color: var(--bg-header) !important; }
        [data-theme='dark'] .bg-\\[\\#e0e3e5\\] { background-color: var(--bg-tag) !important; }
        [data-theme='dark'] .bg-\\[\\#d0e1fb\\] { background-color: var(--bg-badge) !important; }
        [data-theme='dark'] .bg-\\[\\#f0f0ff\\],[data-theme='dark'] .bg-\\[\\#eeefff\\],[data-theme='dark'] .bg-\\[\\#f4f7ff\\] { background-color: var(--bg-highlight) !important; }
        [data-theme='dark'] .text-\\[\\#191c1e\\],[data-theme='dark'] .text-\\[\\#1c1e2b\\] { color: var(--text-primary) !important; }
        [data-theme='dark'] .text-\\[\\#434655\\] { color: var(--text-secondary) !important; }
        [data-theme='dark'] .text-\\[\\#737686\\],[data-theme='dark'] .text-\\[\\#80848f\\] { color: var(--text-muted) !important; }
        [data-theme='dark'] .text-\\[\\#004ac6\\] { color: var(--text-link) !important; }
        [data-theme='dark'] .text-\\[\\#006242\\],[data-theme='dark'] .text-emerald-600,[data-theme='dark'] .text-emerald-700 { color: var(--text-success) !important; }
        [data-theme='dark'] .text-\\[\\#e65100\\],[data-theme='dark'] .text-amber-600,[data-theme='dark'] .text-amber-700,[data-theme='dark'] .text-amber-800 { color: var(--text-warning) !important; }
        [data-theme='dark'] .text-\\[\\#c62828\\] { color: var(--text-danger) !important; }
        [data-theme='dark'] .border-\\[\\#c3c6d7\\] { border-color: var(--border-primary) !important; }
        [data-theme='dark'] .border-\\[\\#e0e3e5\\] { border-color: var(--border-secondary) !important; }
        [data-theme='dark'] .border-\\[\\#b4c5ff\\] { border-color: var(--border-accent) !important; }
        [data-theme='dark'] .bg-\\[\\#004ac6\\] { background-color: var(--accent) !important; }
        [data-theme='dark'] .from-\\[\\#f7f9fc\\] { --tw-gradient-from: var(--bg-card-alt); }
        [data-theme='dark'] .bg-\\[\\#1e1e1e\\] { background-color: #0d0d1a !important; }
        [data-theme='dark'] .text-\\[\\#d4d4d4\\] { color: #c0c0d0 !important; }
        [data-theme='dark'] .bg-gradient-to-r { background-image: none !important; }
        [data-theme='dark'] .shadow-2xs { box-shadow: 0 1px 2px rgba(0,0,0,0.3) !important; }
        [data-theme='dark'] .hover\\:bg-\\[\\#f7f9fb\\]:hover { background-color: var(--bg-card-hover) !important; }
        [data-theme='dark'] .hover\\:bg-\\[\\#f2f4f6\\]:hover { background-color: var(--bg-card-hover) !important; }
        [data-theme='dark'] .hover\\:bg-\\[\\#e0e3e5\\]:hover { background-color: #3a3a50 !important; }
        [data-theme='dark'] .hover\\:bg-\\[\\#e6e6ff\\]:hover,[data-theme='dark'] .hover\\:bg-\\[\\#eeefff\\]:hover { background-color: var(--bg-highlight) !important; }
        [data-theme='dark'] .hover\\:bg-amber-50:hover { background-color: var(--bg-warning) !important; }
        [data-theme='dark'] .hover\\:bg-\\[\\#d0e1fb\\]:hover { background-color: var(--bg-badge) !important; }
        [data-theme='dark'] .hover\\:bg-\\[\\#ffe0e0\\]:hover { background-color: var(--bg-danger) !important; }
        [data-theme='dark'] .hover\\:text-\\[\\#191c1e\\]:hover { color: var(--text-primary) !important; }
        [data-theme='dark'] .hover\\:text-\\[\\#1c1e2b\\]:hover,[data-theme='dark'] .hover\\:text-\\[\\#004ac6\\]:hover { color: var(--text-link) !important; }
        [data-theme='dark'] .hover\\:text-\\[\\#c62828\\]:hover { color: var(--text-danger) !important; }
        [data-theme='dark'] .hover\\:border-\\[\\#b4c5ff\\]:hover { border-color: var(--border-accent) !important; }
        [data-theme='dark'] .divide-\\[\\#e0e3e5\\] > * + * { border-color: var(--border-secondary) !important; }
        [data-theme='dark'] ::-webkit-scrollbar-thumb { background-color: var(--scrollbar-thumb); }
        [data-theme='dark'] ::-webkit-scrollbar-track { background-color: var(--scrollbar-track); }
        [data-theme='dark'] body { background-color: var(--bg-page); }
        [data-theme='dark'] .bg-amber-500 { background-color: #d97706 !important; }
        [data-theme='dark'] .bg-amber-500:hover { background-color: #b45309 !important; }
        [data-theme='dark'] .border-amber-300 { border-color: #5a4a20 !important; }
        [data-theme='dark'] .bg-\\[\\#e6f4ea\\] { background-color: var(--bg-success) !important; }
        [data-theme='dark'] .bg-\\[\\#fff3e0\\],[data-theme='dark'] .bg-amber-50 { background-color: var(--bg-warning) !important; }
        [data-theme='dark'] .bg-\\[\\#ffe0e0\\] { background-color: var(--bg-danger) !important; }
        [data-theme='dark'] .text-\\[\\#003ea8\\] { color: var(--text-link) !important; }
        [data-theme='dark'] .bg-\\[\\#eceef0\\] { background-color: #2a2a40 !important; }
        [data-theme='dark'] .bg-\\[\\#e6e8ea\\] { background-color: #2a2a40 !important; }
        [data-theme='dark'] select {
          color: var(--text-primary) !important;
          background-color: var(--bg-card) !important;
          border-color: var(--border-primary) !important;
        }
        [data-theme='dark'] select option {
          background-color: var(--bg-card) !important;
          color: var(--text-primary) !important;
        }
        [data-theme='dark'] input:not([type="button"]):not([type="submit"]),
        [data-theme='dark'] textarea {
          color: var(--text-primary) !important;
          background-color: var(--bg-input) !important;
          border-color: var(--border-primary) !important;
        }
        [data-theme='dark'] input::placeholder,
        [data-theme='dark'] textarea::placeholder {
          color: var(--text-muted) !important;
        }
        body { background-color: var(--bg-page); transition: background-color 0.3s, color 0.3s; }
        * { transition: background-color 0.2s, border-color 0.2s, color 0.2s; }
      `}</style>
      {toastMessage && (
        <div className="fixed top-4 right-4 z-50 bg-[#191c1e] text-white px-4 py-2.5 rounded-xl shadow-2xl text-[13px] font-semibold flex items-center gap-2 border border-[#737686] animate-scale-in">
          <span className="material-symbols-outlined text-[18px] text-[#bdffdb]">
            notifications_active
          </span>
          <span>{toastMessage}</span>
        </div>
      )}

      <Sidebar
        activeTab={activeMainTab}
        setActiveTab={(tab) => {
          setActiveMainTab(tab);
          localStorage.setItem('activeMainTab', tab);
          if (tab === 'alert-rules') setHeaderSubTab('Rules');
        }}
        onOpenDocs={() => setIsDocsOpen(true)}
        onOpenSupport={() => setIsSupportOpen(true)}
        isMobileOpen={isMobileSidebarOpen}
        setIsMobileOpen={setIsMobileSidebarOpen}
      />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TopHeader
          currentSubTab={headerSubTab}
          setSubTab={(tab) => {
            setActiveMainTab('alert-rules');
            setHeaderSubTab(tab);
          }}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
          onCreateRule={() => {
            setEditingRule(null);
            setIsCreateModalOpen(true);
          }}
          onToggleMobileSidebar={() => setIsMobileSidebarOpen(!isMobileSidebarOpen)}
          darkMode={darkMode}
          setDarkMode={setDarkMode}
        />

        <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth">
          <div className="max-w-[1440px] mx-auto">
            {rulesLoading && activeMainTab === 'alert-rules' ? (
              <div className="text-center py-20 text-[#434655] text-[14px]">Loading rules...</div>
            ) : (
              renderMainContent()
            )}
          </div>
        </main>
      </div>

      <CreateRuleModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
          setEditingRule(null);
        }}
        onSave={handleSaveRule}
        initialRule={editingRule}
        channels={[]}
      />

      <TestRuleModal
        rule={testingRule}
        onClose={() => setTestingRule(null)}
        onTriggerSimulatedLog={handleSimulateTriggerLog}
      />

      <DocModal isOpen={isDocsOpen} onClose={() => setIsDocsOpen(false)} />
      <SupportModal isOpen={isSupportOpen} onClose={() => setIsSupportOpen(false)} />
    </div>
  );
}
