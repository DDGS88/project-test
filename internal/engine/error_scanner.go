package engine

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"time"

	"tt-inspector/internal/notifier"
	"tt-inspector/internal/store"

	"go.uber.org/zap"
	"gorm.io/gorm"
)

// ErrorScanner 错误日志扫描调度器
type ErrorScanner struct {
	db              *gorm.DB
	logStore        *store.LogStore
	scanStore       *store.ErrorScanStore
	notifier        notifier.Notifier
	logger          *zap.Logger
	pollInterval    time.Duration
	intervalMu      sync.RWMutex
	cooldowns       map[int64]map[string]time.Time // ruleId -> groupValue -> last alert time
	cooldownsMu     sync.Mutex
	cooldownSeconds int
	// 兜底告警
	fallbackEnabled  bool
	fallbackWebhook  string
	fallbackMu       sync.RWMutex
	fallbackCooldown time.Time
	// 全局告警@用户
	alertAtUsers []string
	atUsersMu    sync.RWMutex
}

// NewErrorScanner 创建错误扫描器
func NewErrorScanner(
	db *gorm.DB,
	scanStore *store.ErrorScanStore,
	notifier notifier.Notifier,
	logger *zap.Logger,
	pollInterval time.Duration,
	cooldownSeconds int,
) *ErrorScanner {
	return &ErrorScanner{
		db:              db,
		logStore:        store.NewLogStore(db),
		scanStore:       scanStore,
		notifier:        notifier,
		logger:          logger,
		pollInterval:    pollInterval,
		cooldowns:       make(map[int64]map[string]time.Time),
		cooldownSeconds: cooldownSeconds,
	}
}

// Run 启动扫描主循环
func (s *ErrorScanner) Run(ctx context.Context) {
	s.logger.Info("error scanner started",
		zap.Duration("poll_interval", s.pollInterval),
		zap.Int("cooldown_seconds", s.cooldownSeconds))

	for {
		select {
		case <-ctx.Done():
			s.logger.Info("error scanner stopped")
			return
		case <-time.After(s.GetPollInterval()):
			s.scanAll()
			s.checkFallbackAlert()
		}
	}
}

// GetPollInterval 获取当前轮询间隔
func (s *ErrorScanner) GetPollInterval() time.Duration {
	s.intervalMu.RLock()
	defer s.intervalMu.RUnlock()
	return s.pollInterval
}

// SetPollInterval 动态设置轮询间隔（秒）
func (s *ErrorScanner) SetPollInterval(seconds int) {
	s.intervalMu.Lock()
	defer s.intervalMu.Unlock()
	s.pollInterval = time.Duration(seconds) * time.Second
	s.logger.Info("error scan poll interval updated",
		zap.Int("seconds", seconds))
}

// TriggerScan 手动触发一次扫描（调试用）
func (s *ErrorScanner) TriggerScan() {
	s.logger.Info("manual scan triggered")
	go s.scanAll()
}

// SetFallbackConfig 配置兜底告警
func (s *ErrorScanner) SetFallbackConfig(enabled bool, webhook string) {
	s.fallbackMu.Lock()
	defer s.fallbackMu.Unlock()
	s.fallbackEnabled = enabled
	s.fallbackWebhook = webhook
	s.logger.Info("fallback config updated", zap.Bool("enabled", enabled))
}

// GetFallbackConfig 获取兜底告警配置
func (s *ErrorScanner) GetFallbackConfig() (bool, string) {
	s.fallbackMu.RLock()
	defer s.fallbackMu.RUnlock()
	return s.fallbackEnabled, s.fallbackWebhook
}

// SetAlertAtUsers 设置全局告警@用户
func (s *ErrorScanner) SetAlertAtUsers(users []string) {
	s.atUsersMu.Lock()
	defer s.atUsersMu.Unlock()
	s.alertAtUsers = users
}

// GetAlertAtUsers 获取全局告警@用户
func (s *ErrorScanner) GetAlertAtUsers() []string {
	s.atUsersMu.RLock()
	defer s.atUsersMu.RUnlock()
	return s.alertAtUsers
}

