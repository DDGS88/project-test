export type RuleType = 'Regex' | 'Error Rate' | 'Token' | 'Latency';

export type MainTab = 'dashboard' | 'alert-rules' | 'error-scan' | 'notification-channels' | 'api-keys' | 'cache-hit-rate' | 'channel-error-rate' | 'channel-probe' | 'veridrop';

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

// ── 渠道探测 ──

// 可用性探测配置：按 cron 对白名单渠道的模型逐一发最小请求
export interface ProbeAvailabilityConfig {
  enabled: boolean;
  cron: string;                       // 标准 5 字段 cron，如 "0 */6 * * *"
  channel_ids: number[];              // 渠道白名单，空数组表示全部满足条件的渠道
  max_models_per_channel: number;     // 0 表示不限
  concurrency: number;
  timeout_sec: number;
  max_tokens: number;
  prompt: string;
  cooldown_sec: number;
  feishu_webhook: string;
  at_users: string;                   // 逗号分隔的 open_id
}

// 质量探测配置：从最近一次可用性探测成功结果中随机抽样，调用 veridrop 做真伪/质量检测
export interface ProbeQualityConfig {
  enabled: boolean;
  cron: string;
  mode: string;                       // 'standard' | 'full'
  score_threshold: number;
  timeout_sec: number;
  cooldown_sec: number;
  feishu_webhook: string;
  at_users: string;
}

// 探测任务运行时状态（时间字段为 RFC3339，可能为空字符串）
export interface ProbeRuntimeStatus {
  running: boolean;
  next_run_at: string;
  last_run_at: string;
  last_status: string;
  last_run_id: number;
  total: number;
  ok_count: number;
  fail_count: number;
  skip_count: number;
}

// 配置聚合响应
export interface ProbeConfigResponse {
  availability: ProbeAvailabilityConfig;
  quality: ProbeQualityConfig;
  runtime: {
    availability: ProbeRuntimeStatus;
    quality: ProbeRuntimeStatus;
  };
}

// 探测运行批次
export interface ProbeRun {
  id: number;
  kind: 'availability' | 'quality';
  trigger: 'cron' | 'manual';
  status: 'running' | 'done' | 'failed';
  started_at: string;
  finished_at: string;                // 运行中时可能为空
  total: number;
  ok_count: number;
  fail_count: number;
  skip_count: number;
  message: string;
}

// 单条探测明细
export interface ProbeResult {
  id: number;
  run_id: number;
  kind: 'availability' | 'quality';
  channel_id: number;
  channel_name: string;
  model: string;
  status: 'ok' | 'fail' | 'skip';
  status_code: number;                // 质量结果该字段为 0
  latency_ms: number;                 // 质量结果该字段为 0
  error: string;
  score: number;                      // 可用性结果该字段为空值
  verdict: string;                    // 可用性结果该字段为空
  report_url: string;                 // 可用性结果该字段为空
  probed_at: string;
}
