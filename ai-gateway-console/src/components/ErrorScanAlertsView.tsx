import React, { useState, useEffect } from 'react';
import {
  ErrorScanCategory,
  ErrorScanCategoryType,
  ScanGranularity,
  AlertGranularity,
  RawGatewayLog,
} from '../types';
import {
  getErrorScanPollInterval,
  setErrorScanPollInterval,
  testErrorScanWebhook,
  getRecentErrorSamples,
  getOverviewStats,
  getUnmatchedSamples,
  createRuleFromSample,
  getFallbackConfig,
  setFallbackConfig,
  getGroupedStats,
  getGroupedSamples,
  classifyLog,
  listClassifyRules,
  createClassifyRule,
  updateClassifyRule,
  deleteClassifyRule,
} from '../api/rules';
import type {
  ErrorSampleItem,
  OverviewStats,
  UnmatchedSample,
  GroupedStatItem,
  GroupedErrorDetail,
  ClassifyResult,
  ClassifyRule,
} from '../api/rules';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';

interface ErrorScanAlertsViewProps {
  categories: ErrorScanCategory[];
  onToggleAlertEnabled: (id: string) => void;
  onToggleSuppressed: (id: string) => void;
  onUpdateGranularity: (
    id: string,
    scanGranularity: ScanGranularity,
    alertGranularity: AlertGranularity
  ) => void;
  onUpdateThresholdExcludes: (
    id: string,
    alertThreshold: number,
    excludeChannels: string,
    excludeUsers: string,
    filterMode: string
  ) => void;
  onAddScanCategory: (category: Omit<ErrorScanCategory, 'id' | 'lastScannedTime'>) => void;
  onDeleteScanCategory: (id: string) => void;
  onUpdateFeishuWebhookUrl?: (id: string, url: string) => void;
  onBulkUpdateFeishuWebhookUrl?: (url: string) => void;
  onShowToast: (msg: string) => void;
  onSyncScanCategoryFromClassify?: (patternKeyword: string, updates: { subCategory?: string; category?: string; statusCode?: number }) => void;
}

// Preset User Example Logs from prompt for immediate testing
const SAMPLE_USER_LOGS: { label: string; log: RawGatewayLog }[] = [
  {
    label: '示例 1: HTTP 500 模型上游容量超载 (Overloaded)',
    log: {
      id: 203582,
      user_id: 31,
      created_at: 1785912598,
      type: 5,
      content: 'status_code=500, Overloaded',
      username: 'tokenturbo-mvp',
      token_name: 'mvp',
      model_name: 'claude-opus-5',
      quota: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      use_time: 27,
      is_stream: true,
      channel: 9,
      channel_name: 'flatkey-an-claude',
      token_id: 36,
      group: 'ks-mvp-claude',
      ip: '',
      request_id: '202608050649313110541788268d9d6eFmCk5wX',
      upstream_request_id: '202608050649321033386358268d9d6KrWC6NtP',
      other: '{"admin_info":{"use_channel":["9"]},"channel_id":9,"channel_name":"flatkey-an-claude","channel_type":14,"error_code":"unknown_error","error_type":"openai_error","request_path":"/v1/messages","status_code":500}',
    },
  },
  {
    label: '示例 2: HTTP 400 工具调用 ID 未匹配 (unexpected tool_use_id)',
    log: {
      id: 203501,
      user_id: 26,
      created_at: 1785912427,
      type: 5,
      content: 'status_code=400, ***.***.content.0: unexpected `tool_use_id` found in `tool_result` blocks: toolu_0189tZcD9zzqoRnVE4i2sKES. Each `tool_result` block must have a corresponding `tool_use` block in the previous message. (request id: 202608050647019244685618268d9d6tR5y5hqk)',
      username: 'tenzen',
      token_name: 'an-claude',
      model_name: 'claude-sonnet-4-6',
      quota: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      use_time: 6,
      is_stream: true,
      channel: 30,
      channel_name: 'rocket-an-claude',
      token_id: 29,
      group: 'tz-an-claude',
      ip: '',
      request_id: '202608050647004926332418268d9d6ktYJ6XT8',
      upstream_request_id: '202608050647007312314858268d9d6VPvi226W',
      other: '{"admin_info":{"use_channel":["30"]},"channel_id":30,"channel_name":"rocket-an-claude","channel_type":14,"error_code":"unknown_error","error_type":"openai_error","request_path":"/v1/messages","status_code":400}',
    },
  },
  {
    label: '示例 3: HTTP 400 消息 Text 内容块为空 (text content blocks must be non-empty)',
    log: {
      id: 203486,
      user_id: 26,
      created_at: 1785912392,
      type: 5,
      content: 'status_code=400, messages: text content blocks must be non-empty (request id: 202608050646317898889738268d9d6HG1D4Ukv)',
      username: 'tenzen',
      token_name: 'an-claude',
      model_name: 'claude-sonnet-4-6',
      quota: 0,
      prompt_tokens: 0,
      completion_tokens: 0,
      use_time: 0,
      is_stream: true,
      channel: 9,
      channel_name: 'flatkey-an-claude',
      token_id: 29,
      group: 'tz-an-claude',
      ip: '',
      request_id: '202608050646315969550648268d9d6xIRe8lVs',
      upstream_request_id: '202608050646317898889738268d9d6HG1D4Ukv',
      other: '{"admin_info":{"use_channel":["9"]},"channel_id":9,"channel_name":"flatkey-an-claude","channel_type":14,"error_code":"unknown_error","error_type":"openai_error","request_path":"/v1/messages","status_code":400}',
    },
  },
];