// checkFallbackAlert 检查是否需要发送兜底告警
func (s *ErrorScanner) checkFallbackAlert() {
	s.fallbackMu.RLock()
	enabled := s.fallbackEnabled
	webhook := s.fallbackWebhook
	s.fallbackMu.RUnlock()

	if !enabled || webhook == "" {
		return
	}

	// 冷却检查
	if time.Since(s.fallbackCooldown) < time.Duration(s.cooldownSeconds)*time.Second {
		return
	}

	rules, _ := s.scanStore.List()
	patterns := make([]string, 0)
	for _, r := range rules {
		if r.PatternKeyword != "" {
			patterns = append(patterns, r.PatternKeyword)
		}
	}

	stats, err := s.logStore.GetOverviewStats(patterns, 1)
	if err != nil {
		return
	}

	if stats.UnmatchedErrors > 0 {
		s.fallbackCooldown = time.Now()

		msg := notifier.AlertMessage{
			RuleName:    "[兜底告警] 未匹配的错误日志",
			RuleType:    "fallback",
			MatchCount:  int(stats.UnmatchedErrors),
			Threshold:   0,
			WindowStart: time.Now().Add(-time.Hour),
			WindowEnd:   time.Now(),
			Condition:   "type=5 未命中任何规则",
			Description: fmt.Sprintf("当前有 %d 条 type=5 错误日志未被任何精细化规则覆盖，总匹配率 %.1f%%，请及时添加规则",
				stats.UnmatchedErrors, stats.MatchRate),
			AtUsers: s.GetAlertAtUsers(),
		}

		if err := s.notifier.Send(webhook, msg); err != nil {
			s.logger.Error("fallback alert failed", zap.Error(err))
		} else {
			s.logger.Warn("fallback alert sent",
				zap.Int64("unmatched", stats.UnmatchedErrors),
				zap.Float64("match_rate", stats.MatchRate))
		}
	}
}

// TestWebhook 测试飞书 webhook 是否可用
func (s *ErrorScanner) TestWebhook(webhookURL string) error {
	msg := notifier.AlertMessage{
		RuleName:    "[错误扫描] Webhook 连通性测试",
		RuleType:    "测试",
		MatchCount:  0,
		Threshold:   0,
		WindowStart: time.Now(),
		WindowEnd:   time.Now(),
		Condition:   "手动测试",
		Description: "这是一条来自 tt-inspector 错误扫描的飞书机器人连通性测试消息，如果你收到此消息说明配置正确。",
	}
	err := s.notifier.Send(webhookURL, msg)
	if err != nil {
		s.logger.Error("webhook test failed",
			zap.String("url", truncateURL(webhookURL)),
			zap.Error(err))
	}
	return err
}

// scanAll 遍历所有启用的错误扫描规则
func (s *ErrorScanner) scanAll() {
	rules, err := s.scanStore.List()
	if err != nil {
		s.logger.Error("failed to load error scan rules", zap.Error(err))
		return
	}

	for i := range rules {
		rule := &rules[i]
		if !rule.IsAlertEnabled || rule.Suppressed {
			s.logger.Debug("skip rule (not enabled or suppressed)",
				zap.Int64("rule_id", rule.Id),
				zap.String("name", rule.Name),
				zap.Bool("enabled", rule.IsAlertEnabled),
				zap.Bool("suppressed", rule.Suppressed))
			continue
		}
		if rule.PatternKeyword == "" {
			s.logger.Debug("skip rule (no keyword)",
				zap.Int64("rule_id", rule.Id),
				zap.String("name", rule.Name))
			continue
		}
		s.scanRule(rule)
	}
}

