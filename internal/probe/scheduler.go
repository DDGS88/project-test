package probe

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"tt-inspector/internal/config"
	"tt-inspector/internal/store"

	"go.uber.org/zap"
)

// 探测配置在 probe_settings 表中的键名
const (
	SettingKeyAvailability = "availability_config"
	SettingKeyQuality      = "quality_config"
)

// 调度检查间隔：cron 为分钟级粒度，10s 轮询足以保证准点触发
const schedulerTickInterval = 10 * time.Second

// 触发方式
const (
	TriggerCron   = "cron"
	TriggerManual = "manual"
)

// RunSummary 一次探测运行的汇总结果
type RunSummary struct {
	RunId     int64  `json:"run_id"`
	Total     int    `json:"total"`
	OkCount   int    `json:"ok_count"`
	FailCount int    `json:"fail_count"`
	SkipCount int    `json:"skip_count"`
	Message   string `json:"message"`
	Status    string `json:"status"`
}

// RuntimeStatus 调度器运行状态（含最近一次运行的统计，供状态卡展示）
type RuntimeStatus struct {
	Running    bool   `json:"running"`
	NextRunAt  string `json:"next_run_at"`
	LastRunAt  string `json:"last_run_at"`
	LastStatus string `json:"last_status"`
	LastRunId  int64  `json:"last_run_id"`
	Total      int    `json:"total"`
	OkCount    int    `json:"ok_count"`
	FailCount  int    `json:"fail_count"`
	SkipCount  int    `json:"skip_count"`
}

// lastRunInfo 最近一次运行的时间与状态
type lastRunInfo struct {
	At     time.Time
	Status string
}

// Scheduler 探测调度器
//
// 用一个固定间隔的 ticker 轮询两类探测的「下次运行时间」而不是给每个配置挂
// 独立的 time.Timer：配置随时可能在页面上被改动，统一轮询可以让热更新逻辑
// 只关心「重算下次运行时间」，不必处理定时器的创建/停止/泄漏。
type Scheduler struct {
	store   *store.ProbeStore
	avail   *AvailabilityProber
	quality *QualityProber
	logger  *zap.Logger

	mu             sync.Mutex
	availCfg       AvailabilityConfig
	qualityCfg     QualityConfig
	availNext      time.Time
	qualityNext    time.Time
	availRunning   bool
	qualityRunning bool
	availLast      lastRunInfo
	qualityLast    lastRunInfo

	ctx    context.Context
	cancel context.CancelFunc
}

// NewScheduler 创建调度器；defaults 提供首次运行时的默认配置
func NewScheduler(
	probeStore *store.ProbeStore,
	avail *AvailabilityProber,
	quality *QualityProber,
	defaults config.ProbeConfig,
	logger *zap.Logger,
) *Scheduler {
	s := &Scheduler{
		store:   probeStore,
		avail:   avail,
		quality: quality,
		logger:  logger,
		availCfg: AvailabilityConfig{
			Enabled:             false,
			Cron:                defaults.AvailDefaultCron,
			ChannelIds:          []int64{},
			MaxModelsPerChannel: 0,
			Concurrency:         defaults.Concurrency,
			TimeoutSec:          defaults.TimeoutSec,
			MaxTokens:           1,
			Prompt:              "hi",
			CooldownSec:         defaults.CooldownSec,
		},
		qualityCfg: QualityConfig{
			Enabled:        false,
			Cron:           defaults.QualityDefaultCron,
			Mode:           "standard",
			ScoreThreshold: defaults.QualityScoreThreshold,
			TimeoutSec:     defaults.QualityTimeoutSec,
			CooldownSec:    defaults.CooldownSec,
		},
	}
	s.loadConfigs()
	s.normalize()
	return s
}

// Start 启动调度循环（应在服务启动时调用一次）
func (s *Scheduler) Start(parent context.Context) {
	s.ctx, s.cancel = context.WithCancel(parent)

	// 上一次进程如果是在运行中被杀掉的，把遗留的 running 记录标记为失败
	if err := s.store.FailStaleRuns(); err != nil {
		s.logger.Error("清理遗留探测运行记录失败", zap.Error(err))
	}

	s.mu.Lock()
	now := time.Now()
	s.availNext = s.nextRunTime(s.availCfg.Enabled, s.availCfg.Cron, now)
	s.qualityNext = s.nextRunTime(s.qualityCfg.Enabled, s.qualityCfg.Cron, now)
	s.mu.Unlock()

	go s.loop()
	s.logger.Info("渠道探测调度器已启动",
		zap.Bool("availability_enabled", s.availCfg.Enabled),
		zap.String("availability_cron", s.availCfg.Cron),
		zap.Bool("quality_enabled", s.qualityCfg.Enabled),
		zap.String("quality_cron", s.qualityCfg.Cron))
}

// Stop 停止调度循环
func (s *Scheduler) Stop() {
	if s.cancel != nil {
		s.cancel()
	}
}

