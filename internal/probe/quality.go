package probe

import (
	"context"
	"fmt"
	"math/rand"
	"strings"
	"sync"
	"time"

	"tt-inspector/internal/notifier"
	"tt-inspector/internal/store"

	"go.uber.org/zap"
)

// 轮询检测任务的间隔
const qualityPollInterval = 3 * time.Second

// QualityConfig 质量探测配置
type QualityConfig struct {
	Enabled        bool   `json:"enabled"`
	Cron           string `json:"cron"`
	Mode           string `json:"mode"`
	ScoreThreshold int    `json:"score_threshold"`
	TimeoutSec     int    `json:"timeout_sec"`
	CooldownSec    int    `json:"cooldown_sec"`
	FeishuWebhook  string `json:"feishu_webhook"`
	AtUsers        string `json:"at_users"`
}

// QualityProber 渠道质量探测器
//
// 依赖最近一次「存在成功结果」的可用性运行：按渠道分组，每个渠道随机抽 1 个模型
// 调 veridrop 做真伪/质量检测。
type QualityProber struct {
	channelStore *store.ChannelStore
	probeStore   *store.ProbeStore
	client       *VeridropClient
	notifier     notifier.Notifier
	logger       *zap.Logger

	cooldownMu  sync.Mutex
	lastAlertAt time.Time
}

func NewQualityProber(
	channelStore *store.ChannelStore,
	probeStore *store.ProbeStore,
	client *VeridropClient,
	n notifier.Notifier,
	logger *zap.Logger,
) *QualityProber {
	return &QualityProber{
		channelStore: channelStore,
		probeStore:   probeStore,
		client:       client,
		notifier:     n,
		logger:       logger,
	}
}

// Run 执行一次质量探测（trigger 为 cron / manual）
func (p *QualityProber) Run(ctx context.Context, cfg QualityConfig, trigger string) (*RunSummary, error) {
	startedAt := time.Now()

	run := &store.ProbeRun{
		Kind:      store.ProbeKindQuality,
		Trigger:   trigger,
		Status:    store.ProbeStatusRunning,
		StartedAt: startedAt,
	}
	if err := p.probeStore.CreateRun(run); err != nil {
		return nil, fmt.Errorf("创建运行记录失败: %w", err)
	}

	candidates, err := p.probeStore.LatestOKAvailabilityResults()
	if err != nil {
		_ = p.probeStore.FinishRun(run.Id, store.ProbeStatusFailed, 0, 0, 0, 0, "查询可用性结果失败")
		return nil, fmt.Errorf("查询可用性结果失败: %w", err)
	}

	// 没有可用性成功结果时本次跳过：质量探测以可用性为前提
	if len(candidates) == 0 {
		message := "没有可用的可用性探测成功结果，本次质量探测已跳过"
		if err := p.probeStore.FinishRun(run.Id, store.ProbeStatusDone, 0, 0, 0, 0, message); err != nil {
			p.logger.Error("更新质量运行记录失败", zap.Error(err))
		}
		p.logger.Info("质量探测跳过", zap.Int64("run_id", run.Id), zap.String("reason", message))
		return &RunSummary{
			RunId:   run.Id,
			Status:  store.ProbeStatusDone,
			Message: message,
		}, nil
	}

	targets, err := p.channelStore.ListProbeTargets()
	if err != nil {
		return nil, fmt.Errorf("查询渠道凭据失败: %w", err)
	}
	credMap := make(map[int64]store.ProbeTarget, len(targets))
	for _, t := range targets {
		credMap[t.ChannelId] = t
	}

	picks := pickPerChannel(candidates)
	results := make([]store.ProbeResult, 0, len(picks))
	for _, pick := range picks {
		if ctx.Err() != nil {
			break
		}
		results = append(results, p.probeCandidate(ctx, pick, credMap, cfg))
	}
	for i := range results {
		results[i].RunId = run.Id
	}

	okCount, failCount, skipCount := countResults(results)
	status := store.ProbeStatusDone
	message := ""
	if ctx.Err() != nil {
		status = store.ProbeStatusFailed
		message = "运行被中断"
	}

	if err := p.probeStore.InsertResults(results); err != nil {
		p.logger.Error("写入质量探测结果失败", zap.Error(err))
	}
	if err := p.probeStore.FinishRun(run.Id, status, len(results), okCount, failCount, skipCount, message); err != nil {
		p.logger.Error("更新质量运行记录失败", zap.Error(err))
	}

	if problems := filterByStatus(results, store.ProbeItemFail); len(problems) > 0 {
		p.sendAlert(cfg, run.Id, len(results), problems, startedAt, time.Now())
	}

	p.logger.Info("质量探测完成",
		zap.Int64("run_id", run.Id),
		zap.String("trigger", trigger),
		zap.Int("total", len(results)),
		zap.Int("ok", okCount),
		zap.Int("fail", failCount),
		zap.Int("skip", skipCount))

	return &RunSummary{
		RunId:     run.Id,
		Total:     len(results),
		OkCount:   okCount,
		FailCount: failCount,
		SkipCount: skipCount,
		Message:   message,
		Status:    status,
	}, nil
}