// scanRule 扫描单条规则
func (s *ErrorScanner) scanRule(rule *store.ErrorScanRule) {
	now := time.Now()
	windowEnd := now.Unix()

	// 确定时间窗口：使用轮询间隔，每次只统计新数据，避免重复告警
	windowSec := int64(s.GetPollInterval().Seconds())
	if rule.ScanGranularity == "天 (Daily)" {
		windowSec = 86400
	}
	windowStart := windowEnd - windowSec

	// 按错误精细类型：直接统计总数，不分组
	if rule.AlertGranularity == "按错误精细类型" {
		totalCount, err := s.logStore.CountRegex(windowStart, windowEnd,
			0, "content", rule.PatternKeyword, "", false, false, 5)
		if err != nil {
			s.logger.Error("count error logs failed",
				zap.Int64("rule_id", rule.Id), zap.Error(err))
			return
		}

		s.logger.Debug("scan rule result",
			zap.Int64("rule_id", rule.Id),
			zap.String("name", rule.Name),
			zap.String("keyword", rule.PatternKeyword),
			zap.Int64("count", totalCount),
			zap.Int("threshold", rule.AlertThreshold),
			zap.String("webhook", truncateURL(rule.FeishuWebhook)))

		// 更新计数
		s.updateCounts(rule, int(totalCount))

		if totalCount >= int64(rule.AlertThreshold) {
			s.sendAlert(rule, "总览", int(totalCount), windowStart, windowEnd)
		} else {
			s.logger.Debug("below alert threshold",
				zap.Int64("rule_id", rule.Id),
				zap.Int64("count", totalCount),
				zap.Int("threshold", rule.AlertThreshold))
		}
		return
	}

	// 按维度分组统计
	groupCounts, err := s.logStore.CountErrorLogsGrouped(
		windowStart, windowEnd, rule.PatternKeyword, rule.AlertGranularity)
	if err != nil {
		s.logger.Error("count error logs grouped failed",
			zap.Int64("rule_id", rule.Id), zap.Error(err))
		return
	}

	s.logger.Debug("scan rule grouped result",
		zap.Int64("rule_id", rule.Id),
		zap.String("name", rule.Name),
		zap.String("keyword", rule.PatternKeyword),
		zap.String("granularity", rule.AlertGranularity),
		zap.Int("groups", len(groupCounts)),
		zap.Int("threshold", rule.AlertThreshold))

	// 构建排除集合
	filterSet := s.buildExcludeSet(rule)
	hasFilter := len(filterSet) > 0

	// 累计总数
	totalCount := 0
	for _, gc := range groupCounts {
		// 检查是否需要跳过
		if s.shouldSkip(gc.GroupValue, filterSet, rule.FilterMode, hasFilter) {
			continue
		}

		totalCount += int(gc.Count)

		// 超过阈值则告警
		if gc.Count >= int64(rule.AlertThreshold) {
			s.sendGroupAlert(rule, gc.GroupValue, int(gc.Count), windowStart, windowEnd)
		}
	}

	// 更新汇总计数
	s.updateCounts(rule, totalCount)
}

// buildExcludeSet 构建排除集合（filterMode=include时反转为选中集合）
func (s *ErrorScanner) buildExcludeSet(rule *store.ErrorScanRule) map[string]struct{} {
	targetSet := make(map[string]struct{})

	var filterList string
	if rule.AlertGranularity == "按渠道" {
		filterList = rule.ExcludeChannels
	} else if rule.AlertGranularity == "按用户" {
		filterList = rule.ExcludeUsers
	}

	if filterList != "" {
		for _, v := range strings.Split(filterList, ",") {
			v = strings.TrimSpace(v)
			if v != "" {
				targetSet[v] = struct{}{}
			}
		}
	}
	return targetSet
}

// shouldSkip 判断分组值是否需要跳过
func (s *ErrorScanner) shouldSkip(groupValue string, filterSet map[string]struct{}, filterMode string, hasFilter bool) bool {
	if !hasFilter {
		return false
	}
	_, inSet := filterSet[groupValue]
	if filterMode == "include" {
		// include模式：集合里没有的要跳过
		return !inSet
	}
	// exclude模式：集合里的要跳过
	return inSet
}

// updateCounts 更新错误计数到数据库
func (s *ErrorScanner) updateCounts(rule *store.ErrorScanRule, count int) {
	if rule.ScanGranularity == "天 (Daily)" {
		if err := s.scanStore.UpdateDailyCount(rule.Id, count); err != nil {
			s.logger.Warn("update daily count failed", zap.Int64("rule_id", rule.Id), zap.Error(err))
		}
	} else {
		if err := s.scanStore.UpdateHourlyCount(rule.Id, count); err != nil {
			s.logger.Warn("update hourly count failed", zap.Int64("rule_id", rule.Id), zap.Error(err))
		}
	}
}

