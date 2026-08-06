package engine

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"sync"
	"time"

	"tt-inspector/internal/config"
	"tt-inspector/internal/notifier"
	"tt-inspector/internal/store"

	"go.uber.org/zap"
	"gorm.io/gorm"
)

// Engine 规则引擎
type Engine struct {
	db        *gorm.DB
	ruleStore *store.RuleStore
	logStore  *store.LogStore
	notifier  notifier.Notifier
	cfg       config.EngineConfig
	logger    *zap.Logger

	cache      []store.AlertRule
	cacheMu    sync.RWMutex
	lastReload time.Time

	cooldowns   map[int64]time.Time // ruleId -> last alert time
	cooldownsMu sync.Mutex

	checkpoint   Checkpoint
	checkpointMu sync.Mutex
	checkpointCh chan struct{} // 通知保存游标
}

// Checkpoint 扫描位点持久化
type Checkpoint struct {
	LastScanTime int64 `json:"last_scan_time"`
}

func NewEngine(
	db *gorm.DB,
	ruleStore *store.RuleStore,
	logStore *store.LogStore,
	notifier notifier.Notifier,
	cfg config.EngineConfig,
	logger *zap.Logger,
) *Engine {
	e := &Engine{
		db:           db,
		ruleStore:    ruleStore,
		logStore:     logStore,
		notifier:     notifier,
		cfg:          cfg,
		logger:       logger,
		cooldowns:    make(map[int64]time.Time),
		checkpointCh: make(chan struct{}, 1),
	}
	e.loadCheckpoint()
	return e
}

func (e *Engine) loadCheckpoint() {
	data, err := os.ReadFile(e.cfg.CheckpointFile)
	if err != nil {
		e.logger.Info("no checkpoint file found, starting from now")
		e.checkpoint.LastScanTime = time.Now().Unix()
		return
	}
	if err := json.Unmarshal(data, &e.checkpoint); err != nil {
		e.logger.Warn("failed to parse checkpoint, starting from now", zap.Error(err))
		e.checkpoint.LastScanTime = time.Now().Unix()
		return
	}
	e.logger.Info("checkpoint loaded",
		zap.Int64("last_scan_time", e.checkpoint.LastScanTime))
}

func (e *Engine) saveCheckpoint() {
	data, _ := json.Marshal(e.checkpoint)
	if err := os.WriteFile(e.cfg.CheckpointFile, data, 0644); err != nil {
		e.logger.Error("failed to save checkpoint", zap.Error(err))
	}
}

// Run 规则引擎主循环
func (e *Engine) Run(ctx context.Context) {
	e.logger.Info("engine started",
		zap.Duration("poll_interval", e.cfg.PollInterval),
		zap.Duration("rule_reload_interval", e.cfg.RuleReloadInterval))

	// 初始加载规则
	e.reloadRules()

	ticker := time.NewTicker(e.cfg.PollInterval)
	defer ticker.Stop()

	// 游标持久化定时器
	saveTicker := time.NewTicker(30 * time.Second)
	defer saveTicker.Stop()

	for {
		select {
		case <-ctx.Done():
			e.saveCheckpoint()
			e.logger.Info("engine stopped")
			return
		case <-saveTicker.C:
			e.saveCheckpoint()
		case <-ticker.C:
			e.evaluateAll()
		}
	}
}

// Shutdown 关闭引擎并保存状态
func (e *Engine) Shutdown() {
	e.saveCheckpoint()
	e.logger.Info("engine shutdown complete")
}

// ReloadRules 热加载规则
func (e *Engine) ReloadRules() {
	e.reloadRules()
}

func (e *Engine) reloadRules() {
	// 避免频繁重载
	if time.Since(e.lastReload) < e.cfg.RuleReloadInterval {
		return
	}

	rules, err := e.ruleStore.ListEnabled()
	if err != nil {
		e.logger.Error("failed to reload rules", zap.Error(err))
		return
	}

	e.cacheMu.Lock()
	e.cache = rules
	e.cacheMu.Unlock()
	e.lastReload = time.Now()

	e.logger.Info("rules reloaded", zap.Int("count", len(rules)))
}

func (e *Engine) evaluateAll() {
	// 定期重载规则
	if time.Since(e.lastReload) >= e.cfg.RuleReloadInterval {
		e.reloadRules()
	}

	e.cacheMu.RLock()
	rules := e.cache
	e.cacheMu.RUnlock()

	if len(rules) == 0 {
		return
	}

	now := time.Now()
	windowEnd := now.Unix()

	for i := range rules {
		rule := &rules[i]
		e.evaluateRule(rule, windowEnd)
	}

	// 更新游标
	e.checkpointMu.Lock()
	e.checkpoint.LastScanTime = windowEnd
	e.checkpointMu.Unlock()
}

