package model

import "time"

// ErrorClassifyRule 错误分类规则（关键词→分类映射）
type ErrorClassifyRule struct {
	Id             int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	Keyword        string    `gorm:"type:varchar(256);not null" json:"keyword"`
	StatusCode     int       `gorm:"default:0" json:"status_code"` // 0=不限状态码
	Category       string    `gorm:"type:varchar(64);not null" json:"category"`
	SubCategory    string    `gorm:"type:varchar(256);not null" json:"sub_category"`
	Recommendation string    `gorm:"type:text" json:"recommendation"`
	Priority       int       `gorm:"default:0" json:"priority"` // 越高越优先
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}
