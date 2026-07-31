package model

// Channel 渠道表模型（只读）
type Channel struct {
	Id   int64  `gorm:"primaryKey"`
	Type int64  `gorm:"default:0"`
	Name string `gorm:"type:varchar(191);index:idx_channels_name"`
	Tag  string `gorm:"type:varchar(191);index:idx_channels_tag"`
}

func (Channel) TableName() string {
	return "channels"
}
