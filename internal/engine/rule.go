package engine

import (
	"encoding/json"

	"tt-inspector/internal/store"

	"gorm.io/gorm"
)

// Rule 规则评估接口
type Rule interface {
	// Evaluate 评估规则，返回匹配次数
	Evaluate(db *gorm.DB, rule *store.AlertRule, windowStart, windowEnd int64) (int64, error)
}

// ruleFactory 规则工厂
var ruleFactories = map[string]func() Rule{
	"regex":           func() Rule { return &RegexRule{} },
	"error_rate":      func() Rule { return &NoopRule{name: "error_rate"} },
	"token_threshold": func() Rule { return &NoopRule{name: "token_threshold"} },
}

// GetRule 根据规则类型获取对应的 Rule 实现
func GetRule(ruleType string) Rule {
	if factory, ok := ruleFactories[ruleType]; ok {
		return factory()
	}
	return nil
}

// RegisterRule 注册新规则类型（扩展用）
func RegisterRule(ruleType string, factory func() Rule) {
	ruleFactories[ruleType] = factory
}

// NoopRule 未实现的规则类型（占位）
type NoopRule struct {
	name string
}

func (r *NoopRule) Evaluate(_ *gorm.DB, _ *store.AlertRule, _, _ int64) (int64, error) {
	return 0, nil
}

// ParseJSON 解析 JSON 条件到目标结构体
func ParseJSON(jsonStr string, target interface{}) error {
	return json.Unmarshal([]byte(jsonStr), target)
}
