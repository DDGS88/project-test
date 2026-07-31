import type { AlertRule } from '../types';

const BASE = '/api/v1';

const TOKEN_KEY = 'tt-inspector-token';

function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function hasToken(): boolean {
  return !!getToken();
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${url}`, { headers, ...options });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.reload();
    }
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

// ── 后端数据模型 ──

interface BackendRule {
  id: number;
  name: string;
  enabled: boolean;
  rule_type: string;
  condition: string;       // JSON 字符串
  window_sec: number;
  threshold: number;
  cooldown_sec: number;
  webhook_url: string;
  description: string;
  created_at: string;
  updated_at: string;
}

function parseCondition(condition: string): { channel_id?: number; pattern?: string; field?: string; model_name?: string; negate?: boolean; exclude_empty?: boolean } {
  try { return JSON.parse(condition); } catch { return {}; }
}

// ── 映射函数 ──

interface SaveRuleData extends Partial<AlertRule> {
  channelId?: number;
  matchField?: string;
}

function backendToFrontend(b: BackendRule): AlertRule {
  const cond = parseCondition(b.condition);
  const channelId = cond.channel_id || 0;
  return {
    id: String(b.id),
    name: b.name,
    type: mapRuleType(b.rule_type),
    enabled: b.enabled,
    channel: channelId > 0 ? `渠道 #${channelId}` : '全部渠道',
    model: cond.model_name || '全部模型',
    windowSeconds: b.window_sec,
    thresholdValue: `> ${b.threshold}`,
    thresholdNumber: b.threshold,
    lastTriggered: '',
    pattern: cond.pattern || '',
    webhookUrl: b.webhook_url,
    description: b.description,
    cooldownSeconds: b.cooldown_sec,
    triggerCount: 0,
    createdAt: b.created_at,
    // 内部字段（编辑回填用）
    _channelId: cond.channel_id,
    _matchField: cond.field || 'content',
    _negate: cond.negate || false,
    _excludeEmpty: cond.exclude_empty || false,
  };
}

function frontendToBackend(r: SaveRuleData): Partial<BackendRule> {
  const condition: Record<string, unknown> = {};
  if (r.channelId) condition.channel_id = r.channelId;
  if (r.matchField) condition.field = r.matchField;
  if (r.pattern) condition.pattern = r.pattern;
  if (r.model && r.model !== '全部模型') condition.model_name = r.model;
  if ((r as any)._negate) condition.negate = true;
  if ((r as any)._excludeEmpty) condition.exclude_empty = true;

  return {
    name: r.name,
    enabled: r.enabled,
    rule_type: r.type ? unmapRuleType(r.type) : undefined,
    condition: JSON.stringify(condition),
    window_sec: r.windowSeconds,
    threshold: r.thresholdNumber,
    cooldown_sec: r.cooldownSeconds,
    webhook_url: r.webhookUrl,
    description: r.description,
  };
}

function mapRuleType(t: string): AlertRule['type'] {
  switch (t) {
    case 'regex': return 'Regex';
    case 'error_rate': return 'Error Rate';
    case 'token_threshold': return 'Token';
    default: return t as AlertRule['type'];
  }
}

function unmapRuleType(t: string): string {
  switch (t) {
    case 'Regex': return 'regex';
    case 'Error Rate': return 'error_rate';
    case 'Token': return 'token_threshold';
    case 'Latency': return 'latency';
    default: return t;
  }
}

// ── 规则 CRUD ──

export async function listRules(): Promise<AlertRule[]> {
  const res = await request<{ data: BackendRule[] }>('/rules');
  return (res.data || []).map(backendToFrontend);
}

export async function createRule(rule: SaveRuleData): Promise<AlertRule> {
  const res = await request<{ data: BackendRule }>('/rules', {
    method: 'POST',
    body: JSON.stringify(frontendToBackend(rule)),
  });
  return backendToFrontend(res.data);
}

export async function updateRule(id: string, rule: SaveRuleData): Promise<AlertRule> {
  const res = await request<{ data: BackendRule }>(`/rules/${id}`, {
    method: 'PUT',
    body: JSON.stringify(frontendToBackend(rule)),
  });
  return backendToFrontend(res.data);
}

export async function deleteRule(id: string): Promise<void> {
  await request(`/rules/${id}`, { method: 'DELETE' });
}

export async function enableRule(id: string): Promise<void> {
  await request(`/rules/${id}/enable`, { method: 'POST' });
}

export async function disableRule(id: string): Promise<void> {
  await request(`/rules/${id}/disable`, { method: 'POST' });
}

// ── 渠道 / 模型 ──

export interface ChannelOption {
  id: number;
  name: string;
}

export interface ChannelWithModels {
  channel_id: number;
  name: string;
  tag?: string;
  models: string[];
}

export async function listChannels(): Promise<ChannelOption[]> {
  const res = await request<{ data: ChannelOption[] }>('/channels');
  return res.data || [];
}

export async function listChannelsWithModels(): Promise<ChannelWithModels[]> {
  const res = await request<{ data: ChannelWithModels[] }>('/channels/with-models');
  return res.data || [];
}
