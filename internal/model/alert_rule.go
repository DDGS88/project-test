package model

import "time"

// AlertRule 告警规则表模型
type AlertRule struct {
	Id        int64  `gorm:"primaryKey;autoIncrement" json:"id"`
	Name      string `gorm:"type:varchar(128);not null" json:"name"`
	Enabled   bool   `gorm:"default:true;index" json:"enabled"`
	RuleType  string `gorm:"type:varchar(32);not null;index" json:"rule_type"`
	Condition string `gorm:"type:text;not null" json:"condition"`

	WindowSec   int `gorm:"default:300" json:"window_sec"`
	Threshold   int `gorm:"default:1" json:"threshold"`
	CooldownSec int `gorm:"default:600" json:"cooldown_sec"`

	WebhookURL string `gorm:"type:varchar(512);not null" json:"webhook_url"`

	Description string    `gorm:"type:varchar(512)" json:"description"`
	CreatedAt   time.Time `gorm:"autoCreateTime" json:"created_at"`
	UpdatedAt   time.Time `gorm:"autoUpdateTime" json:"updated_at"`
}

func (AlertRule) TableName() string {
	return "alert_rules"
}
