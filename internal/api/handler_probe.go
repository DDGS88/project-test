package api

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"tt-inspector/internal/notifier"
	"tt-inspector/internal/probe"
	"tt-inspector/internal/store"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ProbeHandler 渠道探测接口
type ProbeHandler struct {
	store     *store.ProbeStore
	scheduler *probe.Scheduler
	notifier  notifier.Notifier
	logger    *zap.Logger
}

// GetConfig 返回两套探测配置与运行状态
func (h *ProbeHandler) GetConfig(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"availability": h.scheduler.AvailabilityConfig(),
		"quality":      h.scheduler.QualityConfig(),
		"runtime": gin.H{
			"availability": h.scheduler.AvailabilityStatus(),
			"quality":      h.scheduler.QualityStatus(),
		},
	}})
}

// UpdateAvailabilityConfig 保存可用性探测配置
func (h *ProbeHandler) UpdateAvailabilityConfig(c *gin.Context) {
	var cfg probe.AvailabilityConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateAvailabilityConfig(cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.scheduler.ApplyAvailabilityConfig(cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.scheduler.AvailabilityConfig()})
}

// UpdateQualityConfig 保存质量探测配置
func (h *ProbeHandler) UpdateQualityConfig(c *gin.Context) {
	var cfg probe.QualityConfig
	if err := c.ShouldBindJSON(&cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateQualityConfig(cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := h.scheduler.ApplyQualityConfig(cfg); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": h.scheduler.QualityConfig()})
}

// ValidateCron 校验 cron 表达式并返回下次运行时间
func (h *ProbeHandler) ValidateCron(c *gin.Context) {
	var body struct {
		Cron string `json:"cron"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	next, err := probe.ValidateCron(body.Cron, time.Now())
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"valid":    false,
			"next_run": "",
			"error":    err.Error(),
		}})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"valid":    true,
		"next_run": next.Format(time.RFC3339),
		"error":    "",
	}})
}

// RunAvailability 手动触发一次可用性探测（异步执行，立即返回）
func (h *ProbeHandler) RunAvailability(c *gin.Context) {
	if !h.scheduler.TriggerAvailability(probe.TriggerManual) {
		c.JSON(http.StatusConflict, gin.H{"error": "已有可用性探测正在运行，请稍后重试"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"accepted": true}})
}

// RunQuality 手动触发一次质量探测（异步执行，立即返回）
func (h *ProbeHandler) RunQuality(c *gin.Context) {
	if !h.scheduler.TriggerQuality(probe.TriggerManual) {
		c.JSON(http.StatusConflict, gin.H{"error": "已有质量探测正在运行，请稍后重试"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": gin.H{"accepted": true}})
}

// ListRuns 查询探测运行历史
func (h *ProbeHandler) ListRuns(c *gin.Context) {
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "20"))
	runs, err := h.store.ListRuns(c.Query("kind"), limit)
	if err != nil {
		h.logger.Error("查询探测运行历史失败", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if runs == nil {
		runs = []store.ProbeRun{}
	}
	c.JSON(http.StatusOK, gin.H{"data": runs})
}

// ListResults 查询探测结果明细
func (h *ProbeHandler) ListResults(c *gin.Context) {
	runId, _ := strconv.ParseInt(c.Query("run_id"), 10, 64)
	limit, _ := strconv.Atoi(c.DefaultQuery("limit", "200"))
	onlyFailed := c.Query("only_failed") == "1" || strings.EqualFold(c.Query("only_failed"), "true")

	results, err := h.store.ListResults(runId, c.Query("kind"), onlyFailed, limit)
	if err != nil {
		h.logger.Error("查询探测结果明细失败", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if results == nil {
		results = []store.ProbeResult{}
	}
	c.JSON(http.StatusOK, gin.H{"data": results})
}

// TestWebhook 发送一条测试卡片，验证 webhook 是否可用
func (h *ProbeHandler) TestWebhook(c *gin.Context) {
	var body struct {
		WebhookURL string `json:"webhook_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if strings.TrimSpace(body.WebhookURL) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "webhook_url is required"})
		return
	}

	now := time.Now()
	msg := notifier.AlertMessage{
		RuleName:    "[渠道探测] 测试消息",
		RuleType:    "probe-test",
		MatchCount:  0,
		WindowStart: now,
		WindowEnd:   now,
		Condition:   "webhook 连通性测试",
		Description: "这是一条来自渠道探测配置页的测试消息，收到说明 webhook 配置可用。",
	}

	if err := h.notifier.Send(body.WebhookURL, msg); err != nil {
		h.logger.Error("发送探测测试消息失败", zap.Error(err))
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true})
}

// validateAvailabilityConfig 校验可用性探测配置的取值
func validateAvailabilityConfig(cfg probe.AvailabilityConfig) error {
	if cfg.Concurrency < 1 {
		return fmt.Errorf("并发数必须大于 0")
	}
	if cfg.TimeoutSec <= 0 {
		return fmt.Errorf("单请求超时必须大于 0 秒")
	}
	if cfg.MaxTokens < 1 {
		return fmt.Errorf("max_tokens 必须大于 0")
	}
	if cfg.MaxModelsPerChannel < 0 {
		return fmt.Errorf("每渠道最多模型数不能为负数")
	}
	return nil
}

// validateQualityConfig 校验质量探测配置的取值
func validateQualityConfig(cfg probe.QualityConfig) error {
	if cfg.TimeoutSec <= 0 {
		return fmt.Errorf("单任务超时必须大于 0 秒")
	}
	if cfg.ScoreThreshold < 0 {
		return fmt.Errorf("分数告警阈值不能为负数")
	}
	return nil
}
