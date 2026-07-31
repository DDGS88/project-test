package api

import (
	"net/http"
	"strconv"

	"tt-inspector/internal/engine"
	"tt-inspector/internal/store"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gorm.io/gorm"
)

type RuleHandler struct {
	store  *store.RuleStore
	engine *engine.Engine
	logger *zap.Logger
}

func (h *RuleHandler) List(c *gin.Context) {
	rules, err := h.store.List()
	if err != nil {
		h.logger.Error("list rules failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if rules == nil {
		rules = []store.AlertRule{}
	}
	c.JSON(http.StatusOK, gin.H{"data": rules})
}

func (h *RuleHandler) Create(c *gin.Context) {
	var rule store.AlertRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if rule.Name == "" || rule.RuleType == "" || rule.Condition == "" || rule.WebhookURL == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "name, rule_type, condition, webhook_url are required"})
		return
	}

	if rule.WindowSec <= 0 {
		rule.WindowSec = 300
	}
	if rule.CooldownSec <= 0 {
		rule.CooldownSec = 600
	}
	if rule.Threshold <= 0 {
		rule.Threshold = 1
	}

	if err := h.store.Create(&rule); err != nil {
		h.logger.Error("create rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// 通知引擎热加载
	h.engine.ReloadRules()

	h.logger.Info("rule created", zap.Int64("id", rule.Id), zap.String("name", rule.Name))
	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *RuleHandler) Get(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	rule, err := h.store.Get(id)
	if err != nil {
		if err == gorm.ErrRecordNotFound {
			c.JSON(http.StatusNotFound, gin.H{"error": "rule not found"})
			return
		}
		h.logger.Error("get rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *RuleHandler) Update(c *gin.Context) {
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
		h.logger.Error("get rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	var rule store.AlertRule
	if err := c.ShouldBindJSON(&rule); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	rule.Id = id
	rule.CreatedAt = existing.CreatedAt

	if rule.WindowSec <= 0 {
		rule.WindowSec = existing.WindowSec
	}
	if rule.CooldownSec <= 0 {
		rule.CooldownSec = existing.CooldownSec
	}
	if rule.Threshold <= 0 {
		rule.Threshold = existing.Threshold
	}

	if err := h.store.Update(&rule); err != nil {
		h.logger.Error("update rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.engine.ReloadRules()

	h.logger.Info("rule updated", zap.Int64("id", rule.Id))
	c.JSON(http.StatusOK, gin.H{"data": rule})
}

func (h *RuleHandler) Delete(c *gin.Context) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if err := h.store.Delete(id); err != nil {
		h.logger.Error("delete rule failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.engine.ReloadRules()

	h.logger.Info("rule deleted", zap.Int64("id", id))
	c.JSON(http.StatusOK, gin.H{"message": "deleted"})
}

func (h *RuleHandler) Enable(c *gin.Context) {
	h.setEnabled(c, true)
}

func (h *RuleHandler) Disable(c *gin.Context) {
	h.setEnabled(c, false)
}

func (h *RuleHandler) setEnabled(c *gin.Context, enabled bool) {
	id, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid id"})
		return
	}

	if err := h.store.SetEnabled(id, enabled); err != nil {
		h.logger.Error("set enabled failed", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	h.engine.ReloadRules()

	action := "disabled"
	if enabled {
		action = "enabled"
	}
	h.logger.Info("rule "+action, zap.Int64("id", id))
	c.JSON(http.StatusOK, gin.H{"message": action})
}

// TestMatchRequest 测试匹配请求
type TestMatchRequest struct {
	RuleType    string `json:"rule_type"`
	ChannelId   int    `json:"channel_id"`
	Pattern     string `json:"pattern"`
	Field       string `json:"field"`
	WindowStart int64  `json:"window_start"`
	WindowEnd   int64  `json:"window_end"`
}

func (h *RuleHandler) TestMatch(c *gin.Context) {
	var req TestMatchRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.RuleType != "regex" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only regex rule type is supported for test"})
		return
	}

	if req.WindowStart <= 0 || req.WindowEnd <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "window_start and window_end are required"})
		return
	}

	if req.Pattern == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "pattern is required"})
		return
	}

	result := h.engine.TestMatch(&engine.LogMatchRequest{
		RuleType:    req.RuleType,
		ChannelId:   req.ChannelId,
		Pattern:     req.Pattern,
		Field:       req.Field,
		WindowStart: req.WindowStart,
		WindowEnd:   req.WindowEnd,
	})

	if result.Error != "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": result.Error})
		return
	}

	c.JSON(http.StatusOK, gin.H{"data": result})
}