export const ErrorScanAlertsView: React.FC<ErrorScanAlertsViewProps> = ({
  categories,
  onToggleAlertEnabled,
  onToggleSuppressed,
  onUpdateGranularity,
  onUpdateThresholdExcludes,
  onAddScanCategory,
  onDeleteScanCategory,
  onUpdateFeishuWebhookUrl,
  onBulkUpdateFeishuWebhookUrl,
  onShowToast,
  onSyncScanCategoryFromClassify,
}) => {
  // Global View Controls
  const [globalScanGranularity, setGlobalScanGranularity] = useState<ScanGranularity>('小时 (Hourly)');
  const [globalAlertGranularity, setGlobalAlertGranularity] = useState<AlertGranularity>('按错误精细类型');
  const [minAlertThreshold, setMinAlertThreshold] = useState<number>(5);
  const [globalFeishuUrl, setGlobalFeishuUrl] = useState<string>(
    'https://open.feishu.cn/open-apis/bot/v2/hook/4a89bc21-09df-41ef-bc82-9011abf88123'
  );

  // Feishu Webhook Rule Edit Modal State
  const [editingFeishuCategory, setEditingFeishuCategory] = useState<ErrorScanCategory | null>(null);
  const [editingFeishuUrlInput, setEditingFeishuUrlInput] = useState<string>('');

  // Filter States
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'alerting' | 'suppressed' | 'disabled'>('all');

  // Tab navigation
  const [activeTab, setActiveTab] = useState<'dashboard' | 'classify' | 'alert'>('dashboard');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isScanning, setIsScanning] = useState<boolean>(false);

  // Modal / Drawer States
  const [inspectingCategory, setInspectingCategory] = useState<ErrorScanCategory | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState<boolean>(false);
  const [showLogTester, setShowLogTester] = useState<boolean>(true);

  // Error samples state
  const [errorSamples, setErrorSamples] = useState<ErrorSampleItem[]>([]);
  const [showSamplesPanel, setShowSamplesPanel] = useState(false);
  const [samplesLoading, setSamplesLoading] = useState(false);

  // Grouped stats state
  const [groupedStats, setGroupedStats] = useState<GroupedStatItem[]>([]);
  const [groupDimension, setGroupDimension] = useState('channel');
  const [groupWindow, setGroupWindow] = useState(1);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [groupDetails, setGroupDetails] = useState<Record<string, GroupedErrorDetail[]>>({});
  const [groupDetailsLoading, setGroupDetailsLoading] = useState<Set<string>>(new Set());
  const [detailModalItem, setDetailModalItem] = useState<GroupedErrorDetail | null>(null);

  // Exclude edit state
  const [editingExcludes, setEditingExcludes] = useState<ErrorScanCategory | null>(null);
  const [excludeChannelsInput, setExcludeChannelsInput] = useState('');
  const [excludeUsersInput, setExcludeUsersInput] = useState('');
  const [filterModeInput, setFilterModeInput] = useState('exclude');
  const [thresholdInput, setThresholdInput] = useState(10);

  // Poll interval state
  const [pollIntervalSeconds, setPollIntervalSeconds] = useState(300);

  // Overview stats state
  const [overviewStats, setOverviewStats] = useState<OverviewStats | null>(null);
  const [overviewWindow, setOverviewWindow] = useState(1);

  // Unmatched samples state
  const [unmatchedSamples, setUnmatchedSamples] = useState<UnmatchedSample[]>([]);
  const [showUnmatchedPanel, setShowUnmatchedPanel] = useState(false);
  const [unmatchedLoading, setUnmatchedLoading] = useState(false);

  // Sample-to-rule conversion form state
  const [convertingSample, setConvertingSample] = useState<UnmatchedSample | null>(null);
  const [convertCode, setConvertCode] = useState('');
  const [convertName, setConvertName] = useState('');
  const [convertCategory, setConvertCategory] = useState('400 参数格式错误');

  // Fallback alert config state
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [fallbackWebhook, setFallbackWebhook] = useState('');

  // Classify rules management state
  const [classifyRules, setClassifyRules] = useState<ClassifyRule[]>([]);
  const [newClassifyKeyword, setNewClassifyKeyword] = useState('');
  const [newClassifyStatusCode, setNewClassifyStatusCode] = useState(0);
  const [newClassifyCategory, setNewClassifyCategory] = useState('5xx 服务器错误');
  const [newClassifySubCategory, setNewClassifySubCategory] = useState('');
  const [newClassifyRecommendation, setNewClassifyRecommendation] = useState('');
  const [newClassifyPriority, setNewClassifyPriority] = useState(50);
  const [editingClassifyRule, setEditingClassifyRule] = useState<ClassifyRule | null>(null);
  const [selectedRuleIds, setSelectedRuleIds] = useState<Set<string>>(new Set());

  // 兼容非 HTTPS 环境的复制到剪贴板
  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).catch(() => {
        // fallback below
        fallbackCopy(text);
      });
    } else {
      fallbackCopy(text);
    }
  };
  const fallbackCopy = (text: string) => {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  };

  useEffect(() => {
    getErrorScanPollInterval().then(setPollIntervalSeconds).catch(() => {});
  }, []);

  // Load overview stats
  const loadOverviewStats = () => {
    getOverviewStats(overviewWindow)
      .then(setOverviewStats)
      .catch((err) => {
        onShowToast(`概览数据加载失败: ${err.message}`);
        setOverviewStats(null);
      });
  };

  useEffect(() => {
    loadOverviewStats();
  }, []);

  // Reload overview when categories change (after create/delete rules)
  useEffect(() => {
    loadOverviewStats();
    loadGroupedStats();
  }, [categories.length]);

  // Reload overview when window changes
  useEffect(() => {
    loadOverviewStats();
  }, [overviewWindow]);

  // Load grouped stats
  const loadGroupedStats = () => {
    getGroupedStats(groupDimension, groupWindow)
      .then(setGroupedStats)
      .catch(() => {});
  };

  useEffect(() => {
    loadGroupedStats();
    setExpandedGroups(new Set());
    setGroupDetails({});
  }, [groupDimension, groupWindow]);

  // Load fallback config on mount
  useEffect(() => {
    getFallbackConfig()
      .then((cfg) => {
        setFallbackEnabled(cfg.enabled);
        setFallbackWebhook(cfg.webhook || '');
      })
      .catch(() => {});
  }, []);

  // Load classify rules
  const loadClassifyRules = () => {
    listClassifyRules().then(setClassifyRules).catch(() => {});
  };

  // Auto-load classify rules when tab becomes active
  useEffect(() => {
    if (activeTab === 'classify') {
      loadClassifyRules();
    }
  }, [activeTab]);

  const handleAddClassifyRule = async () => {
    if (!newClassifyKeyword || !newClassifySubCategory) {
      onShowToast('关键词和子分类不能为空');
      return;
    }
    // 检查关键词是否已存在
    const keywordLower = newClassifyKeyword.trim().toLowerCase();
    if (classifyRules.some((r) => r.keyword.toLowerCase() === keywordLower)) {
      onShowToast(`关键词「${newClassifyKeyword.trim()}」已存在，每个关键词只能有一个分类规则`);
      return;
    }
    try {
      await createClassifyRule({
        keyword: newClassifyKeyword.trim(),
        status_code: newClassifyStatusCode,
        category: newClassifyCategory,
        sub_category: newClassifySubCategory,
        recommendation: newClassifyRecommendation,
        priority: newClassifyPriority,
      });
      setNewClassifyKeyword('');
      setNewClassifyStatusCode(0);
      setNewClassifySubCategory('');
      setNewClassifyRecommendation('');
      setNewClassifyPriority(50);
      onShowToast('分类规则添加成功');
      loadClassifyRules();
    } catch (e: any) {
      onShowToast(`添加失败: ${e.message}`);
    }
  };

  const handleDeleteClassifyRule = async (id: number) => {
    try {
      await deleteClassifyRule(id);
      onShowToast('已删除');
      loadClassifyRules();
    } catch (e: any) {
      onShowToast(`删除失败: ${e.message}`);
    }
  };

  const handleUpdateClassifyRule = async () => {
    if (!editingClassifyRule) return;
    // 检查修改后的关键词是否与其他规则冲突（排除自身）
    const keywordLower = editingClassifyRule.keyword.trim().toLowerCase();
    if (classifyRules.some(
      (r) => r.id !== editingClassifyRule.id && r.keyword.toLowerCase() === keywordLower
    )) {
      onShowToast(`关键词「${editingClassifyRule.keyword.trim()}」已存在，每个关键词只能有一个分类规则`);
      return;
    }
    try {
      await updateClassifyRule(editingClassifyRule.id, {
        keyword: editingClassifyRule.keyword.trim(),
        status_code: editingClassifyRule.status_code,
        category: editingClassifyRule.category,
        sub_category: editingClassifyRule.sub_category,
        recommendation: editingClassifyRule.recommendation,
        priority: editingClassifyRule.priority,
      });
      // 同步更新关联的精细化规则
      if (onSyncScanCategoryFromClassify) {
        onSyncScanCategoryFromClassify(editingClassifyRule.keyword.trim(), {
          subCategory: editingClassifyRule.sub_category,
          category: editingClassifyRule.category,
          statusCode: editingClassifyRule.status_code,
        });
      }
      setEditingClassifyRule(null);
      onShowToast('分类规则已更新，已同步关联的精细化规则');
      loadClassifyRules();
    } catch (e: any) {
      onShowToast(`更新失败: ${e.message}`);
    }
  };

  // 快捷 Webhook 预设（localStorage 持久化）
  const [savedWebhooks, setSavedWebhooks] = useState<{ label: string; url: string }[]>(() => {
    try {
      const saved = localStorage.getItem('errorScanWebhookPresets');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const saveWebhookPreset = (label: string, url: string) => {
    if (!label || !url) return;
    const updated = [...savedWebhooks.filter(w => w.url !== url), { label, url }];
    setSavedWebhooks(updated);
    localStorage.setItem('errorScanWebhookPresets', JSON.stringify(updated));
    onShowToast(`已保存快捷 Webhook: ${label}`);
  };

  const removeWebhookPreset = (url: string) => {
    const updated = savedWebhooks.filter(w => w.url !== url);
    setSavedWebhooks(updated);
    localStorage.setItem('errorScanWebhookPresets', JSON.stringify(updated));
  };

  // Tester State
  const [testInputJson, setTestInputJson] = useState<string>(
    JSON.stringify(SAMPLE_USER_LOGS[1].log, null, 2)
  );
  const [analyzedResult, setAnalyzedResult] = useState<{
    mainCategory: string;
    subCategory: string;
    statusCode: number;
    keywordMatched: string;
    model: string;
    channel: string;
    username: string;
    group: string;
    requestPath: string;
    recommendation: string;
  } | null>(null);

  // Add Form States
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newSubCategory, setNewSubCategory] = useState('');
  const [newCategory, setNewCategory] = useState<ErrorScanCategoryType>('400 参数格式错误');
  const [newModel, setNewModel] = useState('claude-sonnet-4-6');
  const [newEndpoint, setNewEndpoint] = useState('/v1/messages');
  const [newSampleLog, setNewSampleLog] = useState('');
  const [newFeishuUrl, setNewFeishuUrl] = useState('');
  const [newSeverity, setNewSeverity] = useState<'critical' | 'warning' | 'info'>('warning');

  // Handle Manual Scan Trigger
  const handleTriggerManualScan = () => {
    setIsScanning(true);
    setTimeout(() => {
      setIsScanning(false);
      onShowToast(`日志分类扫描完成！成功检测并提炼 ${categories.length} 类精细化错误规则。`);
    }, 1000);
  };

  // Run Realtime Log Analyzer
  const handleAnalyzeCustomLog = async (customJsonStr?: string) => {
    const textToAnalyze = (customJsonStr || testInputJson).trim();
    try {
      let content: string;
      let other = '';
      let model_name = '';
      let channel_name = '';
      let username = '';
      let group = '';

      if (textToAnalyze.startsWith('{')) {
        // JSON 模式
        const parsedLog = JSON.parse(textToAnalyze) as RawGatewayLog;
        content = parsedLog.content || '';
        other = parsedLog.other || '';
        model_name = parsedLog.model_name || '';
        channel_name = parsedLog.channel_name || '';
        username = parsedLog.username || '';
        group = parsedLog.group || '';
      } else {
        // 纯文本模式：直接作为 content
        content = textToAnalyze;
      }

      const result = await classifyLog({
        content,
        other,
        model_name,
        channel_name,
        username,
        group,
      });

      setAnalyzedResult({
        mainCategory: result.category,
        subCategory: result.sub_category,
        statusCode: result.status_code,
        keywordMatched: result.keyword_matched,
        model: result.model,
        channel: result.channel,
        username: result.username,
        group: result.group,
        requestPath: '/v1/messages',
        recommendation: result.recommendation,
      });

      onShowToast(`分析完成：${result.sub_category}`);
    } catch {
      onShowToast('分析失败：无法解析日志或调用分类服务');
    }
  };

  // Directly Create Rule from Analyzer Result
  const handleCreateRuleFromAnalyzer = () => {
    if (!analyzedResult) return;

    let parsedLog: RawGatewayLog | undefined;
    try {
      parsedLog = JSON.parse(testInputJson) as RawGatewayLog;
    } catch {
      // fallback
    }

    const keywordSlug = analyzedResult.keywordMatched
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '_')
      .replace(/_+/g, '_')
      .slice(0, 18);
    const generatedCode = `ERR_${analyzedResult.statusCode}_${keywordSlug || 'CUSTOM'}`;

    if (categories.some((c) => c.code === generatedCode && c.topModel === analyzedResult.model && c.topChannel === analyzedResult.channel && c.topUser === analyzedResult.group)) {
      onShowToast(`规则提示：相同特征编码「${generatedCode}」已存在于相同模型/渠道/组组合下！`);
      return;
    }

    const ruleName = `${analyzedResult.subCategory.split('(')[0].trim()} 自动衍生规则`;

    const newRuleCategory: Omit<ErrorScanCategory, 'id' | 'lastScannedTime'> = {
      code: generatedCode,
      name: ruleName,
      category: analyzedResult.mainCategory as ErrorScanCategoryType,
      subCategory: analyzedResult.subCategory,
      statusCode: analyzedResult.statusCode,
      patternKeyword: analyzedResult.keywordMatched,
      topModel: analyzedResult.model,
      topChannel: analyzedResult.channel,
      topUser: analyzedResult.group,
      topEndpoint: analyzedResult.requestPath,
      hourlyErrorCount: 0,
      dailyErrorCount: 0,
      alertThreshold: minAlertThreshold,
      sampleLog: `status_code=${analyzedResult.statusCode}, ${analyzedResult.keywordMatched}`,
      isAlertEnabled: true,
      suppressed: false,
      scanGranularity: globalScanGranularity,
      alertGranularity: globalAlertGranularity,
      excludeChannels: '',
      excludeUsers: '',
      filterMode: 'exclude',
      severity: analyzedResult.statusCode >= 500 ? 'critical' : 'warning',
      feishuWebhookUrl: globalFeishuUrl,
      rawLogs: parsedLog ? [parsedLog] : [],
    };

    onAddScanCategory(newRuleCategory);

    // 同步创建分类规则，确保 classifyLog 能匹配该关键词
    createClassifyRule({
      keyword: analyzedResult.keywordMatched,
      status_code: analyzedResult.statusCode,
      category: analyzedResult.mainCategory,
      sub_category: analyzedResult.subCategory,
      recommendation: analyzedResult.recommendation || '',
      priority: 50,
    }).catch(() => {}); // 静默失败，分类规则可能已存在

    onShowToast(`⚡ 成功：已根据实时日志解析结果直接创建精细化规则「${ruleName}」！`);
  };

  // Load unmatched samples and open panel
  const handleOpenUnmatchedPanel = () => {
    setUnmatchedLoading(true);
    getUnmatchedSamples()
      .then((data) => {
        setUnmatchedSamples(data);
        setShowUnmatchedPanel(true);
      })
      .catch(() => onShowToast('获取未匹配样本失败'))
      .finally(() => setUnmatchedLoading(false));
  };

  // Open conversion form for a sample
  const handleOpenConvertForm = (sample: UnmatchedSample) => {
    // 从 content 中提取简短摘要
    let summary = (sample.content || '')
      .replace(/^status_code[=:]\s*/, '')        // 去掉开头的 status_code=
      .replace(/\s*\(request id:.*$/, '')         // 去掉 request id 后缀
      .replace(/,( request id:.*)?$/, '')         // 去掉逗号后的 request id
      .trim();
    // 截断过长摘要
    if (summary.length > 30) {
      summary = summary.slice(0, 30) + '...';
    }
    // 提取 HTTP 状态码
    const statusMatch = (sample.content || '').match(/status_code[=:]\s*(\d{3})/);
    const statusPrefix = statusMatch ? `${statusMatch[1]} ` : '';

    setConvertCode(`ERR_UNMATCHED_${sample.id}`);
    setConvertName(`${statusPrefix}[未匹配] ${summary || '未知错误'}`);
    setConvertCategory('400 参数格式错误');
    setConvertingSample(sample);
  };

  // Submit conversion from sample to rule
  const handleSubmitConvert = async () => {
    if (!convertingSample || !convertCode || !convertName) return;
    try {
      await createRuleFromSample({
        content: convertingSample.content,
        other: convertingSample.other,
        model_name: convertingSample.model_name,
        channel_name: convertingSample.channel_name,
        username: convertingSample.username,
        code: convertCode,
        name: convertName,
        category: convertCategory,
      });
      // 从 content 提取关键词，同步创建分类规则，确保后续扫描能匹配该错误
      let keyword = (convertingSample.content || '')
        .replace(/^status_code[=:]\s*\d+[,.]\s*/, '')
        .replace(/\s*\(request id:.*$/, '')
        .replace(/,( request id:.*)?$/, '')
        .trim();
      if (keyword) {
        const statusCodeMatch = (convertingSample.content || '').match(/status_code[=:]\s*(\d+)/);
        const statusCode = statusCodeMatch ? parseInt(statusCodeMatch[1]) : 0;
        createClassifyRule({
          keyword,
          status_code: statusCode,
          category: convertCategory,
          sub_category: convertName,
          recommendation: convertCategory,
          priority: 50,
        }).catch(() => {});
      }
      onShowToast(`已成功从样本创建规则「${convertName}」`);
      setConvertingSample(null);
      // Refresh the unmatched list
      loadOverviewStats();
      getUnmatchedSamples()
        .then(setUnmatchedSamples)
        .catch(() => {});
    } catch (err: any) {
      onShowToast(`创建规则失败: ${err.message}`);
    }
  };

  // Refresh unmatched samples
  const handleRefreshUnmatched = () => {
    setUnmatchedLoading(true);
    getUnmatchedSamples()
      .then(setUnmatchedSamples)
      .catch(() => onShowToast('刷新未匹配样本失败'))
      .finally(() => setUnmatchedLoading(false));
  };

  // Filter Categories
  const filteredCategories = categories.filter((item) => {
    // Search filter
    const matchesSearch =
      item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.subCategory.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.sampleLog.toLowerCase().includes(searchQuery.toLowerCase());

    // Category filter
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;

    // Status filter
    let matchesStatus = true;
    if (statusFilter === 'alerting') {
      matchesStatus = item.isAlertEnabled && !item.suppressed;
    } else if (statusFilter === 'suppressed') {
      matchesStatus = item.suppressed;
    } else if (statusFilter === 'disabled') {
      matchesStatus = !item.isAlertEnabled && !item.suppressed;
    }

    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Calculate Metrics
  const totalHourlyCount = categories.reduce((sum, c) => sum + c.hourlyErrorCount, 0);
  const totalDailyCount = categories.reduce((sum, c) => sum + c.dailyErrorCount, 0);
  const activeAlertCount = categories.filter((c) => c.isAlertEnabled && !c.suppressed).length;
  const suppressedCount = categories.filter((c) => c.suppressed).length;

  // Chart Data Preparation
  const chartData = categories.map((c) => ({
    name: c.code,
    fullName: c.name,
    count: globalScanGranularity === '小时 (Hourly)' ? c.hourlyErrorCount : c.dailyErrorCount,
    category: c.category,
    color:
      c.severity === 'critical' ? '#ba1a1a' : c.severity === 'warning' ? '#d97706' : '#004ac6',
  }));

  // Handle Add Category Submit
  const handleAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCode || !newName) return;

    onAddScanCategory({
      code: newCode.toUpperCase().replace(/\s+/g, '_'),
      name: newName,
      category: newCategory,
      subCategory: newSubCategory || `${newCategory} 精细规则`,
      statusCode: newCategory.includes('500') ? 500 : 400,
      patternKeyword: newCode,
      topModel: newModel,
      topChannel: 'custom-channel',
      topUser: 'default-user',
      topEndpoint: newEndpoint,
      hourlyErrorCount: 0,
      dailyErrorCount: 0,
      alertThreshold: minAlertThreshold,
      sampleLog: newSampleLog || `status_code=400, Simulated log trace for ${newCode}`,
      isAlertEnabled: true,
      suppressed: false,
      scanGranularity: globalScanGranularity,
      alertGranularity: globalAlertGranularity,
      excludeChannels: '',
      excludeUsers: '',
      filterMode: 'exclude',
      severity: newSeverity,
      feishuWebhookUrl: newFeishuUrl || globalFeishuUrl,
      rawLogs: [],
    });

    setIsAddModalOpen(false);
    setNewCode('');
    setNewName('');
    setNewSubCategory('');
    setNewSampleLog('');
    setNewFeishuUrl('');
    setNewSeverity('warning');
    onShowToast(`已成功添加错误扫描分类: "${newName}"`);
  };

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2 shrink-0">
          <h2 className="text-[18px] font-bold text-[#191c1e]">
            错误日志精细化分类与告警分析
          </h2>
          <span className="bg-[#d0e1fb] text-[#004ac6] text-[11px] font-bold px-2 py-0.5 rounded-full shrink-0">
            智能深剖 v2.4
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleTriggerManualScan}
            disabled={isScanning}
            className="px-3 py-1.5 bg-[#004ac6] text-white font-medium text-[12px] rounded-lg hover:opacity-90 active:scale-95 transition-all flex items-center gap-1.5 shadow-2xs"
          >
            <span
              className={`material-symbols-outlined text-[16px] ${
                isScanning ? 'animate-spin' : ''
              }`}
            >
              sync
            </span>
            {isScanning ? '扫描中...' : '运行日志分类引擎'}
          </button>

          <button
            onClick={async () => {
              setSamplesLoading(true);
              try {
                const data = await getRecentErrorSamples();
                setErrorSamples(data);
                setShowSamplesPanel(true);
              } catch {
                onShowToast('获取错误样本失败');
              } finally {
                setSamplesLoading(false);
              }
            }}
            className="px-3 py-1.5 bg-amber-50 border border-amber-300 text-amber-900 font-semibold text-[12px] rounded-lg hover:bg-amber-100 transition-colors flex items-center gap-1 shrink-0"
          >
            <span className="material-symbols-outlined text-[16px]">description</span>
            错误样本
          </button>

          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-3 py-1.5 bg-white border border-[#c3c6d7] text-[#191c1e] font-semibold text-[12px] rounded-lg hover:bg-[#eeefff] transition-colors flex items-center gap-1 shrink-0"
          >
            <span className="material-symbols-outlined text-[16px] text-[#004ac6]">add</span>
            + 自定义细化分类规则
          </button>
        </div>
      </div>
      <p className="text-[12px] text-[#434655] leading-[18px] -mt-1">
        深度解析 <code className="bg-[#e0e3e5] px-1 py-0.5 rounded text-[#191c1e] font-mono text-[11px]">content</code> 与 <code className="bg-[#e0e3e5] px-1 py-0.5 rounded text-[#191c1e] font-mono text-[11px]">other</code> 扩展字段，将 400/500 错误精准下钻细化为工具上下文不配对、文本块为空、模型容量超载等精细类别。
      </p>

      {/* Tab Navigation */}
      <div className="flex border-b border-[#c3c6d7] -mb-1">
        {[
          { key: 'dashboard' as const, label: '错误日志看板', icon: 'monitoring' },
          { key: 'classify' as const, label: '分类规则管理', icon: 'category' },
          { key: 'alert' as const, label: '飞书告警配置 & 全局策略', icon: 'notifications_active' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold border-b-2 transition-colors -mb-[1px] ${
              activeTab === tab.key
                ? 'border-[#004ac6] text-[#004ac6] bg-[#f0f0ff]'
                : 'border-transparent text-[#737686] hover:text-[#191c1e] hover:bg-[#f7f9fb]'
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ─── Tab: 错误日志看板 ─── */}
      {activeTab === 'dashboard' && (<>
      
      {/* Interactive JSON Log Classifier Inspector Section */}
      <div className="bg-gradient-to-r from-[#f7f9fc] via-white to-[#eeefff] border border-[#b4c5ff] rounded-xl p-5 shadow-2xs space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[#004ac6]">
            <span className="material-symbols-outlined text-[22px]">auto_fix_high</span>
            <h3 className="text-[16px] font-bold text-[#191c1e]">
              🔍 真实日志 JSON 实时精细化解析分类器
            </h3>
          </div>
          <button
            onClick={() => setShowLogTester(!showLogTester)}
            className="text-[12px] font-semibold text-[#004ac6] hover:underline flex items-center gap-1"
          >
            {showLogTester ? '收起测试器' : '展开日志测试解析器'}
            <span className="material-symbols-outlined text-[16px]">
              {showLogTester ? 'expand_less' : 'expand_more'}
            </span>
          </button>
        </div>

        {showLogTester && (
          <div className="space-y-4 pt-2 border-t border-[#c3c6d7]/60">
            <p className="text-[13px] text-[#434655] leading-[20px]">
              针对您提供的包含 <code className="font-mono text-[#004ac6]">content</code> 与 <code className="font-mono text-[#004ac6]">other</code> (含 status_code, error_code, request_path 等) 的复杂网关日志 JSON，下方分类器可精准提取特征并归类：
            </p>

            {/* Quick Sample Presets */}
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-semibold text-[#191c1e] shrink-0">点击选择预置真实日志载荷：</span>
              {SAMPLE_USER_LOGS.map((sample, idx) => (
                <button
                  key={idx}
                  onClick={() => {
                    const jsonStr = JSON.stringify(sample.log, null, 2);
                    setTestInputJson(jsonStr);
                    handleAnalyzeCustomLog(jsonStr);
                  }}
                  className="px-2.5 py-1 bg-white border border-[#c3c6d7] hover:border-[#004ac6] text-[#191c1e] hover:text-[#004ac6] rounded-md font-medium transition-colors shadow-2xs"
                >
                  {sample.label}
                </button>
              ))}
            </div>

            {/* Input & Output Split Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Input JSON */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-[12px]">
                  <label className="font-semibold text-[#191c1e] flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px] text-[#004ac6]">code</span>
                    网关原始日志 (支持 JSON 或纯文本 content)
                  </label>
                  <button
                    onClick={() => handleAnalyzeCustomLog()}
                    className="px-2.5 py-0.5 bg-[#004ac6] text-white text-[11px] font-bold rounded hover:opacity-90"
                  >
                    实时匹配运行
                  </button>
                </div>
                <textarea
                  rows={8}
                  value={testInputJson}
                  onChange={(e) => setTestInputJson(e.target.value)}
                  className="w-full bg-[#1e1e1e] text-[#d4d4d4] font-mono text-[12px] p-3 rounded-lg outline-none focus:ring-2 focus:ring-[#004ac6] leading-[18px]"
                />
              </div>

              {/* Output Analysis */}
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold text-[#191c1e] flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px] text-[#006242]">psychology</span>
                  精细化分类提取与决策诊断结果
                </label>

                {analyzedResult ? (
                  <div className="bg-white border border-[#c3c6d7] p-3.5 rounded-lg space-y-2.5 text-[12px] min-h-[190px] shadow-2xs">
                    <div className="flex items-center justify-between border-b border-[#e0e3e5] pb-2">
                      <span className="font-bold text-[#191c1e] text-[13px] flex items-center gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-[#004ac6]" />
                        {analyzedResult.subCategory}
                      </span>
                      <span className="font-mono text-[11px] font-bold bg-[#ffdad6] text-[#ba1a1a] px-2 py-0.5 rounded">
                        HTTP {analyzedResult.statusCode}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div>
                        <span className="text-[#737686]">顶级分类：</span>
                        <span className="font-semibold text-[#191c1e]">{analyzedResult.mainCategory}</span>
                      </div>
                      <div>
                        <span className="text-[#737686]">匹配模式/关键词：</span>
                        {analyzedResult.keywordMatched ? (
                          <span className="font-mono text-[#004ac6] font-bold">{analyzedResult.keywordMatched}</span>
                        ) : (
                          <span className="text-[#c62828] font-semibold">无匹配</span>
                        )}
                      </div>
                      <div>
                        <span className="text-[#737686]">受影响模型/渠道：</span>
                        <span className="font-semibold text-[#191c1e]">
                          {analyzedResult.model || '-'} / {analyzedResult.channel || '-'}
                        </span>
                      </div>
                      <div>
                        <span className="text-[#737686]">用户与分组：</span>
                        <span className="font-semibold text-[#191c1e]">
                          {analyzedResult.username} ({analyzedResult.group})
                        </span>
                      </div>
                    </div>

                    <div className="bg-[#f2f4f6] p-2 rounded text-[11px] leading-[16px] text-[#434655]">
                      💡 <strong>规则推荐：</strong> {analyzedResult.recommendation}
                    </div>

                    {/* 无匹配时：一键添加分类规则 */}
                    {!analyzedResult.keywordMatched && (
                      <div className="bg-amber-50 border border-amber-300 p-2.5 rounded">
                        <p className="text-[11px] text-amber-800 mb-2">未命中任何分类规则，可以抓取 content 中的关键词快速添加：</p>
                        <div className="flex items-center gap-2">
                          <input
                            value={newClassifyKeyword}
                            onChange={(e) => setNewClassifyKeyword(e.target.value)}
                            placeholder="输入匹配关键词..."
                            className="flex-1 bg-white border border-amber-300 rounded px-2 py-1 text-[11px] outline-none focus:ring-1 focus:ring-amber-500"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              if (!newClassifyKeyword.trim()) {
                                onShowToast('请先输入关键词');
                                return;
                              }
                              setActiveTab('classify');
                            }}
                            className="px-3 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-bold rounded transition-colors whitespace-nowrap"
                          >
                            + 添加分类规则
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Quick Direct Rule Creation Action */}
                    <div className="pt-2 border-t border-[#e0e3e5] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <span className="text-[11px] text-[#006242] font-semibold flex items-center gap-1">
                        <span className="material-symbols-outlined text-[15px]">check_circle</span>
                        规则提炼完成：已自动捕捉关键词及 API 元数据
                      </span>
                      <button
                        type="button"
                        onClick={handleCreateRuleFromAnalyzer}
                        className="px-3.5 py-1.5 bg-[#004ac6] hover:bg-[#003ea8] text-white text-[12px] font-bold rounded-lg transition-all flex items-center gap-1.5 shadow-xs shrink-0 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[16px]">add_task</span>
                        ⚡ 一键根据此分析结果直接生成细化规则
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#f2f4f6] border border-dashed border-[#c3c6d7] p-8 rounded-lg text-center text-[#737686] text-[12px] h-[190px] flex flex-col items-center justify-center gap-2">
                    <span className="material-symbols-outlined text-[28px] text-[#004ac6]">smart_toy</span>
                    <span>请点击上面的预置日志或手动输入 JSON 后点击“实时匹配运行”查看分类细节。</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      </>)}
      {/* ─── Tab: 飞书告警配置 & 全局策略 ─── */}
      {activeTab === 'alert' && (<>

      {/* Global Configuration Bar: Scan & Alert Granularity Settings + Feishu Webhook */}
      <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-5">
        {/* Feishu Bot Webhook Association Sub-Panel */}
        <div className="bg-gradient-to-r from-white via-[#f4f7ff] to-[#eeefff] border border-[#b4c5ff] rounded-xl p-4 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#c3c6d7]/60 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-lg bg-[#004ac6] text-white flex items-center justify-center shrink-0 shadow-xs">
                <span className="material-symbols-outlined text-[20px]">chat</span>
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[#191c1e] flex items-center gap-2">
                  告警通知关联 — 飞书 (Feishu / Lark) 机器人 Webhook 地址
                  <span className="text-[11px] font-semibold bg-[#004ac6] text-white px-2 py-0.5 rounded-full">
                    必填项
                  </span>
                </h3>
                <p className="text-[12px] text-[#434655]">
                  当规则命中的错误日志达到设定阈值时，自动向指定的飞书机器人发送包含 HTTP 状态码、错误特征词、关联模型与 TraceID 的富文本卡片。
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  if (onBulkUpdateFeishuWebhookUrl) {
                    onBulkUpdateFeishuWebhookUrl(globalFeishuUrl);
                  } else {
                    onShowToast(`已成功将飞书地址同步应用至全量 ${categories.length} 条分类规则！`);
                  }
                }}
                className="px-3.5 py-1.5 bg-[#004ac6] hover:bg-[#003ea8] text-white text-[12px] font-bold rounded-lg transition-all shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">sync</span>
                一键同步覆盖全量规则 ({categories.length}条)
              </button>

              <button
                type="button"
                onClick={async () => {
                  const result = await testErrorScanWebhook(globalFeishuUrl);
                  if (result.success) {
                    onShowToast('飞书测试消息发送成功！请检查飞书群是否收到消息');
                  } else {
                    onShowToast(`飞书测试失败: ${result.error || '未知错误'}`);
                  }
                }}
                className="px-3.5 py-1.5 bg-white border border-[#c3c6d7] hover:border-[#004ac6] text-[#004ac6] text-[12px] font-bold rounded-lg transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                发送测试卡片
              </button>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="relative flex-1">
                <span className="material-symbols-outlined absolute left-3 top-2.5 text-[18px] text-[#004ac6]">
                  link
                </span>
                <input
                  type="url"
                  required
                  value={globalFeishuUrl}
                  onChange={(e) => setGlobalFeishuUrl(e.target.value)}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/4a89bc21-09df-41ef-bc82-9011abf88123"
                  className="w-full pl-9 pr-3.5 py-2 bg-white border border-[#c3c6d7] focus:border-[#004ac6] rounded-lg font-mono text-[12.5px] outline-none focus:ring-2 focus:ring-[#004ac6] text-[#191c1e] shadow-2xs"
                />
              </div>
            </div>

            {/* Quick Presets */}
            <div className="flex flex-wrap items-center gap-2 text-[11px] pt-0.5">
              <span className="text-[#434655] font-semibold">快捷填充：</span>
              {savedWebhooks.length === 0 ? (
                <span className="text-[#737686] italic">暂无保存的 Webhook，点击右侧 + 保存当前地址</span>
              ) : (
                savedWebhooks.map((w) => (
                  <span key={w.url} className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setGlobalFeishuUrl(w.url)}
                      className="px-2.5 py-1 bg-white border border-[#c3c6d7] hover:border-[#004ac6] text-[#191c1e] hover:text-[#004ac6] rounded-md font-medium transition-all shadow-2xs cursor-pointer"
                    >
                      {w.label}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeWebhookPreset(w.url)}
                      className="text-[#ba1a1a] hover:text-red-500 text-[14px] leading-none"
                      title="删除此预设"
                    >
                      ×
                    </button>
                  </span>
                ))
              )}
              <button
                type="button"
                onClick={() => {
                  const label = prompt('请输入此 Webhook 的标签名（如：核心运维群）:');
                  if (label) saveWebhookPreset(label, globalFeishuUrl);
                }}
                className="px-2 py-1 bg-[#d0e1fb] hover:bg-[#b4c5ff] text-[#003ea8] rounded-md font-bold text-[12px] transition-colors"
                title="保存当前 Webhook 地址为快捷预设"
              >
                +
              </button>
            </div>

            {/* Fallback Alert Toggle */}
            <div className="flex items-center justify-between pt-3 mt-2 border-t border-[#c3c6d7]/60">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[20px] text-amber-600">shield</span>
                <div>
                  <span className="text-[13px] font-semibold text-[#191c1e]">
                    未匹配错误兜底告警
                  </span>
                  <p className="text-[11px] text-[#737686]">
                    当错误日志无法被任何规则覆盖时，自动触发兜底告警通知
                  </p>
                </div>
              </div>
              <label className="relative inline-flex items-center cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={fallbackEnabled}
                  onChange={async () => {
                    const newEnabled = !fallbackEnabled;
                    setFallbackEnabled(newEnabled);
                    try {
                      await setFallbackConfig(newEnabled, newEnabled ? (fallbackWebhook || globalFeishuUrl) : fallbackWebhook);
                      onShowToast(`兜底告警已${newEnabled ? '开启' : '关闭'}`);
                    } catch (err: any) {
                      setFallbackEnabled(!newEnabled);
                      onShowToast(`切换兜底告警失败: ${err.message}`);
                    }
                  }}
                  className="sr-only peer"
                />
                <div className="w-11 h-6 bg-[#e0e3e5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#c3c6d7] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#d97706]"></div>
              </label>
            </div>
            {fallbackEnabled && fallbackWebhook && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1 mt-2">
                <div className="flex items-center gap-1.5 text-[11px] text-amber-900">
                  <span className="material-symbols-outlined text-[14px]">link</span>
                  <span className="font-semibold">兜底告警 Webhook:</span>
                </div>
                <code className="block text-[11px] font-mono text-amber-800 bg-amber-100 px-2 py-1 rounded break-all">
                  {fallbackWebhook}
                </code>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-b border-[#e0e3e5] pb-3">
          <div className="flex items-center gap-2 text-[#004ac6]">
            <span className="material-symbols-outlined text-[20px]">tune</span>
            <h3 className="text-[15px] font-bold text-[#191c1e]">全局日志扫描与告警策略配置</h3>
          </div>
          <span className="text-[12px] text-[#737686]">
            上次全局扫描：5 分钟前 | 下次预计：5 分钟后
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Scan Granularity Selector */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-[#191c1e] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#004ac6]">schedule</span>
              日志扫描时间粒度
            </label>
            <div className="flex bg-[#f2f4f6] p-1 rounded-lg border border-[#c3c6d7]">
              {(['小时 (Hourly)', '天 (Daily)'] as const).map((g) => (
                <button
                  key={g}
                  onClick={() => setGlobalScanGranularity(g)}
                  className={`flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                    globalScanGranularity === g
                      ? 'bg-white text-[#004ac6] font-bold shadow-xs'
                      : 'text-[#434655] hover:text-[#191c1e]'
                  }`}
                >
                  {g === '小时 (Hourly)' ? '⏱️ 按小时 (Hourly)' : '📅 按天 (Daily)'}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-[#737686]">
              {globalScanGranularity === '小时 (Hourly)'
                ? '每小时自动聚合评估过去 60 分钟内的精细化错误日志增长速率'
                : '按自然天汇总评估过去 24 小时的错误分布与趋势'}
            </p>
          </div>

          {/* Alert Granularity Selector */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-[#191c1e] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#004ac6]">hub</span>
              告警聚合维度粒度
            </label>
            <select
              value={globalAlertGranularity}
              onChange={(e) => setGlobalAlertGranularity(e.target.value as AlertGranularity)}
              className="w-full bg-[#f2f4f6] border border-[#c3c6d7] rounded-lg px-3 py-2 text-[13px] text-[#191c1e] font-medium outline-none focus:ring-2 focus:ring-[#004ac6]"
            >
              <option value="按错误精细类型">🏷️ 按错误精细类型聚合 (By SubCategory)</option>
              <option value="按模型">🤖 按受影响模型聚合 (By Model)</option>
              <option value="按渠道">📡 按网关渠道聚合 (By Channel)</option>
              <option value="按用户">👤 按用户聚合 (By User)</option>
              <option value="按 API 接口">🔗 按 API 端点聚合 (By Endpoint)</option>
            </select>
            <p className="text-[11px] text-[#737686]">
              触发告警时将以该维度合并告警报文，防止相同错误的重复刷屏。
            </p>
          </div>

          {/* Min Alert Count Threshold */}
          <div className="space-y-1.5">
            <label className="text-[13px] font-semibold text-[#191c1e] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-[#004ac6]">filter_alt</span>
              告警触发起算阀值 (错误数)
            </label>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="1"
                max="50"
                value={minAlertThreshold}
                onChange={(e) => setMinAlertThreshold(Number(e.target.value))}
                className="flex-1 accent-[#004ac6]"
              />
              <span className="font-mono font-bold text-[14px] text-[#004ac6] bg-[#d0e1fb] px-2.5 py-1 rounded-md">
                ≥ {minAlertThreshold} 次/{globalScanGranularity === '小时 (Hourly)' ? '小时' : '天'}
              </span>
            </div>
            <p className="text-[11px] text-[#737686]">
              当精细化类型的错误量在扫描周期达到或超过 {minAlertThreshold} 次时，自动触发告警通知。
            </p>
          </div>
        </div>
      </div>

      </>)}
      {/* ─── Tab: 错误日志看板 (continued) ─── */}
      {activeTab === 'dashboard' && (<>

      {/* Summary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">精细化错误分类规则</span>
            <span className="material-symbols-outlined text-[20px] text-[#004ac6]">account_tree</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">{categories.length}</p>
          <p className="text-[11px] text-[#006242] mt-1 font-medium">● 已细化 Tool Mismatch / Overloaded 等</p>
        </div>

        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">
              扫描周期错误总量 ({globalScanGranularity === '小时 (Hourly)' ? '近1小时' : '今日'})
            </span>
            <span className="material-symbols-outlined text-[20px] text-[#ba1a1a]">running_with_errors</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {globalScanGranularity === '小时 (Hourly)' ? totalHourlyCount : totalDailyCount}
            <span className="text-[13px] text-[#737686] font-normal ml-1">条错误日志</span>
          </p>
        </div>

        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">已标记开启告警</span>
            <span className="material-symbols-outlined text-[20px] text-emerald-600">notifications_active</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {activeAlertCount} <span className="text-[13px] text-[#737686] font-normal">/ 共 {categories.length} 项</span>
          </p>
          <p className="text-[11px] text-emerald-700 mt-1 font-medium">● 告警开启率 {Math.round((activeAlertCount / categories.length) * 100)}%</p>
        </div>

        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">误报/无须告警标记</span>
            <span className="material-symbols-outlined text-[20px] text-amber-600">notifications_off</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {suppressedCount} <span className="text-[13px] text-[#737686] font-normal">项分类已屏蔽</span>
          </p>
          <p className="text-[11px] text-[#737686] mt-1">例如：消息 Text 块为空 (已知前端问题)</p>
        </div>
      </div>

      {/* Visual Error Frequency Chart */}
      <div className="bg-white border border-[#c3c6d7] rounded-xl p-5 shadow-2xs space-y-3">
        <div className="flex justify-between items-center">
          <div>
            <h3 className="text-[16px] font-bold text-[#191c1e]">
              精细化错误分类分布与爆发频次 ({globalScanGranularity})
            </h3>
            <p className="text-[12px] text-[#434655]">
              直观呈现 Tool Use 异常、Overloaded 崩溃、空 Text 块等分类在 ({globalScanGranularity}) 周期内的分布
            </p>
          </div>
          <span className="text-[12px] font-mono text-[#004ac6] bg-[#d0e1fb] px-3 py-1 rounded-lg">
            聚合维度: {globalAlertGranularity}
          </span>
        </div>

        <div className="h-48 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <XAxis dataKey="name" stroke="#737686" fontSize={11} />
              <YAxis stroke="#737686" fontSize={11} />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#ffffff',
                  borderColor: '#c3c6d7',
                  borderRadius: '8px',
                  fontSize: '12px',
                }}
              />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Overview Dashboard Cards */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[11px] font-semibold text-[#737686] whitespace-nowrap">时间范围</span>
        <div className="flex gap-1">
          {[1, 6, 12, 24].map(h => (
            <button
              key={h}
              onClick={() => setOverviewWindow(h)}
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors ${
                overviewWindow === h
                  ? 'bg-[#004ac6] text-white'
                  : 'bg-[#e0e3e5] text-[#434655] hover:bg-[#c3c6d7]'
              }`}
            >
              {h}h
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* 总错误日志 */}
        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">总错误日志 (type=5)</span>
            <span className="material-symbols-outlined text-[20px] text-[#ba1a1a]">receipt_long</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {overviewStats ? overviewStats.total_errors.toLocaleString() : '-'}
          </p>
          <p className="text-[11px] text-[#737686] mt-1">
            已激活 {overviewStats?.active_rules ?? 0} 条规则
          </p>
        </div>

        {/* 已匹配 */}
        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">已匹配 (规则覆盖)</span>
            <span className="material-symbols-outlined text-[20px] text-emerald-600">check_circle</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {overviewStats ? overviewStats.matched_errors.toLocaleString() : '-'}
          </p>
          <p className="text-[11px] text-emerald-700 mt-1 font-medium">
            已匹配: {overviewStats?.matched_errors ?? 0} / {overviewStats?.total_errors ?? 0} 条
          </p>
        </div>

        {/* 未匹配 - clickable */}
        <div
          onClick={handleOpenUnmatchedPanel}
          className="bg-white border border-amber-300 p-5 rounded-xl shadow-2xs cursor-pointer hover:bg-amber-50 transition-colors active:scale-[0.98]"
        >
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">未匹配 (未被覆盖)</span>
            <span className="material-symbols-outlined text-[20px] text-amber-600">warning</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {overviewStats ? overviewStats.unmatched_errors.toLocaleString() : '-'}
          </p>
          <p className="text-[11px] text-amber-700 mt-1 font-medium flex items-center gap-1">
            <span>{overviewStats ? '点击查看详情' : '加载中...'}</span>
            <span className="material-symbols-outlined text-[14px]">chevron_right</span>
          </p>
        </div>

        {/* 匹配率 */}
        <div className="bg-white border border-[#c3c6d7] p-5 rounded-xl shadow-2xs">
          <div className="flex justify-between items-center text-[#434655]">
            <span className="text-[12px] font-semibold">匹配率</span>
            <span className="material-symbols-outlined text-[20px] text-[#004ac6]">trending_up</span>
          </div>
          <p className="text-[28px] font-extrabold text-[#191c1e] mt-2">
            {overviewStats ? `${overviewStats.match_rate.toFixed(1)}%` : '-'}
          </p>
          <p className="text-[11px] text-[#006242] mt-1 font-medium">
            错误覆盖率
          </p>
        </div>
      </div>

      {/* Grouped Error Breakdown */}
      <div className="bg-white border border-[#c3c6d7] rounded-xl shadow-2xs overflow-hidden">
        <div className="p-4 border-b border-[#c3c6d7] bg-[#f2f4f6] flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[13px] font-bold text-[#191c1e]">错误分布</span>
            <select
              value={groupDimension}
              onChange={(e) => {
                setGroupDimension(e.target.value);
                setExpandedGroups(new Set());
              }}
              className="bg-white border border-[#c3c6d7] rounded-lg px-2 py-1 text-[12px] font-medium outline-none"
            >
              <option value="channel">按渠道</option>
              <option value="model">按模型</option>
              <option value="user">按用户</option>
              <option value="keyword">按关键词</option>
            </select>
            <select
              value={groupWindow}
              onChange={(e) => setGroupWindow(parseInt(e.target.value) || 1)}
              className="bg-white border border-[#c3c6d7] rounded-lg px-2 py-1 text-[12px] font-medium outline-none"
            >
              <option value={1}>最近1小时</option>
              <option value={6}>最近6小时</option>
              <option value={24}>最近24小时</option>
            </select>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <button
              onClick={() => setExpandedGroups(new Set(groupedStats.map(s => s.group_value)))}
              className="text-[#004ac6] hover:underline"
            >
              全部展开
            </button>
            <button
              onClick={() => setExpandedGroups(new Set())}
              className="text-[#004ac6] hover:underline"
            >
              全部折叠
            </button>
            <span className="text-[#737686]">共 {groupedStats.reduce((s, i) => s + i.count, 0)} 条</span>
          </div>
        </div>

        <div className="divide-y divide-[#e0e3e5] max-h-[500px] overflow-y-auto">
          {groupedStats.length === 0 ? (
            <div className="py-8 text-center text-[#737686] text-[13px]">暂无数据</div>
          ) : (
            groupedStats.map((item) => {
              const isExpanded = expandedGroups.has(item.group_value);
              const barWidth = groupedStats.length > 0
                ? Math.max(2, (item.count / groupedStats[0].count) * 100)
                : 0;
              return (
                <div key={item.group_value} className="hover:bg-[#f7f9fb] transition-colors">
                  <button
                    onClick={async () => {
                      const wasExpanded = expandedGroups.has(item.group_value);
                      const next = new Set(expandedGroups);
                      if (wasExpanded) {
                        next.delete(item.group_value);
                      } else {
                        next.add(item.group_value);
                        // 懒加载明细
                        if (!groupDetails[item.group_value] && !groupDetailsLoading.has(item.group_value)) {
                          setGroupDetailsLoading(prev => new Set(prev).add(item.group_value));
                          try {
                            const samples = await getGroupedSamples(groupDimension, item.raw_key || item.group_value, groupWindow);
                            setGroupDetails(prev => ({ ...prev, [item.group_value]: samples }));
                          } catch { /* ignore */ }
                          setGroupDetailsLoading(prev => {
                            const s = new Set(prev);
                            s.delete(item.group_value);
                            return s;
                          });
                        }
                      }
                      setExpandedGroups(next);
                    }}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-left hover:bg-[#f2f4f6] transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px] text-[#737686] transition-transform" style={{ transform: isExpanded ? 'rotate(90deg)' : '' }}>
                      chevron_right
                    </span>
                    <span className="flex-1 text-[13px] font-medium text-[#191c1e] truncate">
                      {item.group_value}
                    </span>
                    <span className="text-[12px] font-mono font-bold text-[#004ac6] bg-[#d0e1fb] px-2 py-0.5 rounded">
                      {item.count}
                    </span>
                    <div className="hidden sm:block w-24 h-1.5 bg-[#e0e3e5] rounded-full overflow-hidden">
                      <div className="h-full bg-[#004ac6] rounded-full transition-all" style={{ width: `${barWidth}%` }} />
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-10 pb-3">
                      <p className="text-[12px] text-[#737686] mb-2">
                        {groupDimension === 'keyword'
                          ? `关键词: ${item.group_value}`
                          : `${groupDimension === 'channel' ? '渠道' : groupDimension === 'model' ? '模型' : '用户'}: ${item.group_value}`}
                        <span className="ml-2">错误次数: <span className="font-bold text-[#191c1e]">{item.count}</span></span>
                      </p>
                      {/* 错误明细列表 */}
                      {groupDetailsLoading.has(item.group_value) ? (
                        <div className="py-4 text-center text-[12px] text-[#737686]">加载中...</div>
                      ) : groupDetails[item.group_value]?.length ? (
                        <div className="space-y-1.5 max-h-[300px] overflow-y-auto">
                          {groupDetails[item.group_value]!.map((detail, idx) => (
                            <div
                              key={detail.id}
                              className="flex items-center gap-2 px-2 py-1.5 bg-[#f7f9fb] rounded border border-[#e0e3e5] hover:border-[#004ac6] transition-colors cursor-pointer group"
                              onClick={() => setDetailModalItem(detail)}
                            >
                              <span className="text-[11px] font-mono text-[#737686] min-w-[40px] self-start mt-0.5">#{idx + 1}</span>
                              <span className="flex-1 text-[12px] text-[#191c1e] break-all leading-relaxed" title={detail.content}>
                                {detail.content}
                              </span>
                              <span className="text-[11px] text-[#737686] whitespace-nowrap">
                                {detail.model_name || '-'}
                              </span>
                              <span className="text-[11px] text-[#737686] whitespace-nowrap">
                                {detail.channel_name || (detail.channel_id ? `渠道#${detail.channel_id}` : '-')}
                              </span>
                              <span className="text-[11px] text-[#737686] font-mono whitespace-nowrap">
                                {new Date(detail.created_at * 1000).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                              </span>
                              <span className="material-symbols-outlined text-[14px] text-[#004ac6] opacity-0 group-hover:opacity-100 transition-opacity">
                                open_in_new
                              </span>
                            </div>
                          ))}
                          {groupDetails[item.group_value]!.length >= 50 && (
                            <p className="text-[11px] text-[#737686] text-center pt-1">仅显示最近 50 条</p>
                          )}
                        </div>
                      ) : (
                        <div className="py-2 text-[12px] text-[#737686]">暂无明细数据</div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main Error Category Table & Mark Controls */}
      <div className="bg-white border border-[#c3c6d7] rounded-xl shadow-2xs overflow-hidden">
        {/* Table Filter Header */}
        <div className="p-4 border-b border-[#c3c6d7] bg-[#f2f4f6] flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3">
          <div className="flex flex-wrap items-center gap-2">
            {/* Category Filter */}
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] font-medium text-[#191c1e] outline-none focus:ring-2 focus:ring-[#004ac6]"
            >
              <option value="all">全部分类 (All Categories)</option>
              <option value="400 参数格式错误">400 参数格式错误</option>
              <option value="5xx 服务器错误">5xx 服务器错误</option>
              <option value="429 频率限制">429 频率限制</option>
              <option value="504 超时响应">504 超时响应</option>
              <option value="401/403 鉴权异常">401/403 鉴权异常</option>
            </select>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | 'alerting' | 'suppressed' | 'disabled')
              }
              className="bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] font-medium text-[#191c1e] outline-none focus:ring-2 focus:ring-[#004ac6]"
            >
              <option value="all">全部标记状态 (All Status)</option>
              <option value="alerting">🟢 已开启告警 (Alert Enabled)</option>
              <option value="suppressed">🔕 已误报忽略 (Suppressed)</option>
              <option value="disabled">⚪ 未开启告警 (Alert Disabled)</option>
            </select>
          </div>

          {/* Poll Interval & Search */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-[12px] bg-white border border-[#c3c6d7] rounded-lg px-2 py-1">
              <span className="text-[#737686] whitespace-nowrap">扫描间隔:</span>
              <input
                type="number"
                min={10}
                value={pollIntervalSeconds}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 300;
                  setPollIntervalSeconds(val);
                }}
                onBlur={() => {
                  setErrorScanPollInterval(pollIntervalSeconds).catch(() => {});
                }}
                className="w-14 text-center bg-transparent font-mono font-semibold text-[#004ac6] outline-none"
              />
              <span className="text-[#737686]">秒</span>
            </div>

            {/* Search Box */}
          <div className="relative min-w-[220px]">
            <span className="material-symbols-outlined absolute left-2.5 top-2 text-[18px] text-[#737686]">
              search
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索精细子类/Code/样例日志..."
              className="w-full pl-8 pr-3 py-1.5 bg-white border border-[#c3c6d7] rounded-lg text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
            />
          </div>
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
          <table className="w-full text-left text-[13px] border-collapse">
            <thead>
              <tr className="bg-[#f7f9fb] border-b border-[#c3c6d7] text-[#434655] font-semibold text-[12px]">
                <th className="py-3 px-3 w-10">
                  <input
                    type="checkbox"
                    checked={selectedRuleIds.size > 0 && selectedRuleIds.size === filteredCategories.length}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedRuleIds(new Set(filteredCategories.map(c => c.id)));
                      } else {
                        setSelectedRuleIds(new Set());
                      }
                    }}
                    className="w-3.5 h-3.5 accent-[#004ac6] cursor-pointer"
                  />
                </th>
                <th className="py-3 px-4">精细化错误子类与规则代码</th>
                <th className="py-3 px-4">扫描与告警粒度</th>
                <th className="py-3 px-4">排除 & 阈值设置</th>
                <th className="py-3 px-4">关联飞书 Webhook 地址</th>
                <th className="py-3 px-4 text-center">本周期错误计数</th>
                <th className="py-3 px-4 text-center">标记是否告警</th>
                <th className="py-3 px-4 text-right">操作管理</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#e0e3e5]">
              {filteredCategories.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#737686]">
                    未找到匹配条件下的错误日志分类记录
                  </td>
                </tr>
              ) : (
                filteredCategories.map((item) => {
                  const currentCount =
                    globalScanGranularity === '小时 (Hourly)'
                      ? item.hourlyErrorCount
                      : item.dailyErrorCount;

                  const isHighAlert = currentCount >= minAlertThreshold;

                  return (
                    <tr
                      key={item.id}
                      className={`hover:bg-[#f2f4f6] transition-colors ${
                        item.suppressed ? 'opacity-60 bg-[#fafafa]' : ''
                      } ${selectedRuleIds.has(item.id) ? 'bg-[#d0e1fb]/30' : ''}`}
                    >
                      <td className="py-3.5 px-3">
                        <input
                          type="checkbox"
                          checked={selectedRuleIds.has(item.id)}
                          onChange={() => {
                            const next = new Set(selectedRuleIds);
                            if (next.has(item.id)) {
                              next.delete(item.id);
                            } else {
                              next.add(item.id);
                            }
                            setSelectedRuleIds(next);
                          }}
                          className="w-3.5 h-3.5 accent-[#004ac6] cursor-pointer"
                        />
                      </td>
                      {/* SubCategory Code & Name */}
                      <td className="py-3.5 px-4 space-y-1 max-w-[320px]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              item.severity === 'critical'
                                ? 'bg-[#ba1a1a]'
                                : item.severity === 'warning'
                                ? 'bg-amber-500'
                                : 'bg-[#004ac6]'
                            }`}
                          />
                          <span className="font-semibold text-[#191c1e] text-[13.5px]">
                            {item.name}
                          </span>
                        </div>

                        <div className="text-[11px] font-bold text-[#004ac6] bg-[#eeefff] px-2 py-0.5 rounded inline-block">
                          {item.subCategory}
                        </div>

                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="font-mono text-[10px] text-[#434655] bg-[#e0e3e5] px-1.5 py-0.5 rounded">
                            {item.code}
                          </span>
                          <span className="font-mono text-[10px] text-[#ba1a1a] bg-[#ffdad6] px-1.5 py-0.5 rounded font-bold">
                            HTTP {item.statusCode}
                          </span>
                        </div>
                      </td>

                      {/* Granularities */}
                      <td className="py-3.5 px-4 text-[12px] space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[#737686]">扫描粒度:</span>
                          <select
                            value={item.scanGranularity}
                            onChange={(e) =>
                              onUpdateGranularity(
                                item.id,
                                e.target.value as ScanGranularity,
                                item.alertGranularity
                              )
                            }
                            className="bg-white border border-[#c3c6d7] rounded px-1.5 py-0.5 font-medium text-[11px] outline-none"
                          >
                            <option value="小时 (Hourly)">小时 (Hourly)</option>
                            <option value="天 (Daily)">天 (Daily)</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[#737686]">告警粒度:</span>
                          <select
                            value={item.alertGranularity}
                            onChange={(e) =>
                              onUpdateGranularity(
                                item.id,
                                item.scanGranularity,
                                e.target.value as AlertGranularity
                              )
                            }
                            className="bg-white border border-[#c3c6d7] rounded px-1.5 py-0.5 font-medium text-[11px] outline-none"
                          >
                            <option value="按错误精细类型">按错误精细类型</option>
                            <option value="按模型">按模型</option>
                            <option value="按渠道">按渠道</option>
                            <option value="按用户">按用户</option>
                            <option value="按 API 接口">按 API 接口</option>
                          </select>
                        </div>
                      </td>

                      {/* Exclude & Threshold */}
                      <td className="py-3.5 px-4 text-[12px] space-y-1 max-w-[180px]">
                        <div className="text-[11px] text-[#737686]">
                          阈值: <span className="font-semibold text-[#191c1e]">{item.alertThreshold || 10} 次</span>
                        </div>
                        {item.filterMode && (
                          <div className="text-[11px] text-[#737686]">
                            模式: <span className="font-semibold text-[#004ac6]">{item.filterMode === 'include' ? '仅选中' : '排除'}</span>
                          </div>
                        )}
                        {(item.alertGranularity === '按渠道' || item.alertGranularity === '按用户') && (
                          <div className="text-[11px] text-[#737686]">
                            {item.alertGranularity === '按渠道' && item.excludeChannels && (
                              <span>排除: <span className="text-amber-600">{item.excludeChannels}</span></span>
                            )}
                            {item.alertGranularity === '按用户' && item.excludeUsers && (
                              <span>排除: <span className="text-amber-600">{item.excludeUsers}</span></span>
                            )}
                          </div>
                        )}
                        <button
                          onClick={() => {
                            setEditingExcludes(item);
                            setThresholdInput(item.alertThreshold || 10);
                            setExcludeChannelsInput(item.excludeChannels || '');
                            setExcludeUsersInput(item.excludeUsers || '');
                            setFilterModeInput(item.filterMode || 'exclude');
                          }}
                          className="text-[11px] text-[#004ac6] hover:underline font-medium"
                        >
                          编辑阈值/排除
                        </button>
                      </td>

                      {/* Associated Feishu Webhook URL */}
                      <td className="py-3.5 px-4 text-[12px] max-w-[210px]">
                        <div className="flex flex-col gap-1">
                          <div
                            className="flex items-center gap-1.5 bg-[#eeefff] border border-[#b4c5ff] px-2 py-1 rounded text-[11px] font-mono text-[#004ac6] truncate"
                            title={item.feishuWebhookUrl || globalFeishuUrl}
                          >
                            <span className="material-symbols-outlined text-[14px] shrink-0 text-[#004ac6]">
                              chat
                            </span>
                            <span className="truncate">
                              {item.feishuWebhookUrl || globalFeishuUrl}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingFeishuCategory(item);
                                setEditingFeishuUrlInput(item.feishuWebhookUrl || globalFeishuUrl);
                              }}
                              className="text-[11px] font-bold text-[#004ac6] hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[13px]">edit_note</span>
                              修改飞书地址
                            </button>
                            <span className="text-[#c3c6d7]">|</span>
                            <button
                              type="button"
                              onClick={() => {
                                onShowToast(`🚀 成功向「${item.name}」关联的飞书机器人发送测试告警卡片！`);
                              }}
                              className="text-[11px] font-bold text-emerald-700 hover:underline flex items-center gap-0.5 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[13px]">send</span>
                              测试
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Error Count */}
                      <td className="py-3.5 px-4 text-center">
                        <span
                          className={`font-mono text-[15px] font-bold px-2.5 py-1 rounded-lg ${
                            isHighAlert
                              ? 'bg-[#ffdad6] text-[#ba1a1a]'
                              : 'bg-[#eeefff] text-[#004ac6]'
                          }`}
                        >
                          {currentCount} 次
                        </span>
                        <div className="text-[10px] text-[#737686] mt-1">
                          {globalScanGranularity === '小时 (Hourly)' ? '/ 小时' : '/ 自然天'}
                        </div>
                      </td>

                      {/* Flag / Toggle Alerting */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex flex-col items-center gap-1">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={item.isAlertEnabled && !item.suppressed}
                              disabled={item.suppressed}
                              onChange={() => onToggleAlertEnabled(item.id)}
                              className="sr-only peer"
                            />
                            <div className="w-11 h-6 bg-[#e0e3e5] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-[#c3c6d7] after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#004ac6]"></div>
                          </label>

                          {item.suppressed ? (
                            <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                              🔕 误报已忽略
                            </span>
                          ) : item.isAlertEnabled ? (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded">
                              🟢 开启告警
                            </span>
                          ) : (
                            <span className="text-[10px] font-bold text-[#737686] bg-[#f2f4f6] px-1.5 py-0.5 rounded">
                              ⚪ 告警关闭
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setActiveTab('classify');
                              listClassifyRules().then((rules) => {
                                setClassifyRules(rules);
                                const matched = rules.find(
                                  (r) => r.keyword.toLowerCase() === item.patternKeyword.toLowerCase()
                                );
                                if (matched) {
                                  setEditingClassifyRule(matched);
                                  onShowToast(`已定位到分类规则「${matched.keyword}」，可在此编辑`);
                                } else {
                                  setNewClassifyKeyword(item.patternKeyword);
                                  onShowToast(`未找到匹配的分类规则，关键词已预填入添加表单`);
                                }
                              }).catch(() => {
                                setNewClassifyKeyword(item.patternKeyword);
                              });
                            }}
                            title="跳转到分类规则管理"
                            className="flex items-center gap-1 px-2 py-1.5 bg-[#e8f5e9] hover:bg-[#c8e6c9] text-[#2e7d32] font-medium rounded text-[11px] transition-colors whitespace-nowrap"
                          >
                            <span className="material-symbols-outlined text-[14px]">category</span>
                            <span>分类</span>
                          </button>
                          <button
                            onClick={() => setInspectingCategory(item)}
                            title="查看真实日志 JSON"
                            className="flex items-center gap-1 px-2 py-1.5 bg-[#d0e1fb] hover:bg-[#b4c5ff] text-[#003ea8] font-medium rounded text-[11px] transition-colors whitespace-nowrap"
                          >
                            <span className="material-symbols-outlined text-[14px]">data_object</span>
                            <span>JSON</span>
                            {item.rawLogs.length > 0 && (
                              <span className="bg-[#003ea8]/15 text-[10px] px-1 rounded-full">{item.rawLogs.length}</span>
                            )}
                          </button>

                          <button
                            onClick={() => onToggleSuppressed(item.id)}
                            title={item.suppressed ? '取消误报标记' : '标记为误报/屏蔽告警'}
                            className={`flex items-center gap-1 px-2 py-1.5 font-medium rounded text-[11px] transition-colors whitespace-nowrap ${
                              item.suppressed
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                                : 'bg-amber-100 text-amber-900 hover:bg-amber-200'
                            }`}
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {item.suppressed ? 'check_circle' : 'block'}
                            </span>
                            <span>{item.suppressed ? '恢复' : '误报'}</span>
                          </button>

                          <button
                            onClick={() => {
                              if (confirm(`确定删除规则「${item.name}」？`)) {
                                onDeleteScanCategory(item.id);
                              }
                            }}
                            title="删除规则"
                            className="flex items-center gap-1 px-2 py-1.5 text-red-700 hover:bg-red-100 font-medium rounded text-[11px] transition-colors whitespace-nowrap"
                          >
                            <span className="material-symbols-outlined text-[14px]">delete_outline</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* 批量操作栏 */}
        {selectedRuleIds.size > 0 && (
          <div className="flex items-center justify-between bg-[#004ac6]/5 border border-[#b4c5ff] rounded-lg px-4 py-2.5 mt-3">
            <span className="text-[13px] font-medium text-[#004ac6]">
              已选择 <span className="font-bold">{selectedRuleIds.size}</span> 条规则
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSelectedRuleIds(new Set())}
                className="px-3 py-1.5 text-[12px] text-[#737686] hover:text-[#191c1e] font-medium rounded-lg transition-colors"
              >
                取消选择
              </button>
              <button
                onClick={() => {
                  if (confirm(`确定要删除选中的 ${selectedRuleIds.size} 条规则吗？此操作不可逆。`)) {
                    selectedRuleIds.forEach((id) => onDeleteScanCategory(id));
                    setSelectedRuleIds(new Set());
                  }
                }}
                className="px-3 py-1.5 bg-[#ba1a1a] text-white text-[12px] font-medium rounded-lg hover:opacity-90 flex items-center gap-1 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">delete</span>
                批量删除
              </button>
            </div>
          </div>
        )}
      </div>

      </>)}
      {/* ─── Tab: 飞书告警配置 & 全局策略 ─── */}
      {activeTab === 'alert' && (<> </>)}
      
      {/* ─── Tab: 分类规则管理 ─── */}
      {activeTab === 'classify' && (<> </>)}
      
      {/* ─── Modals (shared across all tabs) ─── */}

      {/* Detail Inspect Modal Drawer */}
      {inspectingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-3xl rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#004ac6]">find_in_page</span>
                <h3 className="text-[17px] font-semibold text-[#191c1e]">
                  日志明细与原始 JSON 解析: {inspectingCategory.name}
                </h3>
              </div>
              <button
                onClick={() => setInspectingCategory(null)}
                className="text-[#434655] hover:text-[#191c1e]"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-[12px] bg-[#f2f4f6] p-4 rounded-lg">
                <div>
                  <span className="text-[#737686]">错误规则代码：</span>
                  <div className="font-mono font-bold text-[#004ac6]">
                    {inspectingCategory.code}
                  </div>
                </div>
                <div>
                  <span className="text-[#737686]">精细化分类：</span>
                  <div className="font-semibold text-[#191c1e]">
                    {inspectingCategory.subCategory}
                  </div>
                </div>
                <div>
                  <span className="text-[#737686]">HTTP 状态码：</span>
                  <div className="font-bold text-[#ba1a1a]">
                    HTTP {inspectingCategory.statusCode}
                  </div>
                </div>
                <div>
                  <span className="text-[#737686]">爆发模型与渠道：</span>
                  <div className="font-semibold text-[#191c1e]">
                    {inspectingCategory.topModel} ({inspectingCategory.topChannel})
                  </div>
                </div>
                <div>
                  <span className="text-[#737686]">小时/日统计：</span>
                  <div className="font-bold text-[#ba1a1a]">
                    {inspectingCategory.hourlyErrorCount} 次/小时 | {inspectingCategory.dailyErrorCount} 次/天
                  </div>
                </div>
                <div>
                  <span className="text-[#737686]">告警规则状态：</span>
                  <div className="font-semibold">
                    {inspectingCategory.suppressed
                      ? '🔕 标记误报 (已屏蔽)'
                      : inspectingCategory.isAlertEnabled
                      ? '🟢 开启推送'
                      : '⚪ 已关闭'}
                  </div>
                </div>
              </div>

              {/* Display Raw Logs from Prompt */}
              <div className="space-y-2">
                <label className="text-[13px] font-bold text-[#191c1e] flex items-center justify-between">
                  <span>采样采集到的真实 Gateway 日志条目 ({inspectingCategory.rawLogs.length || 1} 条)：</span>
                  <span className="text-[11px] font-normal text-[#737686]">
                    提取自 content 与 other 扩展 JSON
                  </span>
                </label>

                {inspectingCategory.rawLogs.length > 0 ? (
                  inspectingCategory.rawLogs.map((logItem) => (
                    <div key={logItem.id} className="bg-[#1e1e1e] p-4 rounded-lg space-y-2">
                      <div className="flex justify-between items-center text-[11px] border-b border-[#333] pb-2 text-[#9cdcfe]">
                        <span className="font-mono">Log ID: #{logItem.id} | User: {logItem.username} ({logItem.group})</span>
                        <span className="font-mono text-[#ce9178]">Model: {logItem.model_name} | Channel: {logItem.channel_name}</span>
                      </div>

                      <div className="space-y-1 text-[11.5px] font-mono">
                        <div className="text-[#4ec9b0] font-bold">content:</div>
                        <div className="text-[#dcdcaa] bg-[#2d2d2d] p-2 rounded leading-[16px] overflow-x-auto">
                          {logItem.content}
                        </div>
                      </div>

                      <div className="space-y-1 text-[11.5px] font-mono">
                        <div className="text-[#ce9178] font-bold">other (JSON):</div>
                        <div className="text-[#9cdcfe] bg-[#2d2d2d] p-2 rounded leading-[16px] overflow-x-auto">
                          {logItem.other}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="bg-[#1e1e1e] text-[#4ec9b0] p-4 rounded-lg font-mono text-[12px] leading-[18px]">
                    {inspectingCategory.sampleLog}
                  </div>
                )}
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-[12px] text-blue-900 leading-[18px]">
                💡 <strong>特征提炼解析说明：</strong> 系统能够依据 <code className="font-mono bg-blue-100 px-1 rounded">content</code> 中的报错信息（如 <code className="font-mono">unexpected tool_use_id</code> 或 <code className="font-mono">Overloaded</code>）结合 <code className="font-mono bg-blue-100 px-1 rounded">other</code> 中的 <code className="font-mono">request_path</code> 与 <code className="font-mono">status_code</code> 进行复合正则命中，实现自动下钻分类。
              </div>

              <div className="pt-3 flex justify-end gap-2 border-t border-[#e0e3e5]">
                <button
                  onClick={() => setInspectingCategory(null)}
                  className="px-4 py-2 text-[#434655] text-[13px] font-medium hover:bg-[#e0e3e5] rounded-lg"
                >
                  关闭
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Custom Error Scan Rule Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-md rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
              <h3 className="text-[16px] font-bold text-[#191c1e]">新增精细化错误分类与扫描规则</h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="text-[#434655] hover:text-[#191c1e]"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleAddSubmit} className="p-6 space-y-4 text-[13px]">
              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">错误分类代码 (Code)</label>
                <input
                  type="text"
                  required
                  value={newCode}
                  onChange={(e) => setNewCode(e.target.value)}
                  placeholder="如: ERR_400_TOOL_MISMATCH"
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6] font-mono"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">规则显示名称</label>
                <input
                  type="text"
                  required
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="如: 上下文工具调用 ID 不匹配"
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">精细化细分类描述 (SubCategory)</label>
                <input
                  type="text"
                  value={newSubCategory}
                  onChange={(e) => setNewSubCategory(e.target.value)}
                  placeholder="如: 400 - Tool Use ID Context Mismatch"
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">主错误类型</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as ErrorScanCategoryType)}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                >
                  <option value="400 参数格式错误">400 参数格式错误</option>
                  <option value="5xx 服务器错误">5xx 服务器错误</option>
                  <option value="429 频率限制">429 频率限制</option>
                  <option value="504 超时响应">504 超时响应</option>
                  <option value="401/403 鉴权异常">401/403 鉴权异常</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="font-semibold text-[#191c1e]">匹配模型</label>
                  <input
                    type="text"
                    value={newModel}
                    onChange={(e) => setNewModel(e.target.value)}
                    className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                  />
                </div>
                <div className="space-y-1">
                  <label className="font-semibold text-[#191c1e]">匹配 API 端点</label>
                  <input
                    type="text"
                    value={newEndpoint}
                    onChange={(e) => setNewEndpoint(e.target.value)}
                    className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">内容匹配关键词 / 正则</label>
                <textarea
                  rows={2}
                  value={newSampleLog}
                  onChange={(e) => setNewSampleLog(e.target.value)}
                  placeholder="如: unexpected tool_use_id found in tool_result"
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">严重级别</label>
                <select
                  value={newSeverity}
                  onChange={(e) => setNewSeverity(e.target.value as 'critical' | 'warning' | 'info')}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                >
                  <option value="critical">critical (严重)</option>
                  <option value="warning">warning (警告)</option>
                  <option value="info">info (信息)</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">关联飞书 Webhook 地址 (可选)</label>
                <input
                  type="url"
                  value={newFeishuUrl}
                  onChange={(e) => setNewFeishuUrl(e.target.value)}
                  placeholder={globalFeishuUrl}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
                <p className="text-[11px] text-[#737686]">留空则默认使用全局飞书告警 Webhook 地址。</p>
              </div>

              <div className="pt-2 flex justify-end gap-2 border-t border-[#e0e3e5]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 text-[#434655] font-medium hover:bg-[#e0e3e5] rounded-lg"
                >
                  取消
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-[#004ac6] text-white font-medium rounded-lg hover:opacity-90"
                >
                  保存细化规则
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Single Category Feishu Webhook Modal */}
      {editingFeishuCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-lg rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#004ac6]">chat</span>
                <h3 className="text-[16px] font-bold text-[#191c1e]">
                  修改规则关联的飞书 Webhook 地址
                </h3>
              </div>
              <button
                onClick={() => setEditingFeishuCategory(null)}
                className="text-[#434655] hover:text-[#191c1e]"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4">
              <div className="bg-[#eeefff] p-3 rounded-lg text-[12px] space-y-1 border border-[#b4c5ff]">
                <div className="font-bold text-[#004ac6]">{editingFeishuCategory.name}</div>
                <div className="text-[#434655] font-mono text-[11px]">
                  编码: {editingFeishuCategory.code} | 分类: {editingFeishuCategory.subCategory}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-[13px] font-semibold text-[#191c1e]">
                  飞书机器人 Webhook 地址 (URL) *
                </label>
                <input
                  type="url"
                  required
                  value={editingFeishuUrlInput}
                  onChange={(e) => setEditingFeishuUrlInput(e.target.value)}
                  placeholder="https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3.5 py-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
                <p className="text-[11px] text-[#737686]">
                  在飞书群组设置 -&gt; 群机器人 -&gt; 添加自定义机器人 -&gt; 复制 Webhook 地址粘贴至此处。
                </p>
              </div>

              <div className="pt-3 border-t border-[#e0e3e5] flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingFeishuCategory(null)}
                  className="px-4 py-2 text-[#434655] text-[13px] font-medium hover:bg-[#e0e3e5] rounded-lg"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (onUpdateFeishuWebhookUrl) {
                      onUpdateFeishuWebhookUrl(editingFeishuCategory.id, editingFeishuUrlInput);
                    }
                    setEditingFeishuCategory(null);
                  }}
                  className="px-5 py-2 bg-[#004ac6] text-white text-[13px] font-medium rounded-lg hover:opacity-90 shadow-2xs"
                >
                  保存飞书地址关联
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Exclude & Threshold Edit Modal */}
      {editingExcludes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-sm rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden animate-scale-in">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#004ac6]">tune</span>
                <h3 className="text-[16px] font-bold text-[#191c1e]">告警阈值 & 排除设置</h3>
              </div>
              <button
                onClick={() => setEditingExcludes(null)}
                className="text-[#434655] hover:text-[#191c1e]"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6 space-y-4 text-[13px]">
              <div className="text-[#434655] font-medium">
                规则: <span className="text-[#191c1e]">{editingExcludes.name}</span>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">告警阈值 (次)</label>
                <input
                  type="number"
                  min={1}
                  value={thresholdInput}
                  onChange={(e) => setThresholdInput(parseInt(e.target.value) || 1)}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                />
                <p className="text-[11px] text-[#737686]">单周期内超过此次数即触发告警</p>
              </div>

              {/* FilterMode Toggle */}
              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">过滤模式</label>
                <div className="flex bg-[#f2f4f6] p-1 rounded-lg border border-[#c3c6d7]">
                  <button
                    type="button"
                    onClick={() => setFilterModeInput('exclude')}
                    className={`flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                      filterModeInput === 'exclude'
                        ? 'bg-white text-[#ba1a1a] font-bold shadow-xs'
                        : 'text-[#434655] hover:text-[#191c1e]'
                    }`}
                  >
                    排除
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterModeInput('include')}
                    className={`flex-1 py-1.5 text-[12px] font-medium rounded-md transition-all ${
                      filterModeInput === 'include'
                        ? 'bg-white text-[#004ac6] font-bold shadow-xs'
                        : 'text-[#434655] hover:text-[#191c1e]'
                    }`}
                  >
                    仅选中
                  </button>
                </div>
                <p className="text-[11px] text-[#737686]">
                  {filterModeInput === 'exclude'
                    ? '排除指定项，其余项正常触发告警'
                    : '仅所选中的项触发告警，其余忽略'}
                </p>
              </div>

              {/* Severity */}
              <div className="space-y-1">
                <label className="font-semibold text-[#191c1e]">严重级别</label>
                <select
                  value={editingExcludes.severity}
                  onChange={(e) => {
                    // Update severity on the category object directly for the modal save
                    const updated = { ...editingExcludes, severity: e.target.value as 'critical' | 'warning' | 'info' };
                    setEditingExcludes(updated);
                  }}
                  className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6] text-[13px]"
                >
                  <option value="critical">critical (严重)</option>
                  <option value="warning">warning (警告)</option>
                  <option value="info">info (信息)</option>
                </select>
              </div>

              {editingExcludes.alertGranularity === '按渠道' && (
                <div className="space-y-1">
                  <label className="font-semibold text-[#191c1e]">渠道</label>
                  <input
                    type="text"
                    value={excludeChannelsInput}
                    onChange={(e) => setExcludeChannelsInput(e.target.value)}
                    placeholder="如: 渠道A, 渠道B"
                    className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                  />
                  <p className="text-[11px] text-[#737686]">
                    {filterModeInput === 'exclude'
                      ? '逗号分隔，这些渠道的错误不触发告警'
                      : '逗号分隔，仅这些渠道的错误触发告警'}
                  </p>
                </div>
              )}

              {editingExcludes.alertGranularity === '按用户' && (
                <div className="space-y-1">
                  <label className="font-semibold text-[#191c1e]">用户</label>
                  <input
                    type="text"
                    value={excludeUsersInput}
                    onChange={(e) => setExcludeUsersInput(e.target.value)}
                    placeholder="如: zhangsan, lisi"
                    className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-[#004ac6]"
                  />
                  <p className="text-[11px] text-[#737686]">
                    {filterModeInput === 'exclude'
                      ? '逗号分隔，这些用户的错误不触发告警'
                      : '逗号分隔，仅这些用户的错误触发告警'}
                  </p>
                </div>
              )}

              <div className="pt-2 flex justify-end gap-2 border-t border-[#e0e3e5]">
                <button
                  type="button"
                  onClick={() => setEditingExcludes(null)}
                  className="px-4 py-2 text-[#434655] text-[13px] font-medium hover:bg-[#e0e3e5] rounded-lg"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onUpdateThresholdExcludes(
                      editingExcludes.id,
                      thresholdInput,
                      excludeChannelsInput,
                      excludeUsersInput,
                      filterModeInput
                    );
                    setEditingExcludes(null);
                  }}
                  className="px-5 py-2 bg-[#004ac6] text-white text-[13px] font-medium rounded-lg hover:opacity-90"
                >
                  保存设置
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Error Samples Panel */}
      {showSamplesPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden animate-scale-in flex flex-col">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6] shrink-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[#004ac6]">description</span>
                <h3 className="text-[16px] font-bold text-[#191c1e]">
                  最近 {errorSamples.length} 条不同错误类型日志样本 (type=5)
                </h3>
              </div>
              <button
                onClick={() => setShowSamplesPanel(false)}
                className="text-[#434655] hover:text-[#191c1e]"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              {samplesLoading ? (
                <div className="text-center py-10 text-[#737686]">加载中...</div>
              ) : errorSamples.length === 0 ? (
                <div className="text-center py-10 text-[#737686]">暂无 type=5 错误日志</div>
              ) : (
                errorSamples.map((sample, idx) => (
                  <div key={idx} className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 space-y-3">
                    <div className="flex items-center gap-3 text-[11px] text-[#737686] flex-wrap">
                      <span className="font-semibold text-[#191c1e]">#{idx + 1}</span>
                      <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono">
                        {sample.cnt} 次
                      </span>
                      <span className="bg-[#d0e1fb] text-[#003ea8] px-1.5 py-0.5 rounded">
                        🤖 {sample.model_name || '未知模型'}
                      </span>
                      <span className="bg-[#d0e1fb] text-[#003ea8] px-1.5 py-0.5 rounded">
                        📡 {sample.channel_name || '未知渠道'}
                      </span>
                      <span className="bg-[#e0e3e5] text-[#434655] px-1.5 py-0.5 rounded">
                        👥 {sample.group_name || '默认组'}
                      </span>
                    </div>

                    <div className="space-y-2">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-[#434655]">content:</span>
                          <button
                            onClick={() => {
                              copyToClipboard(sample.content);
                              onShowToast('已复制 content');
                            }}
                            className="text-[10px] text-[#004ac6] hover:underline"
                          >
                            复制
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono text-[#191c1e] bg-[#1e1e1e] text-[#dcdcaa] p-3 rounded leading-[16px] overflow-x-auto whitespace-pre-wrap max-h-[120px] overflow-y-auto">
                          {sample.content}
                        </pre>
                      </div>

                      {sample.other && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-[#434655]">other:</span>
                            <button
                              onClick={() => {
                                copyToClipboard(sample.other);
                                onShowToast('已复制 other');
                              }}
                              className="text-[10px] text-[#004ac6] hover:underline"
                            >
                              复制
                            </button>
                          </div>
                          <pre className="text-[11px] font-mono text-[#9cdcfe] bg-[#1e1e1e] p-3 rounded leading-[16px] overflow-x-auto whitespace-pre-wrap max-h-[100px] overflow-y-auto">
                            {sample.other}
                          </pre>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Unmatched Samples Panel */}
      {showUnmatchedPanel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#2d3133]/50 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="bg-white w-full max-w-4xl max-h-[85vh] rounded-xl shadow-2xl border border-[#c3c6d7] overflow-hidden animate-scale-in flex flex-col">
            <div className="px-6 py-4 border-b border-[#c3c6d7] flex justify-between items-center bg-[#f2f4f6] shrink-0">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-amber-600">warning</span>
                <h3 className="text-[16px] font-bold text-[#191c1e]">
                  未匹配错误日志样本 ({unmatchedSamples.length} 条)
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleRefreshUnmatched}
                  disabled={unmatchedLoading}
                  className="px-3 py-1.5 bg-white border border-[#c3c6d7] text-[#434655] text-[12px] font-medium rounded-lg hover:bg-[#eeefff] transition-colors flex items-center gap-1"
                >
                  <span className={`material-symbols-outlined text-[16px] ${unmatchedLoading ? 'animate-spin' : ''}`}>
                    sync
                  </span>
                  刷新
                </button>
                <button
                  onClick={() => setShowUnmatchedPanel(false)}
                  className="text-[#434655] hover:text-[#191c1e]"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            <div className="overflow-y-auto p-4 space-y-4">
              {unmatchedLoading ? (
                <div className="text-center py-10 text-[#737686]">加载中...</div>
              ) : unmatchedSamples.length === 0 ? (
                <div className="text-center py-10 text-[#737686]">暂无未匹配的错误日志</div>
              ) : (
                unmatchedSamples.map((sample) => (
                  <div key={sample.id} className="bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex items-center gap-3 text-[11px] text-[#737686] flex-wrap">
                        <span className="font-semibold text-[#191c1e]">#{sample.id}</span>
                        <span className="bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-mono">
                          {sample.cnt} 次
                        </span>
                        <span className="bg-[#d0e1fb] text-[#003ea8] px-1.5 py-0.5 rounded">
                          {sample.model_name || '未知模型'}
                        </span>
                        <span className="bg-[#d0e1fb] text-[#003ea8] px-1.5 py-0.5 rounded">
                          {sample.channel_name || '未知渠道'}
                        </span>
                        <span className="bg-[#e0e3e5] text-[#434655] px-1.5 py-0.5 rounded">
                          {sample.username || '匿名用户'}
                        </span>
                      </div>
                      <button
                        onClick={() => handleOpenConvertForm(sample)}
                        className="px-3 py-1.5 bg-[#004ac6] hover:bg-[#003ea8] text-white text-[11px] font-bold rounded-lg transition-all flex items-center gap-1 shadow-2xs shrink-0"
                      >
                        <span className="material-symbols-outlined text-[14px]">add_task</span>
                        转为规则
                      </button>
                    </div>

                    {/* Content & Other display */}
                    <div className="space-y-2">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[11px] font-semibold text-[#434655]">content:</span>
                          <button
                            onClick={() => {
                              copyToClipboard(sample.content);
                              onShowToast('已复制 content');
                            }}
                            className="text-[10px] text-[#004ac6] hover:underline"
                          >
                            复制
                          </button>
                        </div>
                        <pre className="text-[11px] font-mono text-[#dcdcaa] bg-[#1e1e1e] p-3 rounded leading-[16px] overflow-x-auto whitespace-pre-wrap max-h-[100px] overflow-y-auto">
                          {sample.content}
                        </pre>
                      </div>

                      {sample.other && (
                        <div>
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-semibold text-[#434655]">other:</span>
                            <button
                              onClick={() => {
                                copyToClipboard(sample.other);
                                onShowToast('已复制 other');
                              }}
                              className="text-[10px] text-[#004ac6] hover:underline"
                            >
                              复制
                            </button>
                          </div>
                          <pre className="text-[11px] font-mono text-[#9cdcfe] bg-[#1e1e1e] p-3 rounded leading-[16px] overflow-x-auto whitespace-pre-wrap max-h-[100px] overflow-y-auto">
                            {sample.other}
                          </pre>
                        </div>
                      )}
                    </div>

                    {/* Inline Conversion Form */}
                    {convertingSample?.id === sample.id && (
                      <div className="bg-[#eeefff] border border-[#b4c5ff] rounded-lg p-4 space-y-3 mt-2">
                        <h4 className="text-[13px] font-bold text-[#004ac6] flex items-center gap-1.5">
                          <span className="material-symbols-outlined text-[16px]">edit_note</span>
                          转换为规则
                        </h4>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-[#434655]">规则代码 (Code)</label>
                            <input
                              type="text"
                              value={convertCode}
                              onChange={(e) => setConvertCode(e.target.value)}
                              className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 font-mono text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[11px] font-semibold text-[#434655]">规则名称</label>
                            <input
                              type="text"
                              value={convertName}
                              onChange={(e) => setConvertName(e.target.value)}
                              className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <label className="text-[11px] font-semibold text-[#434655]">主错误类型</label>
                          <select
                            value={convertCategory}
                            onChange={(e) => setConvertCategory(e.target.value)}
                            className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
                          >
                            <option value="400 参数格式错误">400 参数格式错误</option>
                            <option value="5xx 服务器错误">5xx 服务器错误</option>
                            <option value="429 频率限制">429 频率限制</option>
                            <option value="504 超时响应">504 超时响应</option>
                            <option value="401/403 鉴权异常">401/403 鉴权异常</option>
                            <option value="其他参数/网络错误">其他参数/网络错误</option>
                          </select>
                        </div>

                        <div className="flex justify-end gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setConvertingSample(null)}
                            className="px-3 py-1.5 text-[#434655] text-[12px] font-medium hover:bg-[#e0e3e5] rounded-lg"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={handleSubmitConvert}
                            className="px-4 py-1.5 bg-[#004ac6] text-white text-[12px] font-medium rounded-lg hover:opacity-90"
                          >
                            确认创建规则
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'classify' && (<>

      {/* Classify Rules Management Panel */}
      <div className="bg-white border border-[#b4c5ff] rounded-xl shadow-sm p-5 space-y-4">
        <h3 className="text-[15px] font-bold text-[#1c1e2b] flex items-center gap-2">
          <span className="material-symbols-outlined text-[20px] text-[#004ac6]">category</span>
          错误分类规则管理
          <span className="text-[10px] px-1.5 py-0.5 bg-[#004ac6] text-white rounded-full ml-2">
            {classifyRules.length || '...'}
          </span>
        </h3>

        {/* Add / Edit rule form */}
        <div className="bg-[#f8f9fc] border border-[#e0e3e5] rounded-lg p-4 space-y-3">
          <h4 className="text-[13px] font-bold text-[#004ac6]">
            {editingClassifyRule ? '编辑分类规则' : '添加新分类规则'}
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[#434655]">关键词 *</label>
              <input
                type="text"
                value={editingClassifyRule ? editingClassifyRule.keyword : newClassifyKeyword}
                onChange={(e) => editingClassifyRule
                  ? setEditingClassifyRule({ ...editingClassifyRule, keyword: e.target.value })
                  : setNewClassifyKeyword(e.target.value)
                }
                placeholder="如: model_not_found"
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[#434655]">状态码 (0=不限)</label>
              <input
                type="number"
                value={editingClassifyRule ? editingClassifyRule.status_code : newClassifyStatusCode}
                onChange={(e) => editingClassifyRule
                  ? setEditingClassifyRule({ ...editingClassifyRule, status_code: Number(e.target.value) })
                  : setNewClassifyStatusCode(Number(e.target.value))
                }
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[#434655]">主分类</label>
              <select
                value={editingClassifyRule ? editingClassifyRule.category : newClassifyCategory}
                onChange={(e) => editingClassifyRule
                  ? setEditingClassifyRule({ ...editingClassifyRule, category: e.target.value })
                  : setNewClassifyCategory(e.target.value)
                }
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
              >
                <option value="5xx 服务器错误">5xx 服务器错误</option>
                <option value="4xx 客户端错误">4xx 客户端错误</option>
                <option value="400 参数格式错误">400 参数格式错误</option>
                <option value="401 鉴权错误">401 鉴权错误</option>
                <option value="403 权限错误">403 权限错误</option>
                <option value="429 频率限制">429 频率限制</option>
                <option value="其他参数/网络错误">其他参数/网络错误</option>
              </select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-semibold text-[#434655]">子分类 *</label>
              <input
                type="text"
                value={editingClassifyRule ? editingClassifyRule.sub_category : newClassifySubCategory}
                onChange={(e) => editingClassifyRule
                  ? setEditingClassifyRule({ ...editingClassifyRule, sub_category: e.target.value })
                  : setNewClassifySubCategory(e.target.value)
                }
                placeholder="如: 404 - Model Not Found"
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
              />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-semibold text-[#434655]">建议操作</label>
              <input
                type="text"
                value={editingClassifyRule ? editingClassifyRule.recommendation : newClassifyRecommendation}
                onChange={(e) => editingClassifyRule
                  ? setEditingClassifyRule({ ...editingClassifyRule, recommendation: e.target.value })
                  : setNewClassifyRecommendation(e.target.value)
                }
                placeholder="如: 检查模型名称或路由配置是否正确"
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[11px] font-semibold text-[#434655]">优先级 (越大越优先)</label>
              <input
                type="number"
                value={editingClassifyRule ? editingClassifyRule.priority : newClassifyPriority}
                onChange={(e) => editingClassifyRule
                  ? setEditingClassifyRule({ ...editingClassifyRule, priority: Number(e.target.value) })
                  : setNewClassifyPriority(Number(e.target.value))
                }
                className="w-full bg-white border border-[#c3c6d7] rounded-lg px-3 py-1.5 text-[12px] outline-none focus:ring-2 focus:ring-[#004ac6]"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {editingClassifyRule && (
              <button
                onClick={() => setEditingClassifyRule(null)}
                className="px-4 py-1.5 text-[12px] text-[#737686] hover:text-[#191c1e] font-medium rounded-lg"
              >
                取消
              </button>
            )}
            <button
              onClick={editingClassifyRule ? handleUpdateClassifyRule : handleAddClassifyRule}
              className="px-4 py-1.5 bg-[#004ac6] text-white text-[12px] font-medium rounded-lg hover:opacity-90"
            >
              {editingClassifyRule ? '保存修改' : '添加规则'}
            </button>
          </div>
        </div>

        {/* Rules list */}
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-semibold text-[#434655]">已配置 {classifyRules.length} 条</span>
          {(() => {
            const seen = new Map<string, number[]>();
            classifyRules.forEach((r) => {
              const key = r.keyword.toLowerCase();
              if (!seen.has(key)) seen.set(key, []);
              seen.get(key)!.push(r.id);
            });
            const dupCount = Array.from(seen.values()).filter(ids => ids.length > 1).length;
            return dupCount > 0 ? (
              <button
                onClick={async () => {
                  const seen2 = new Map<string, ClassifyRule[]>();
                  classifyRules.forEach((r) => {
                    const key = r.keyword.toLowerCase();
                    if (!seen2.has(key)) seen2.set(key, []);
                    seen2.get(key)!.push(r);
                  });
                  let mergedCount = 0;
                  for (const [key, rules] of seen2.entries()) {
                    if (rules.length <= 1) continue;
                    // 保留优先级最高的，删除其余
                    const sorted = [...rules].sort((a, b) => b.priority - a.priority);
                    for (let i = 1; i < sorted.length; i++) {
                      try {
                        await deleteClassifyRule(sorted[i].id);
                        mergedCount++;
                      } catch {}
                    }
                  }
                  onShowToast(`已清理 ${mergedCount} 条重复关键词`);
                  loadClassifyRules();
                }}
                className="px-2.5 py-1 text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors"
              >
                合并去重 ({dupCount} 组重复)
              </button>
            ) : null;
          })()}
        </div>
        <div className="space-y-2 max-h-[400px] overflow-y-auto">
          {classifyRules.length === 0 ? (
            <p className="text-[12px] text-[#80848f] text-center py-4">暂无分类规则，启动时会自动写入默认规则</p>
          ) : (
            classifyRules.map((rule) => (
              <div
                key={rule.id}
                className="flex items-center justify-between bg-[#f8f9fc] border border-[#e0e3e5] rounded-lg px-4 py-2.5 hover:border-[#b4c5ff] transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                    rule.status_code >= 500 ? 'bg-[#ffe0e0] text-[#c62828]' :
                    rule.status_code >= 400 ? 'bg-[#fff3e0] text-[#e65100]' :
                    rule.status_code > 0 ? 'bg-[#fff9c4] text-[#f57f17]' :
                    'bg-[#e8eaf6] text-[#283593]'
                  }`}>
                    {rule.status_code || '*'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-semibold text-[#1c1e2b] truncate">{rule.keyword}</div>
                    <div className="text-[11px] text-[#80848f] truncate">{rule.sub_category}</div>
                  </div>
                  <span className="text-[10px] text-[#80848f] bg-[#e0e3e5] px-1.5 py-0.5 rounded whitespace-nowrap">
                    P{rule.priority}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setEditingClassifyRule(rule)}
                    className="p-1.5 text-[#80848f] hover:text-[#004ac6] hover:bg-[#d0e1fb] rounded-lg transition-colors flex-shrink-0"
                    title="编辑"
                  >
                    <span className="material-symbols-outlined text-[16px]">edit</span>
                  </button>
                  <button
                    onClick={() => handleDeleteClassifyRule(rule.id)}
                    className="p-1.5 text-[#80848f] hover:text-[#c62828] hover:bg-[#ffe0e0] rounded-lg transition-colors flex-shrink-0"
                    title="删除"
                  >
                    <span className="material-symbols-outlined text-[16px]">delete</span>
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      </>)}
      
      {/* 错误详情弹窗 */}
      {detailModalItem && (
        <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh] bg-black/40" onClick={() => setDetailModalItem(null)}>
          <div className="bg-white rounded-xl shadow-2xl border border-[#c3c6d7] w-full max-w-2xl mx-4 max-h-[75vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-[#e0e3e5] bg-[#f2f4f6]">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-[#c62828]">error</span>
                <span className="text-[14px] font-semibold text-[#191c1e]">错误详情</span>
              </div>
              <button
                onClick={() => setDetailModalItem(null)}
                className="p-1.5 text-[#737686] hover:text-[#191c1e] hover:bg-[#e0e3e5] rounded-lg transition-colors"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>
            <div className="p-5 overflow-y-auto space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-[#737686] uppercase tracking-wide">错误内容</label>
                <div className="mt-1 p-3 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg text-[13px] text-[#191c1e] break-all font-mono leading-relaxed">
                  {detailModalItem.content}
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] font-semibold text-[#737686]">模型</label>
                  <div className="mt-0.5 text-[13px] text-[#191c1e]">{detailModalItem.model_name || '-'}</div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#737686]">渠道</label>
                  <div className="mt-0.5 text-[13px] text-[#191c1e]">
                    {detailModalItem.channel_name || (detailModalItem.channel_id ? `渠道#${detailModalItem.channel_id}` : '-')}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#737686]">用户</label>
                  <div className="mt-0.5 text-[13px] text-[#191c1e]">{detailModalItem.username || '-'}</div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#737686]">用户组</label>
                  <div className="mt-0.5 text-[13px] text-[#191c1e]">{detailModalItem.group_name || '-'}</div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#737686]">时间</label>
                  <div className="mt-0.5 text-[13px] text-[#191c1e] font-mono">
                    {new Date(detailModalItem.created_at * 1000).toLocaleString('zh-CN')}
                  </div>
                </div>
                <div>
                  <label className="text-[11px] font-semibold text-[#737686]">日志 ID</label>
                  <div className="mt-0.5 text-[13px] text-[#737686] font-mono">#{detailModalItem.id}</div>
                </div>
              </div>
              {detailModalItem.other && (
                <div>
                  <label className="text-[11px] font-semibold text-[#737686] uppercase tracking-wide">附加信息 (Other)</label>
                  <div className="mt-1 p-3 bg-[#f7f9fb] border border-[#e0e3e5] rounded-lg text-[12px] text-[#434655] break-all font-mono max-h-[150px] overflow-y-auto">
                    {detailModalItem.other}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
