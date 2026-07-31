package model

// Ability 渠道模型关联表模型（只读）
type Ability struct {
	Group     string `gorm:"type:varchar(64);primaryKey"`
	Model     string `gorm:"type:varchar(255);primaryKey"`
	ChannelId int64  `gorm:"primaryKey;index:idx_abilities_channel_id"`
	Enabled   *bool  `gorm:"default:true"`
	Priority  int64  `gorm:"default:0;index:idx_abilities_priority"`
	Weight    int64  `gorm:"default:0;index:idx_abilities_weight"`
	Tag       string `gorm:"type:varchar(191);index:idx_abilities_tag"`
}

func (Ability) TableName() string {
	return "abilities"
}

// ChannelWithModels 渠道 + 关联模型列表（API 返回用）
type ChannelWithModels struct {
	ChannelId int64    `json:"channel_id"`
	Name      string   `json:"name"`
	Tag       string   `json:"tag,omitempty"`
	Models    []string `json:"models"`
}
