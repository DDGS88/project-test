package engine

import (
	"tt-inspector/internal/store"

	"gorm.io/gorm"
)

// RegexCondition 正则匹配条件
type RegexCondition struct {
	ChannelId    int    `json:"channel_id"`
	Pattern      string `json:"pattern"`
	Field        string `json:"field"`
	ModelName    string `json:"model_name"`
	LogType      int    `json:"log_type"`      // 日志类型过滤，0表示不过滤，5表示上游错误
	Negate       bool   `json:"negate"`        // 反向匹配（SQL 用 NOT ~* / NOT REGEXP）
	ExcludeEmpty bool   `json:"exclude_empty"` // 排除空字符串
}

// RegexRule 正则匹配规则
type RegexRule struct{}

func (r *RegexRule) Evaluate(db *gorm.DB, rule *store.AlertRule, windowStart, windowEnd int64) (int64, error) {
	var cond RegexCondition
	if err := ParseJSON(rule.Condition, &cond); err != nil {
		return 0, err
	}

	if cond.Field == "" {
		cond.Field = "content"
	}

	logStore := store.NewLogStore(db)
	return logStore.CountRegex(windowStart, windowEnd, cond.ChannelId, cond.Field, cond.Pattern, cond.ModelName, cond.Negate, cond.ExcludeEmpty, cond.LogType)
}