// probeCandidate 对单个候选渠道-模型执行一次 veridrop 检测
func (p *QualityProber) probeCandidate(
	ctx context.Context,
	pick store.ProbeResult,
	credMap map[int64]store.ProbeTarget,
	cfg QualityConfig,
) store.ProbeResult {
	res := store.ProbeResult{
		Kind:        store.ProbeKindQuality,
		ChannelId:   pick.ChannelId,
		ChannelName: pick.ChannelName,
		Model:       pick.Model,
		ProbedAt:    time.Now(),
	}

	target, ok := credMap[pick.ChannelId]
	if !ok || strings.TrimSpace(target.BaseUrl) == "" || strings.TrimSpace(target.Key) == "" {
		res.Status = store.ProbeItemSkip
		res.Error = "渠道缺少 base_url 或 key，无法检测"
		return res
	}

	// 渠道类型优先、模型名兜底，最终兜底 OpenAI 兼容（Kimi/DeepSeek/GLM 等第三方模型走此协议）
	protocol := resolveProtocol(target.Type, pick.Model)
	res.Protocol = protocol

	if !p.client.Configured() {
		res.Status = store.ProbeItemFail
		res.Error = "未配置 veridrop 上游地址"
		return res
	}

	timeout := time.Duration(cfg.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 300 * time.Second
	}
	// 提交与轮询共用一个总超时预算
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	mode := strings.TrimSpace(cfg.Mode)
	if mode == "" {
		mode = "standard"
	}

	jobID, err := p.client.Submit(runCtx, protocol, target.BaseUrl, firstKey(target.Key), pick.Model, mode)
	if err != nil {
		res.Status = store.ProbeItemFail
		res.Error = truncateErr(err.Error())
		return res
	}

	report, err := p.waitForJob(runCtx, jobID)
	if err != nil {
		res.Status = store.ProbeItemFail
		res.Error = truncateErr(err.Error())
		return res
	}

	res.Score = report.TotalScore
	res.Verdict = report.Verdict
	res.ReportUrl = p.client.ReportPath(jobID)

	if cfg.ScoreThreshold > 0 && report.TotalScore < float64(cfg.ScoreThreshold) {
		res.Status = store.ProbeItemFail
		res.Error = fmt.Sprintf("总分 %.1f 低于阈值 %d", report.TotalScore, cfg.ScoreThreshold)
		return res
	}

	res.Status = store.ProbeItemOK
	return res
}

