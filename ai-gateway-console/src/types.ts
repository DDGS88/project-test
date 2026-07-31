export type RuleType = 'Regex' | 'Error Rate' | 'Token' | 'Latency';

export type MainTab = 'dashboard' | 'alert-rules' | 'notification-channels' | 'api-keys';

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
