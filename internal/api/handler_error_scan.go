package api

import (
	"net/http"
	"strconv"
	"strings"

	"tt-inspector/internal/engine"
	"tt-inspector/internal/store"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type ErrorScanHandler struct {
	store         *store.ErrorScanStore
	logStore      *store.LogStore
	classifyStore *store.ErrorClassifyStore
	channelStore  *store.ChannelStore
	scanner       *engine.ErrorScanner
	logger        *zap.Logger
}

func (h *ErrorScanHandler) List(c *gin.Context) {
	rules, err := h.store.List()
	if err != nil {
		h.logger.Error("list error scan rules failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if rules == nil {
		rules = []store.ErrorScanRule{}
	}
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

func (h *ErrorScanHandler) Create(c *gin.Context) {
	var rule store.ErrorScanRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if rule.Code == "" || rule.Name == "" || rule.Category == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "code, name, category are required"})
		return
	}

	if err := h.store.Create(&rule); err != nil {
		h.logger.Error("create error scan rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *ErrorScanHandler) Update(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	existing, err := h.store.Get(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var rule store.ErrorScanRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule.Id = id
	rule.CreatedAt = existing.CreatedAt

	if err := h.store.Update(&rule); err != nil {
		h.logger.Error("update error scan rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *ErrorScanHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if err := h.store.Delete(id); err != nil {
		h.logger.Error("delete error scan rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *ErrorScanHandler) ToggleAlert(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	rule, err := h.store.Get(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}

	if err := h.store.SetAlertEnabled(id, !rule.IsAlertEnabled); err != nil {
		h.logger.Error("toggle alert failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *ErrorScanHandler) ToggleSuppressed(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	rule, err := h.store.Get(id)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
		return
	}

	if err := h.store.SetSuppressed(id, !rule.Suppressed); err != nil {
		h.logger.Error("toggle suppressed failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *ErrorScanHandler) UpdateFeishuWebhook(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var body struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.store.SetFeishuWebhook(id, body.URL); err != nil {
		h.logger.Error("update feishu webhook failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *ErrorScanHandler) BulkUpdateFeishuWebhook(c *gin.Context) {
	var body struct {
		URL string `json:"url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.store.BulkSetFeishuWebhook(body.URL); err != nil {
		h.logger.Error("bulk update feishu webhook failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *ErrorScanHandler) UpdateGranularity(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var body struct {
		ScanGranularity  string `json:"scan_granularity"`
		AlertGranularity string `json:"alert_granularity"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.store.UpdateGranularity(id, body.ScanGranularity, body.AlertGranularity); err != nil {
		h.logger.Error("update granularity failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *ErrorScanHandler) UpdateThresholdAndExcludes(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	var body struct {
		AlertThreshold  int    `json:"alert_threshold"`
		ExcludeChannels string `json:"exclude_channels"`
		ExcludeUsers    string `json:"exclude_users"`
		FilterMode      string `json:"filter_mode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.store.UpdateThresholdAndExcludes(id, body.AlertThreshold, body.ExcludeChannels, body.ExcludeUsers, body.FilterMode); err != nil {
		h.logger.Error("update threshold and excludes failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *ErrorScanHandler) GetPollInterval(c *gin.Context) {
	seconds := int(h.scanner.GetPollInterval().Seconds())
	c.JSON(http.StatusOK, gin.H{"data": seconds})
}

func (h *ErrorScanHandler) SetPollInterval(c *gin.Context) {
	var body struct {
		Seconds int `json:"seconds"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.Seconds < 10 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "poll interval must be at least 10 seconds"})
		return
	}
	h.scanner.SetPollInterval(body.Seconds)
	c.JSON(http.StatusOK, gin.H{"data": body.Seconds})
}

func (h *ErrorScanHandler) TestWebhook(c *gin.Context) {
	var body struct {
		WebhookURL string `json:"webhook_url"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if body.WebhookURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "webhook_url is required"})
		return
	}

	err := h.scanner.TestWebhook(body.WebhookURL)
	if err != nil {
		c.JSON(http.StatusOK, gin.H{"success": false, "error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "webhook sent successfully"})
}

func (h *ErrorScanHandler) TriggerScan(c *gin.Context) {
	h.scanner.TriggerScan()
	c.JSON(http.StatusOK, gin.H{"message": "scan triggered"})
}

func (h *ErrorScanHandler) GetRecentErrorSamples(c *gin.Context) {
	samples, err := h.logStore.GetRecentErrorSamples(20)
	if err != nil {
		h.logger.Error("get recent error samples failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if samples == nil {
		samples = []store.ErrorSample{}
	}
	c.JSON(http.StatusOK, gin.H{"data": samples})
}

func (h *ErrorScanHandler) GetOverview(c *gin.Context) {
	rules, err := h.store.List()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	patterns := make([]string, 0, len(rules))
	activeCount := int64(0)
	for _, r := range rules {
		if r.IsAlertEnabled && !r.Suppressed {
			activeCount++
		}
		if r.PatternKeyword != "" {
			patterns = append(patterns, r.PatternKeyword)
		}
	}

	windowHours := 24
	if wh := c.Query("window"); wh != "" {
		if v, err := strconv.Atoi(wh); err == nil && v > 0 {
			windowHours = v
		}
	}

	stats, err := h.logStore.GetOverviewStats(patterns, windowHours)
	if err != nil {
		h.logger.Error("get overview stats failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	stats.ActiveRules = activeCount
	c.JSON(http.StatusOK, gin.H{"data": stats})
}

func (h *ErrorScanHandler) GetUnmatchedSamples(c *gin.Context) {
	rules, _ := h.store.List()
	patterns := make([]string, 0)
	for _, r := range rules {
		if r.PatternKeyword != "" {
			patterns = append(patterns, r.PatternKeyword)
		}
	}

	samples, err := h.logStore.GetUnmatchedErrorSamples(patterns, 20)
	if err != nil {
		h.logger.Error("get unmatched samples failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if samples == nil {
		samples = []store.ErrorSampleWithId{}
	}
	c.JSON(http.StatusOK, gin.H{"data": samples})
}

func (h *ErrorScanHandler) CreateFromSample(c *gin.Context) {
	var body struct {
		Content     string `json:"content"`
		Other       string `json:"other"`
		ModelName   string `json:"model_name"`
		ChannelName string `json:"channel_name"`
		Username    string `json:"username"`
		Code        string `json:"code"`
		Name        string `json:"name"`
		Category    string `json:"category"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// 从 content 中提取关键词（第一个有意义的词或短语）
	keyword := body.Content
	if len(keyword) > 50 {
		keyword = keyword[:50]
	}

	rule := store.ErrorScanRule{
		Code:           body.Code,
		Name:           body.Name,
		Category:       body.Category,
		SubCategory:    body.Name,
		PatternKeyword: keyword,
		TopModel:       body.ModelName,
		TopChannel:     body.ChannelName,
		TopUser:        body.Username,
		AlertThreshold: 5,
		IsAlertEnabled: true,
		Severity:       "warning",
		FilterMode:     "exclude",
		RawLogs:        "[]",
	}
	if err := h.store.Create(&rule); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *ErrorScanHandler) GetFallbackConfig(c *gin.Context) {
	enabled, webhook := h.scanner.GetFallbackConfig()
	c.JSON(http.StatusOK, gin.H{"data": map[string]interface{}{
		"enabled": enabled,
		"webhook": webhook,
	}})
}

func (h *ErrorScanHandler) SetFallbackConfig(c *gin.Context) {
	var body struct {
		Enabled bool   `json:"enabled"`
		Webhook string `json:"webhook"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.scanner.SetFallbackConfig(body.Enabled, body.Webhook)
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

func (h *ErrorScanHandler) GetGroupedStats(c *gin.Context) {
	dimension := c.DefaultQuery("dimension", "channel")
	windowHours := 1
	if wh := c.Query("window"); wh != "" {
		if v, err := strconv.Atoi(wh); err == nil && v > 0 {
			windowHours = v
		}
	}

	var results []store.GroupedStatItem
	var err error

	if dimension == "keyword" {
		results, err = h.logStore.GetGroupedErrorByKeyword(windowHours)
	} else {
		results, err = h.logStore.GetGroupedErrorStats(dimension, windowHours)
	}

	if err != nil {
		h.logger.Error("get grouped stats failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 渠道维度：将 channel_id 映射为渠道名称
	if dimension == "channel" && h.channelStore != nil {
		nameMap, mapErr := h.channelStore.GetChannelNameMap()
		if mapErr != nil {
			h.logger.Warn("get channel name map failed", zap.Error(mapErr))
		} else {
			for i := range results {
				if id, parseErr := strconv.ParseInt(results[i].GroupValue, 10, 64); parseErr == nil {
					if name, ok := nameMap[id]; ok && name != "" {
						results[i].GroupValue = name
					} else {
						results[i].GroupValue = "渠道#" + results[i].GroupValue
					}
				}
			}
		}
	}

	if results == nil {
		results = []store.GroupedStatItem{}
	}
	c.JSON(http.StatusOK, gin.H{"data": results})
}

func (h *ErrorScanHandler) GetGroupedSamples(c *gin.Context) {
	dimension := c.DefaultQuery("dimension", "channel")
	rawKey := c.Query("raw_key")
	if rawKey == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "raw_key is required"})
		return
	}
	windowHours := 1
	if wh := c.Query("window"); wh != "" {
		if v, err := strconv.Atoi(wh); err == nil && v > 0 {
			windowHours = v
		}
	}

	samples, err := h.logStore.GetGroupedErrorSamples(dimension, rawKey, windowHours, 50)
	if err != nil {
		h.logger.Error("get grouped samples failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if samples == nil {
		samples = []store.GroupedErrorDetail{}
	}
	c.JSON(http.StatusOK, gin.H{"data": samples})
}

// ClassifyLog 根据分类规则匹配一条错误日志
func (h *ErrorScanHandler) ClassifyLog(c *gin.Context) {
	var body struct {
		Content     string `json:"content"`
		Other       string `json:"other"`
		ModelName   string `json:"model_name"`
		ChannelName string `json:"channel_name"`
		Username    string `json:"username"`
		Group       string `json:"group"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rules, err := h.classifyStore.List()
	if err != nil {
		h.logger.Error("list classify rules failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 解析 statusCode
	statusCode := 0
	if body.Other != "" {
		// 简单提取 status_code
		for _, part := range strings.Split(body.Other, ",") {
			part = strings.TrimSpace(part)
			if strings.HasPrefix(part, "\"status_code\":") {
				if v, err := strconv.Atoi(strings.Trim(strings.TrimPrefix(part, "\"status_code\":"), "\"")); err == nil {
					statusCode = v
				}
			}
		}
	}

	// 按优先级匹配
	contentLower := strings.ToLower(body.Content)
	for _, rule := range rules {
		keywordLower := strings.ToLower(rule.Keyword)
		if !strings.Contains(contentLower, keywordLower) {
			continue
		}
		// 状态码过滤（0 表示不限）
		if rule.StatusCode != 0 && statusCode != 0 && rule.StatusCode != statusCode {
			continue
		}
		// 命中
		c.JSON(http.StatusOK, gin.H{"data": gin.H{
			"category":        rule.Category,
			"sub_category":    rule.SubCategory,
			"status_code":     statusCode,
			"keyword_matched": rule.Keyword,
			"recommendation":  rule.Recommendation,
			"model":           body.ModelName,
			"channel":         body.ChannelName,
			"username":        body.Username,
			"group":           body.Group,
		}})
		return
	}

	// 无匹配
	c.JSON(http.StatusOK, gin.H{"data": gin.H{
		"category":        "其他参数/网络错误",
		"sub_category":    "未知错误",
		"status_code":     statusCode,
		"keyword_matched": "",
		"recommendation":  "未匹配到已有分类规则，建议查看 content 内容手动归类。",
		"model":           body.ModelName,
		"channel":         body.ChannelName,
		"username":        body.Username,
		"group":           body.Group,
	}})
}

// ── 分类规则管理 ──

func (h *ErrorScanHandler) ListClassifyRules(c *gin.Context) {
	rules, err := h.classifyStore.List()
	if err != nil {
		h.logger.Error("list classify rules failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if rules == nil {
		rules = []store.ErrorClassifyRule{}
	}
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

func (h *ErrorScanHandler) CreateClassifyRule(c *gin.Context) {
	var rule store.ErrorClassifyRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if rule.Keyword == "" || rule.Category == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "keyword and category are required"})
		return
	}
	if err := h.classifyStore.Create(&rule); err != nil {
		h.logger.Error("create classify rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *ErrorScanHandler) DeleteClassifyRule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	if err := h.classifyStore.Delete(id); err != nil {
		h.logger.Error("delete classify rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *ErrorScanHandler) UpdateClassifyRule(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}
	var rule store.ErrorClassifyRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	rule.Id = id
	if err := h.classifyStore.Update(&rule); err != nil {
		h.logger.Error("update classify rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"data": rule})
}
