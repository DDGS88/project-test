package probe

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"tt-inspector/internal/notifier"
	"tt-inspector/internal/store"

	"go.uber.org/zap"
)

// AvailabilityConfig 可用性探测配置
type AvailabilityConfig struct {
	Enabled             bool    `json:"enabled"`
	Cron                string  `json:"cron"`
	ChannelIds          []int64 `json:"channel_ids"`
	MaxModelsPerChannel int     `json:"max_models_per_channel"`
	Concurrency         int     `json:"concurrency"`
	TimeoutSec          int     `json:"timeout_sec"`
	MaxTokens           int     `json:"max_tokens"`
	Prompt              string  `json:"prompt"`
	CooldownSec         int     `json:"cooldown_sec"`
	FeishuWebhook       string  `json:"feishu_webhook"`
	AtUsers             string  `json:"at_users"`
}

// probeJob 单个待探测的「渠道-模型」
type probeJob struct {
	ChannelId   int64
	ChannelName string
	BaseUrl     string
	Key         string
	Model       string
}

// AvailabilityProber 渠道模型可用性探测器
//
// 只判可达性：每个「渠道-模型」发一次最小 chat 请求（max_tokens=1），
// 2xx 即视为可用，其余情况记录状态码/错误原因。
type AvailabilityProber struct {
	channelStore *store.ChannelStore
	probeStore   *store.ProbeStore
	notifier     notifier.Notifier
	logger       *zap.Logger

	client      *http.Client
	cooldownMu  sync.Mutex
	lastAlertAt time.Time
}

func NewAvailabilityProber(
	channelStore *store.ChannelStore,
	probeStore *store.ProbeStore,
	n notifier.Notifier,
	logger *zap.Logger,
) *AvailabilityProber {
	return &AvailabilityProber{
		channelStore: channelStore,
		probeStore:   probeStore,
		notifier:     n,
		logger:       logger,
		// 超时通过每个请求的 context 控制，这里不设全局 Timeout
		client: &http.Client{},
	}
}

// Run 执行一次可用性探测（trigger 为 cron / manual）
func (p *AvailabilityProber) Run(ctx context.Context, cfg AvailabilityConfig, trigger string) (*RunSummary, error) {
	startedAt := time.Now()

	targets, err := p.channelStore.ListProbeTargets()
	if err != nil {
		return nil, fmt.Errorf("查询探测目标失败: %w", err)
	}
	jobs, skipped := p.buildJobs(targets, cfg)

	run := &store.ProbeRun{
		Kind:      store.ProbeKindAvailability,
		Trigger:   trigger,
		Status:    store.ProbeStatusRunning,
		StartedAt: startedAt,
	}
	if err := p.probeStore.CreateRun(run); err != nil {
		return nil, fmt.Errorf("创建运行记录失败: %w", err)
	}

	results := p.execute(ctx, jobs, cfg)
	results = append(results, skipped...)
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
		p.logger.Error("写入可用性探测结果失败", zap.Error(err))
	}
	if err := p.probeStore.FinishRun(run.Id, status, len(results), okCount, failCount, skipCount, message); err != nil {
		p.logger.Error("更新可用性运行记录失败", zap.Error(err))
	}

	if failures := filterByStatus(results, store.ProbeItemFail); len(failures) > 0 {
		p.sendFailureAlert(cfg, run.Id, len(results), okCount, failures, startedAt, time.Now())
	}

	p.logger.Info("可用性探测完成",
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

// buildJobs 依据白名单与凭据条件筛选探测目标，返回待探测任务与跳过的结果记录
func (p *AvailabilityProber) buildJobs(targets []store.ProbeTarget, cfg AvailabilityConfig) ([]probeJob, []store.ProbeResult) {
	whitelist := make(map[int64]struct{}, len(cfg.ChannelIds))
	for _, id := range cfg.ChannelIds {
		whitelist[id] = struct{}{}
	}
	hasWhitelist := len(whitelist) > 0

	var jobs []probeJob
	var skipped []store.ProbeResult
	now := time.Now()

	skip := func(t store.ProbeTarget, reason string) {
		skipped = append(skipped, store.ProbeResult{
			Kind:        store.ProbeKindAvailability,
			ChannelId:   t.ChannelId,
			ChannelName: t.Name,
			Status:      store.ProbeItemSkip,
			Error:       reason,
			ProbedAt:    now,
		})
	}

	for _, t := range targets {
		// 白名单为空表示全部渠道；白名单非空时未选中的渠道直接忽略，避免产生大量噪音记录
		if hasWhitelist {
			if _, ok := whitelist[t.ChannelId]; !ok {
				continue
			}
		}
		if t.Status != 1 {
			skip(t, "渠道未启用（status="+strconv.FormatInt(t.Status, 10)+"）")
			continue
		}
		if strings.TrimSpace(t.BaseUrl) == "" || strings.TrimSpace(t.Key) == "" {
			skip(t, "缺少 base_url 或 key，无法探测")
			continue
		}
		if len(t.Models) == 0 {
			skip(t, "渠道下无关联模型")
			continue
		}

		models := t.Models
		if cfg.MaxModelsPerChannel > 0 && len(models) > cfg.MaxModelsPerChannel {
			models = models[:cfg.MaxModelsPerChannel]
		}
		for _, m := range models {
			jobs = append(jobs, probeJob{
				ChannelId:   t.ChannelId,
				ChannelName: t.Name,
				BaseUrl:     t.BaseUrl,
				Key:         t.Key,
				Model:       m,
			})
		}
	}

	return jobs, skipped
}

// execute 并发执行探测任务，并发上限由 cfg.Concurrency 控制
func (p *AvailabilityProber) execute(ctx context.Context, jobs []probeJob, cfg AvailabilityConfig) []store.ProbeResult {
	concurrency := cfg.Concurrency
	if concurrency < 1 {
		concurrency = 1
	}

	results := make([]store.ProbeResult, 0, len(jobs))
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, concurrency)

	for _, job := range jobs {
		if ctx.Err() != nil {
			break
		}
		sem <- struct{}{}
		wg.Add(1)
		go func(job probeJob) {
			defer wg.Done()
			defer func() { <-sem }()

			res := p.probeModel(ctx, job, cfg)
			mu.Lock()
			results = append(results, res)
			mu.Unlock()
		}(job)
	}
	wg.Wait()

	return results
}

