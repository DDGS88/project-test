package notifier

import "time"

// AlertMessage 告警消息
type AlertMessage struct {
	RuleName    string          `json:"rule_name"`
	RuleType    string          `json:"rule_type"`
	MatchCount  int             `json:"match_count"`
	Threshold   int             `json:"threshold"`
	WindowStart time.Time       `json:"window_start"`
	WindowEnd   time.Time       `json:"window_end"`
	Condition   string          `json:"condition"`
	Description string          `json:"description"`
	Samples     []LogSampleItem `json:"samples"`
	AtUsers     []string        `json:"at_users"`
}

// LogSampleItem 匹配到的单条日志样本
type LogSampleItem struct {
	MatchedValue string `json:"matched_value"`
	ResponseID   string `json:"response_id"`
	RequestID    string `json:"request_id"`
	ChannelName  string `json:"channel_name"`
	ModelName    string `json:"model_name"`
	IsStream     bool   `json:"is_stream"`
}

// Notifier 通知接口
type Notifier interface {
	Send(webhookURL string, msg AlertMessage) error
}