// loop 定时检查并触发到期的探测任务
func (s *Scheduler) loop() {
	ticker := time.NewTicker(schedulerTickInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.ctx.Done():
			s.logger.Info("渠道探测调度器已停止")
			return
		case <-ticker.C:
			s.tick()
		}
	}
}

// tick 触发所有已到期的探测
func (s *Scheduler) tick() {
	now := time.Now()

	s.mu.Lock()
	availDue := s.availCfg.Enabled && !s.availNext.IsZero() && !now.Before(s.availNext) && !s.availRunning
	if availDue {
		s.availNext = s.nextRunTime(true, s.availCfg.Cron, now)
	}
	qualityDue := s.qualityCfg.Enabled && !s.qualityNext.IsZero() && !now.Before(s.qualityNext) && !s.qualityRunning
	if qualityDue {
		s.qualityNext = s.nextRunTime(true, s.qualityCfg.Cron, now)
	}
	s.mu.Unlock()

	if availDue {
		s.TriggerAvailability(TriggerCron)
	}
	if qualityDue {
		s.TriggerQuality(TriggerCron)
	}
}

// TriggerAvailability 异步触发一次可用性探测；已有运行进行中时返回 false
func (s *Scheduler) TriggerAvailability(trigger string) bool {
	s.mu.Lock()
	if s.availRunning {
		s.mu.Unlock()
		return false
	}
	s.availRunning = true
	cfg := s.availCfg
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			s.availRunning = false
			s.mu.Unlock()
		}()

		summary, err := s.avail.Run(s.runContext(), cfg, trigger)
		if err != nil {
			s.logger.Error("可用性探测执行失败", zap.Error(err))
			s.recordAvailability(lastRunInfo{At: time.Now(), Status: store.ProbeStatusFailed})
			return
		}
		s.recordAvailability(lastRunInfo{At: time.Now(), Status: summary.Status})
	}()
	return true
}

// TriggerQuality 异步触发一次质量探测；已有运行进行中时返回 false
func (s *Scheduler) TriggerQuality(trigger string) bool {
	s.mu.Lock()
	if s.qualityRunning {
		s.mu.Unlock()
		return false
	}
	s.qualityRunning = true
	cfg := s.qualityCfg
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			s.qualityRunning = false
			s.mu.Unlock()
		}()

		summary, err := s.quality.Run(s.runContext(), cfg, trigger)
		if err != nil {
			s.logger.Error("质量探测执行失败", zap.Error(err))
			s.recordQuality(lastRunInfo{At: time.Now(), Status: store.ProbeStatusFailed})
			return
		}
		s.recordQuality(lastRunInfo{At: time.Now(), Status: summary.Status})
	}()
	return true
}

// AvailabilityConfig 当前可用性探测配置
func (s *Scheduler) AvailabilityConfig() AvailabilityConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.availCfg
}

// QualityConfig 当前质量探测配置
func (s *Scheduler) QualityConfig() QualityConfig {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.qualityCfg
}

// ApplyAvailabilityConfig 保存可用性探测配置并重排下次运行时间
func (s *Scheduler) ApplyAvailabilityConfig(cfg AvailabilityConfig) error {
	if _, err := ParseCron(cfg.Cron); err != nil {
		return err
	}
	cfg = normalizeAvailabilityConfig(cfg)
	if err := s.saveSetting(SettingKeyAvailability, cfg); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.availCfg = cfg
	s.availNext = s.nextRunTime(cfg.Enabled, cfg.Cron, time.Now())
	return nil
}