// probeModel 对单个「渠道-模型」发起一次最小 chat 请求
func (p *AvailabilityProber) probeModel(ctx context.Context, job probeJob, cfg AvailabilityConfig) store.ProbeResult {
	res := store.ProbeResult{
		Kind:        store.ProbeKindAvailability,
		ChannelId:   job.ChannelId,
		ChannelName: job.ChannelName,
		Model:       job.Model,
		ProbedAt:    time.Now(),
	}

	maxTokens := cfg.MaxTokens
	if maxTokens < 1 {
		maxTokens = 1
	}
	prompt := strings.TrimSpace(cfg.Prompt)
	if prompt == "" {
		prompt = "hi"
	}
	timeout := time.Duration(cfg.TimeoutSec) * time.Second
	if timeout <= 0 {
		timeout = 15 * time.Second
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	url, payload, headers := buildProbePayload(job, prompt, maxTokens)

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		res.Status = store.ProbeItemFail
		res.Error = truncateErr(fmt.Sprintf("构造请求失败: %v", err))
		return res
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}

	start := time.Now()
	resp, err := p.client.Do(req)
	res.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		res.Status = store.ProbeItemFail
		res.Error = truncateErr(fmt.Sprintf("请求失败: %v", err))
		return res
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	res.StatusCode = resp.StatusCode

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		res.Status = store.ProbeItemOK
		return res
	}

	res.Status = store.ProbeItemFail
	res.Error = truncateErr(fmt.Sprintf("HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body))))
	return res
}

// sendFailureAlert 按渠道聚合失败项并发送飞书告警（受冷却时间约束）
func (p *AvailabilityProber) sendFailureAlert(
	cfg AvailabilityConfig,
	runId int64,
	total int,
	okCount int,
	failures []store.ProbeResult,
	startedAt, finishedAt time.Time,
) {
	if strings.TrimSpace(cfg.FeishuWebhook) == "" {
		p.logger.Warn("可用性探测存在失败项，但未配置飞书 webhook，仅记录日志",
			zap.Int64("run_id", runId),
			zap.Int("fail_count", len(failures)))
		return
	}

	if p.inCooldown(cfg.CooldownSec) {
		p.logger.Info("可用性告警处于冷却期，跳过发送",
			zap.Int64("run_id", runId),
			zap.Int("fail_count", len(failures)))
		return
	}

	channelFailures := make(map[string]int)
	for _, f := range failures {
		channelFailures[f.ChannelName]++
	}

	const maxSamples = 10
	samples := make([]notifier.LogSampleItem, 0, maxSamples)
	for i, f := range failures {
		if i >= maxSamples {
			break
		}
		samples = append(samples, notifier.LogSampleItem{
			ChannelName: f.ChannelName,
			ModelName:   f.Model,
			Detail:      fmt.Sprintf("状态码: `%d` | 耗时: `%dms` | %s", f.StatusCode, f.LatencyMs, f.Error),
		})
	}

	msg := notifier.AlertMessage{
		RuleName:    "[渠道探测] 模型可用性异常",
		RuleType:    "availability",
		MatchCount:  len(failures),
		Threshold:   0,
		WindowStart: startedAt,
		WindowEnd:   finishedAt,
		Condition:   fmt.Sprintf("可用性探测运行 #%d", runId),
		Description: fmt.Sprintf("本次探测 %d 项，成功 %d 项，失败 %d 项，涉及 %d 个渠道",
			total, okCount, len(failures), len(channelFailures)),
		Samples: samples,
		AtUsers: splitUsers(cfg.AtUsers),
	}

	if err := p.notifier.Send(cfg.FeishuWebhook, msg); err != nil {
		p.logger.Error("发送可用性告警失败", zap.Int64("run_id", runId), zap.Error(err))
		return
	}

	p.cooldownMu.Lock()
	p.lastAlertAt = time.Now()
	p.cooldownMu.Unlock()

	p.logger.Info("可用性告警已发送",
		zap.Int64("run_id", runId),
		zap.Int("fail_count", len(failures)))
}

// inCooldown 判断是否处于告警冷却期
func (p *AvailabilityProber) inCooldown(cooldownSec int) bool {
	if cooldownSec <= 0 {
		return false
	}
	p.cooldownMu.Lock()
	defer p.cooldownMu.Unlock()
	return !p.lastAlertAt.IsZero() && time.Since(p.lastAlertAt) < time.Duration(cooldownSec)*time.Second
}

// buildProbePayload 按模型所属协议构造探测请求的 URL、请求体与请求头
//
// 必须按协议区分：Claude 系渠道大多只支持 Anthropic Messages（POST /v1/messages），
// 用 OpenAI 的 /v1/chat/completions 去探测会被上游直接拒绝，导致把正常渠道误判为
// 不可用；Gemini 走 /v1beta/models/{model}:generateContent。其余模型（含无法
// 识别协议的）统一按 OpenAI 兼容接口处理。
func buildProbePayload(job probeJob, prompt string, maxTokens int) (string, []byte, map[string]string) {
	key := firstKey(job.Key)
	root := apiRoot(job.BaseUrl)

	switch inferProtocol(job.Model) {
	case "anthropic":
		payload := mustJSON(map[string]interface{}{
			"model":      job.Model,
			"max_tokens": maxTokens,
			"messages":   []map[string]string{{"role": "user", "content": prompt}},
		})
		return root + "/v1/messages", payload, map[string]string{
			"Content-Type":      "application/json",
			"x-api-key":         key,
			"anthropic-version": "2023-06-01",
		}

	case "gemini":
		payload := mustJSON(map[string]interface{}{
			"contents": []map[string]interface{}{
				{"parts": []map[string]string{{"text": prompt}}},
			},
			"generationConfig": map[string]int{"maxOutputTokens": maxTokens},
		})
		// 同时带上 Bearer 与 x-goog-api-key：前者适配中转站，后者适配 Google 原生地址
		return root + "/v1beta/models/" + job.Model + ":generateContent", payload, map[string]string{
			"Content-Type":   "application/json",
			"Authorization":  "Bearer " + key,
			"x-goog-api-key": key,
		}

	default:
		payload := mustJSON(map[string]interface{}{
			"model":      job.Model,
			"messages":   []map[string]string{{"role": "user", "content": prompt}},
			"max_tokens": maxTokens,
			"stream":     false,
		})
		return buildChatCompletionsURL(job.BaseUrl), payload, map[string]string{
			"Content-Type":  "application/json",
			"Authorization": "Bearer " + key,
		}
	}
}

// mustJSON 序列化固定结构（这些结构不会失败，失败时返回 nil 由请求本身报错）
func mustJSON(v interface{}) []byte {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	return raw
}

// apiRoot 归一化渠道 base_url，去掉结尾的 / 与已带的 /v1、/v1beta 后缀
func apiRoot(baseUrl string) string {
	u := strings.TrimRight(strings.TrimSpace(baseUrl), "/")
	u = strings.TrimSuffix(u, "/v1beta")
	u = strings.TrimSuffix(u, "/v1")
	return strings.TrimRight(u, "/")
}

// buildChatCompletionsURL 归一化渠道 base_url 并拼接 /chat/completions
//
// 渠道表里的 base_url 有的带 /v1 有的只到域名，这里统一补全，
// 避免出现 /v1/v1/chat/completions 这类拼接错误。
func buildChatCompletionsURL(baseUrl string) string {
	u := strings.TrimRight(strings.TrimSpace(baseUrl), "/")
	if !strings.HasSuffix(u, "/v1") && !strings.HasSuffix(u, "/v1beta") {
		u += "/v1"
	}
	return u + "/chat/completions"
}

// firstKey 取渠道 key 列表中的第一个非空值
func firstKey(keys string) string {
	for _, k := range strings.Split(keys, ",") {
		if trimmed := strings.TrimSpace(k); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

// truncateErr 截断错误信息，保证能落库（列长度 512）
func truncateErr(s string) string {
	s = strings.TrimSpace(s)
	const maxLen = 500
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// splitUsers 解析逗号分隔的 @ 用户列表
func splitUsers(users string) []string {
	if strings.TrimSpace(users) == "" {
		return nil
	}
	out := make([]string, 0)
	for _, u := range strings.Split(users, ",") {
		if trimmed := strings.TrimSpace(u); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

// countResults 统计结果状态分布
func countResults(results []store.ProbeResult) (ok, fail, skip int) {
	for _, r := range results {
		switch r.Status {
		case store.ProbeItemOK:
			ok++
		case store.ProbeItemFail:
			fail++
		default:
			skip++
		}
	}
	return ok, fail, skip
}

// filterByStatus 过滤指定状态的结果
func filterByStatus(results []store.ProbeResult, status string) []store.ProbeResult {
	out := make([]store.ProbeResult, 0)
	for _, r := range results {
		if r.Status == status {
			out = append(out, r)
		}
	}
	return out
}
