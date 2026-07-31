package model

// Log 网关日志表模型（只读）
type Log struct {
	Id                int    `gorm:"primaryKey"`
	UserId            int    `gorm:"index"`
	CreatedAt         int64  `gorm:"index:idx_created_at_id;index:idx_created_at_type"`
	Type              int    `gorm:"index:idx_created_at_type"`
	Content           string `gorm:"type:text"`
	Username          string `gorm:"index"`
	TokenName         string `gorm:"index"`
	ModelName         string `gorm:"index"`
	Quota             int    `gorm:"default:0"`
	PromptTokens      int    `gorm:"default:0"`
	CompletionTokens  int    `gorm:"default:0"`
	UseTime           int    `gorm:"default:0"`
	IsStream          bool
	ChannelId         int    `gorm:"index"`
	ChannelName       string `gorm:"->"` // 只读
	TokenId           int    `gorm:"default:0;index"`
	Group             string `gorm:"index"`
	Ip                string `gorm:"index;default:''"`
	RequestId         string `gorm:"type:varchar(64);index:idx_logs_request_id;default:''"`
	UpstreamRequestId string `gorm:"type:varchar(128);index:idx_logs_upstream_request_id;default:''"`
	ResponseId        string `gorm:"type:varchar(128);default:''"`
	Other             string
}

func (Log) TableName() string {
	return "logs"
}
