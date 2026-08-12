package model

import "time"

// ErrorScanRule 错误扫描告警规则
type ErrorScanRule struct {
	Id               int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Code             string    `gorm:"type:varchar(64);not null" json:"code"`
	Name             string    `gorm:"type:varchar(128);not null" json:"name"`
	Category         string    `gorm:"type:varchar(64);not null" json:"category"`
	SubCategory      string    `gorm:"type:varchar(256)" json:"sub_category"`
	StatusCode       int       `gorm:"default:0" json:"status_code"`
	PatternKeyword   string    `gorm:"type:varchar(256)" json:"pattern_keyword"`
	TopModel         string    `gorm:"type:varchar(128)" json:"top_model"`
	TopChannel       string    `gorm:"type:varchar(128)" json:"top_channel"`
	TopUser          string    `gorm:"type:varchar(128)" json:"top_user"`
	TopEndpoint      string    `gorm:"type:varchar(256)" json:"top_endpoint"`
	HourlyErrorCnt   int       `gorm:"default:0" json:"hourly_error_count"`
	DailyErrorCnt    int       `gorm:"default:0" json:"daily_error_count"`
	AlertThreshold   int       `gorm:"default:10" json:"alert_threshold"`
	SampleLog        string    `gorm:"type:text" json:"sample_log"`
	IsAlertEnabled   bool      `gorm:"default:true" json:"is_alert_enabled"`
	Suppressed       bool      `gorm:"default:false" json:"suppressed"`
	ScanGranularity  string    `gorm:"type:varchar(32);default:'小时 (Hourly)'" json:"scan_granularity"`
	AlertGranularity string    `gorm:"type:varchar(32);default:'按错误精细类型'" json:"alert_granularity"`
	FilterMode       string    `gorm:"type:varchar(16);default:'exclude'" json:"filter_mode"` // exclude 排除 / include 仅选中
	ExcludeChannels  string    `gorm:"type:text" json:"exclude_channels"`                     // 排除/选中的渠道，逗号分隔
	ExcludeUsers     string    `gorm:"type:text" json:"exclude_users"`                        // 排除/选中的用户，逗号分隔
	Severity         string    `gorm:"type:varchar(16);default:'warning'" json:"severity"`
	FeishuWebhook    string    `gorm:"type:varchar(512);column:feishu_webhook" json:"feishu_webhook_url"`
	RawLogs          string    `gorm:"type:text" json:"raw_logs"` // JSON array of log entries
	CreatedAt        time.Time `json:"created_at"`
	UpdatedAt        time.Time `json:"updated_at"`
}

// ScanSetting 错误扫描全局设置（键值对存储）
type ScanSetting struct {
	Key   string `gorm:"type:varchar(64);primaryKey" json:"key"`
	Value string `gorm:"type:text" json:"value"`
}