// waitForJob 轮询检测任务直到完成，或上下文超时
func (p *QualityProber) waitForJob(ctx context.Context, jobID string) (*VeridropReport, error) {
	ticker := time.NewTicker(qualityPollInterval)
	defer ticker.Stop()

	for {
		status, err := p.client.Status(ctx, jobID)
		if err != nil {
			return nil, err
		}

		switch status.Status {
		case "done":
			return p.client.Result(ctx, jobID)
		case "error":
			if strings.TrimSpace(status.Error) != "" {
				return nil, fmt.Errorf("检测失败: %s", status.Error)
			}
			return nil, fmt.Errorf("检测失败")
		}

		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("等待检测结果超时")
		case <-ticker.C:
		}
	}
}

// sendAlert 汇总异常项并发送飞书告警（受冷却时间约束）
func (p *QualityProber) sendAlert(
	cfg QualityConfig,
	runId int64,
	total int,
	problems []store.ProbeResult,
	startedAt, finishedAt time.Time,
) {
	if strings.TrimSpace(cfg.FeishuWebhook) == "" {
		p.logger.Warn("质量探测存在异常项，但未配置飞书 webhook，仅记录日志",
			zap.Int64("run_id", runId),
			zap.Int("fail_count", len(problems)))
		return
	}

	if p.inCooldown(cfg.CooldownSec) {
		p.logger.Info("质量告警处于冷却期，跳过发送",
			zap.Int64("run_id", runId),
			zap.Int("fail_count", len(problems)))
		return
	}

	const maxSamples = 10
	samples := make([]notifier.LogSampleItem, 0, maxSamples)
	for i, r := range problems {
		if i >= maxSamples {
			break
		}
		detail := fmt.Sprintf("分数: `%.1f` | 结论: `%s` | %s", r.Score, r.Verdict, r.Error)
		if r.ReportUrl != "" {
			detail += fmt.Sprintf(" | 报告: %s", r.ReportUrl)
		}
		samples = append(samples, notifier.LogSampleItem{
			ChannelName: r.ChannelName,
			ModelName:   r.Model,
			Detail:      detail,
		})
	}

	msg := notifier.AlertMessage{
		RuleName:    "[渠道探测] 中转站质量检测异常",
		RuleType:    "quality",
		MatchCount:  len(problems),
		Threshold:   cfg.ScoreThreshold,
		WindowStart: startedAt,
		WindowEnd:   finishedAt,
		Condition:   fmt.Sprintf("质量探测运行 #%d", runId),
		Description: fmt.Sprintf("本次抽检 %d 个渠道-模型，异常 %d 项（分数低于 %d 或检测失败）",
			total, len(problems), cfg.ScoreThreshold),
		Samples: samples,
		AtUsers: splitUsers(cfg.AtUsers),
	}

	if err := p.notifier.Send(cfg.FeishuWebhook, msg); err != nil {
		p.logger.Error("发送质量告警失败", zap.Int64("run_id", runId), zap.Error(err))
		return
	}

	p.cooldownMu.Lock()
	p.lastAlertAt = time.Now()
	p.cooldownMu.Unlock()

	p.logger.Info("质量告警已发送",
		zap.Int64("run_id", runId),
		zap.Int("fail_count", len(problems)))
}

// inCooldown 判断是否处于告警冷却期
func (p *QualityProber) inCooldown(cooldownSec int) bool {
	if cooldownSec <= 0 {
		return false
	}
	p.cooldownMu.Lock()
	defer p.cooldownMu.Unlock()
	return !p.lastAlertAt.IsZero() && time.Since(p.lastAlertAt) < time.Duration(cooldownSec)*time.Second
}

// pickPerChannel 按渠道分组后每个渠道随机抽取 1 个模型
func pickPerChannel(candidates []store.ProbeResult) []store.ProbeResult {
	grouped := make(map[int64][]store.ProbeResult)
	order := make([]int64, 0)
	for _, c := range candidates {
		if _, ok := grouped[c.ChannelId]; !ok {
			order = append(order, c.ChannelId)
		}
		grouped[c.ChannelId] = append(grouped[c.ChannelId], c)
	}

	picks := make([]store.ProbeResult, 0, len(order))
	for _, id := range order {
		items := grouped[id]
		picks = append(picks, items[rand.Intn(len(items))])
	}
	return picks
}