func (e *Engine) evaluateRule(rule *store.AlertRule, windowEnd int64) {
	// 冷却期检查
	e.cooldownsMu.Lock()
	lastAlert, exists := e.cooldowns[rule.Id]
	e.cooldownsMu.Unlock()

	if exists && time.Since(lastAlert) < time.Duration(rule.CooldownSec)*time.Second {
		return
	}

	windowSec := rule.WindowSec
	if windowSec <= 0 {
		windowSec = e.cfg.DefaultWindowSec
	}
	windowStart := windowEnd - int64(windowSec)

	r := GetRule(rule.RuleType)
	if r == nil {
		e.logger.Warn("unknown rule type", zap.String("type", rule.RuleType), zap.Int64("rule_id", rule.Id))
		return
	}

	matchCount, err := r.Evaluate(e.db, rule, windowStart, windowEnd)
	if err != nil {
		e.logger.Error("rule evaluation failed",
			zap.Int64("rule_id", rule.Id),
			zap.String("type", rule.RuleType),
			zap.Error(err))
		return
	}

	if matchCount < int64(rule.Threshold) {
		return
	}

	// 触发告警
	e.logger.Warn("alert triggered",
		zap.Int64("rule_id", rule.Id),
		zap.String("name", rule.Name),
		zap.Int64("match_count", matchCount),
		zap.Int("threshold", rule.Threshold))

	// 获取匹配到的日志样本（前5条）
	samples := e.fetchSamples(rule, windowStart, windowEnd)

	msg := notifier.AlertMessage{
		RuleName:    rule.Name,
		RuleType:    rule.RuleType,
		MatchCount:  int(matchCount),
		Threshold:   rule.Threshold,
		WindowStart: time.Unix(windowStart, 0),
		WindowEnd:   time.Unix(windowEnd, 0),
		Condition:   rule.Condition,
		Description: rule.Description,
		Samples:     samples,
	}

	if err := e.notifier.Send(rule.WebhookURL, msg); err != nil {
		e.logger.Error("failed to send alert",
			zap.Int64("rule_id", rule.Id),
			zap.Error(err))
		return
	}

	// 更新冷却时间
	e.cooldownsMu.Lock()
	e.cooldowns[rule.Id] = time.Now()
	e.cooldownsMu.Unlock()

	e.logger.Info("alert sent", zap.Int64("rule_id", rule.Id), zap.String("name", rule.Name))
}

// fetchSamples 从日志中获取匹配样本（仅 regex 规则）
func (e *Engine) fetchSamples(rule *store.AlertRule, windowStart, windowEnd int64) []notifier.LogSampleItem {
	if rule.RuleType != "regex" {
		return nil
	}

	var cond RegexCondition
	if err := ParseJSON(rule.Condition, &cond); err != nil {
		return nil
	}
	if cond.Field == "" {
		cond.Field = "content"
	}

	rawSamples, err := e.logStore.GetRegexSamples(windowStart, windowEnd, cond.ChannelId, cond.Field, cond.Pattern, cond.ModelName, cond.Negate, cond.ExcludeEmpty, cond.LogType)
	if err != nil {
		e.logger.Warn("failed to fetch samples", zap.Error(err))
		return nil
	}

	samples := make([]notifier.LogSampleItem, len(rawSamples))
	for i, s := range rawSamples {
		samples[i] = notifier.LogSampleItem{
			MatchedValue: s.MatchedValue,
			ResponseID:   s.ResponseID,
			RequestID:    s.RequestID,
		}
	}
	return samples
}

// LogMatchRequest 手动测试匹配请求
type LogMatchRequest struct {
	RuleType    string `json:"rule_type"`
	ChannelId   int    `json:"channel_id"`
	Pattern     string `json:"pattern"`
	Field       string `json:"field"`
	LogType     int    `json:"log_type"`
	WindowStart int64  `json:"window_start"`
	WindowEnd   int64  `json:"window_end"`
}

// LogMatchResponse 手动测试匹配响应
type LogMatchResponse struct {
	Count int64  `json:"count"`
	Error string `json:"error,omitempty"`
}

// TestMatch 手动测试匹配（API 用）
func (e *Engine) TestMatch(req *LogMatchRequest) *LogMatchResponse {
	var count int64
	var err error

	switch req.RuleType {
	case "regex":
		field := req.Field
		if field == "" {
			field = "content"
		}
		count, err = e.logStore.CountRegex(req.WindowStart, req.WindowEnd, req.ChannelId, field, req.Pattern, "", false, false, req.LogType)
	default:
		return &LogMatchResponse{Error: fmt.Sprintf("unsupported rule type: %s", req.RuleType)}
	}

	if err != nil {
		return &LogMatchResponse{Error: err.Error()}
	}

	return &LogMatchResponse{Count: count}
}