// ApplyQualityConfig 保存质量探测配置并重排下次运行时间
func (s *Scheduler) ApplyQualityConfig(cfg QualityConfig) error {
	if _, err := ParseCron(cfg.Cron); err != nil {
		return err
	}
	cfg = normalizeQualityConfig(cfg)
	if err := s.saveSetting(SettingKeyQuality, cfg); err != nil {
		return err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	s.qualityCfg = cfg
	s.qualityNext = s.nextRunTime(cfg.Enabled, cfg.Cron, time.Now())
	return nil
}

// AvailabilityStatus 可用性探测运行状态
func (s *Scheduler) AvailabilityStatus() RuntimeStatus {
	s.mu.Lock()
	rt := RuntimeStatus{
		Running:    s.availRunning,
		NextRunAt:  formatTime(s.availNext),
		LastRunAt:  formatTime(s.availLast.At),
		LastStatus: s.availLast.Status,
	}
	s.mu.Unlock()
	return s.withLastRun(store.ProbeKindAvailability, rt)
}

// QualityStatus 质量探测运行状态
func (s *Scheduler) QualityStatus() RuntimeStatus {
	s.mu.Lock()
	rt := RuntimeStatus{
		Running:    s.qualityRunning,
		NextRunAt:  formatTime(s.qualityNext),
		LastRunAt:  formatTime(s.qualityLast.At),
		LastStatus: s.qualityLast.Status,
	}
	s.mu.Unlock()
	return s.withLastRun(store.ProbeKindQuality, rt)
}

// withLastRun 用数据库中最近一次运行补齐统计信息
//
// 内存里的运行信息只在本次进程触发过探测时才有，服务重启后为空；
// 状态卡需要展示「上次运行成功/失败数」，因此统一从库里的运行记录补齐。
func (s *Scheduler) withLastRun(kind string, rt RuntimeStatus) RuntimeStatus {
	last, err := s.store.LastRun(kind)
	if err != nil {
		s.logger.Error("查询最近一次探测运行失败", zap.String("kind", kind), zap.Error(err))
		return rt
	}
	if last == nil {
		return rt
	}

	rt.LastRunId = last.Id
	rt.Total = last.Total
	rt.OkCount = last.OkCount
	rt.FailCount = last.FailCount
	rt.SkipCount = last.SkipCount
	if rt.LastRunAt == "" {
		rt.LastRunAt = formatTime(last.StartedAt)
	}
	if rt.LastStatus == "" {
		rt.LastStatus = last.Status
	}
	return rt
}

// recordAvailability 记录可用性探测最近一次运行状态
func (s *Scheduler) recordAvailability(info lastRunInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.availLast = info
}

// recordQuality 记录质量探测最近一次运行状态
func (s *Scheduler) recordQuality(info lastRunInfo) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.qualityLast = info
}

// runContext 返回调度器上下文（未 Start 时退化为 Background）
func (s *Scheduler) runContext() context.Context {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ctx == nil {
		return context.Background()
	}
	return s.ctx
}

// nextRunTime 计算下次运行时间；未启用或表达式非法时返回零值
func (s *Scheduler) nextRunTime(enabled bool, expr string, from time.Time) time.Time {
	if !enabled {
		return time.Time{}
	}
	next, err := NextRun(expr, from)
	if err != nil {
		s.logger.Error("cron 表达式非法，已停止该类探测的调度", zap.String("cron", expr), zap.Error(err))
		return time.Time{}
	}
	return next
}

// loadConfigs 从数据库加载已保存的探测配置
func (s *Scheduler) loadConfigs() {
	if raw, err := s.store.GetSetting(SettingKeyAvailability); err != nil {
		s.logger.Error("读取可用性探测配置失败", zap.Error(err))
	} else if raw != "" {
		var cfg AvailabilityConfig
		if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
			s.logger.Error("解析可用性探测配置失败，将使用默认值", zap.Error(err))
		} else {
			s.availCfg = cfg
		}
	}

	if raw, err := s.store.GetSetting(SettingKeyQuality); err != nil {
		s.logger.Error("读取质量探测配置失败", zap.Error(err))
	} else if raw != "" {
		var cfg QualityConfig
		if err := json.Unmarshal([]byte(raw), &cfg); err != nil {
			s.logger.Error("解析质量探测配置失败，将使用默认值", zap.Error(err))
		} else {
			s.qualityCfg = cfg
		}
	}
}

// saveSetting 序列化并持久化配置
func (s *Scheduler) saveSetting(key string, cfg interface{}) error {
	raw, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("序列化探测配置失败: %w", err)
	}
	if err := s.store.SetSetting(key, string(raw)); err != nil {
		return fmt.Errorf("保存探测配置失败: %w", err)
	}
	return nil
}

// normalize 规范化内存中的配置（补齐零值）
func (s *Scheduler) normalize() {
	s.availCfg = normalizeAvailabilityConfig(s.availCfg)
	s.qualityCfg = normalizeQualityConfig(s.qualityCfg)
}

// normalizeAvailabilityConfig 补齐可用性配置的零值
func normalizeAvailabilityConfig(cfg AvailabilityConfig) AvailabilityConfig {
	if cfg.Concurrency < 1 {
		cfg.Concurrency = 5
	}
	if cfg.TimeoutSec <= 0 {
		cfg.TimeoutSec = 15
	}
	if cfg.MaxTokens < 1 {
		cfg.MaxTokens = 1
	}
	if cfg.Prompt == "" {
		cfg.Prompt = "hi"
	}
	if cfg.ChannelIds == nil {
		cfg.ChannelIds = []int64{}
	}
	return cfg
}

// normalizeQualityConfig 补齐质量配置的零值
func normalizeQualityConfig(cfg QualityConfig) QualityConfig {
	if cfg.Mode == "" {
		cfg.Mode = "standard"
	}
	if cfg.TimeoutSec <= 0 {
		cfg.TimeoutSec = 300
	}
	if cfg.ScoreThreshold <= 0 {
		cfg.ScoreThreshold = 60
	}
	return cfg
}

// formatTime 格式化时间，零值返回空字符串（避免前端展示 0001-01-01）
func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}