// sendAlert 发送不分组告警
func (s *ErrorScanner) sendAlert(rule *store.ErrorScanRule, groupValue string, count int, windowStart, windowEnd int64) {
	webhookURL := rule.FeishuWebhook
	if webhookURL == "" {
		return
	}

	// 冷却检查
	cooldownKey := rule.Id
	if !s.checkCooldown(cooldownKey, "") {
		return
	}

	msg := notifier.AlertMessage{
		RuleName:    fmt.Sprintf("[错误扫描] %s", rule.Name),
		RuleType:    rule.Category,
		MatchCount:  count,
		Threshold:   rule.AlertThreshold,
		WindowStart: time.Unix(windowStart, 0),
		WindowEnd:   time.Unix(windowEnd, 0),
		Condition:   fmt.Sprintf("关键词: %s | 粒度: %s", rule.PatternKeyword, rule.AlertGranularity),
		Description: fmt.Sprintf("%s 本周期共出现 %d 次错误", rule.SubCategory, count),
		AtUsers:     s.GetAlertAtUsers(),
	}

	if err := s.notifier.Send(webhookURL, msg); err != nil {
		s.logger.Error("send error alert failed",
			zap.Int64("rule_id", rule.Id), zap.Error(err))
		return
	}

	s.logger.Info("error alert sent",
		zap.Int64("rule_id", rule.Id),
		zap.String("name", rule.Name),
		zap.Int("count", count))
}

// sendGroupAlert 发送分组告警
func (s *ErrorScanner) sendGroupAlert(rule *store.ErrorScanRule, groupValue string, count int, windowStart, windowEnd int64) {
	webhookURL := rule.FeishuWebhook
	if webhookURL == "" {
		return
	}

	// 冷却检查（按 ruleId + groupValue）
	if !s.checkCooldown(rule.Id, groupValue) {
		return
	}

	msg := notifier.AlertMessage{
		RuleName:    fmt.Sprintf("[错误扫描] %s - %s", rule.Name, groupValue),
		RuleType:    rule.Category,
		MatchCount:  count,
		Threshold:   rule.AlertThreshold,
		WindowStart: time.Unix(windowStart, 0),
		WindowEnd:   time.Unix(windowEnd, 0),
		Condition:   fmt.Sprintf("关键词: %s | %s: %s", rule.PatternKeyword, rule.AlertGranularity, groupValue),
		Description: fmt.Sprintf("%s(%s) 本周期出现 %d 次错误，超过阈值 %d",
			rule.SubCategory, groupValue, count, rule.AlertThreshold),
		AtUsers: s.GetAlertAtUsers(),
	}

	if err := s.notifier.Send(webhookURL, msg); err != nil {
		s.logger.Error("send group error alert failed",
			zap.Int64("rule_id", rule.Id),
			zap.String("group_value", groupValue),
			zap.Error(err))
		return
	}

	s.logger.Info("group error alert sent",
		zap.Int64("rule_id", rule.Id),
		zap.String("group_value", groupValue),
		zap.Int("count", count))
}

// checkCooldown 检查冷却期，返回 true 表示可以发送
func (s *ErrorScanner) checkCooldown(ruleId int64, groupValue string) bool {
	s.cooldownsMu.Lock()
	defer s.cooldownsMu.Unlock()

	if ruleGroups, ok := s.cooldowns[ruleId]; ok {
		if lastAlert, exists := ruleGroups[groupValue]; exists {
			if time.Since(lastAlert) < time.Duration(s.cooldownSeconds)*time.Second {
				return false
			}
		}
	}
	if s.cooldowns[ruleId] == nil {
		s.cooldowns[ruleId] = make(map[string]time.Time)
	}
	s.cooldowns[ruleId][groupValue] = time.Now()
	return true
}

// truncateURL 截断 webhook URL 用于日志显示
func truncateURL(url string) string {
	if url == "" {
		return "(empty)"
	}
	if len(url) > 50 {
		return url[:50] + "..."
	}
	return url
}
