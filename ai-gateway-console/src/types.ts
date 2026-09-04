export type RuleType = 'Regex' | 'Error Rate' | 'Token' | 'Latency';

export type MainTab = 'dashboard' | 'alert-rules' | 'error-scan' | 'notification-channels' | 'api-keys' | 'cache-hit-rate' | 'channel-error-rate';

export type HeaderSubTab = '规则' | '监控' | '日志' | '设置';

export interface AlertRule {
  id: string;
  name: string;
  type: RuleType;
  enabled: boolean;
  channel: string;
  model: string;
  windowSeconds: number;
  thresholdValue: string;
  thresholdNumber?: number;
  lastTriggered?: string;
  pattern?: string;
  webhookUrl: string;
  description?: string;
  cooldownSeconds: number;
  triggerCount: number;
  createdAt: string;
  // 内部字段（编辑回填用）
  _channelId?: number;
  _matchField?: string;
  _negate?: boolean;
  _excludeEmpty?: boolean;
}

export interface NotificationChannel {
  id: string;
  name: string;
  type: 'feishu' | 'slack' | 'teams' | 'email' | 'webhook';
  url: string;
  status: 'active' | 'error' | 'disabled';
  lastUsed?: string;
  isDefault?: boolean;
}

export interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  fullKey?: string;
  createdAt: string;
  lastUsed: string;
  status: 'active' | 'revoked';
  rateLimit: string;
  usageToday: number;
}

export interface AlertLog {
  id: string;
  timestamp: string;
  ruleId: string;
  ruleName: string;
  type: RuleType;
  channel: string;
  model: string;
  matchedContent: string;
  status: 'delivered' | 'failed' | 'cooldown';
  webhookResponseCode: number;
  latencyMs: number;
}

export interface SystemMetrics {
  totalRequests: number;
  activeRules: number;
  triggered24h: number;
  avgLatencyMs: number;
  errorRate: number;
  tokensPerMin: number;
}

// ── 错误扫描告警 ──

export type ErrorScanCategoryType =
  | '400 参数格式错误'
  | '5xx 服务器错误'
  | '429 频率限制'
  | '504 超时响应'
  | '401/403 鉴权异常'
  | '其他参数/网络错误';

export type ScanGranularity = '小时 (Hourly)' | '天 (Daily)';

export type AlertGranularity =
  | '按错误精细类型'
  | '按模型'
  | '按渠道'
  | '按用户'
  | '按 API 接口';

export interface RawGatewayLog {
  id: number;
  user_id: number;
  created_at: number;
  type: number;
  content: string;
  username: string;
  token_name: string;
  model_name: string;
  quota: number;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  is_stream: boolean;
  channel: number;
  channel_name: string;
  token_id: number;
  group: string;
  ip: string;
  request_id: string;
  upstream_request_id: string;
  other: string;
}

export interface ErrorScanCategory {
  id: string;
  code: string;
  name: string;
  category: ErrorScanCategoryType;
  subCategory: string;
  statusCode: number;
  patternKeyword: string;
  topModel: string;
  topChannel: string;
  topUser: string;
  topEndpoint: string;
  hourlyErrorCount: number;
  dailyErrorCount: number;
  alertThreshold: number;
  sampleLog: string;
  isAlertEnabled: boolean;
  suppressed: boolean;
  scanGranularity: ScanGranularity;
  alertGranularity: AlertGranularity;
  excludeChannels: string;
  excludeUsers: string;
  filterMode: string;
  severity: 'critical' | 'warning' | 'info';
  feishuWebhookUrl: string;
  lastScannedTime?: string;
  rawLogs: RawGatewayLog[];
}
