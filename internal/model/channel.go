package model

// Channel 渠道表模型（只读）
//
// Key / BaseUrl / Status 供探测功能读取渠道凭据使用：
//   - Key 为渠道 API Key，多 key 时以逗号分隔
//   - BaseUrl 为 OpenAI 兼容根地址（可能带或不带 /v1）
//   - Status 1=启用、2=手动禁用、3=自动禁用
type Channel struct {
	Id      int64  `gorm:"primaryKey"`
	Type    int64  `gorm:"default:0"`
	Name    string `gorm:"type:varchar(191);index:idx_channels_name"`
	Tag     string `gorm:"type:varchar(191);index:idx_channels_tag"`
	Key     string `gorm:"type:text"`
	BaseUrl string `gorm:"column:base_url;type:varchar(255)"`
	Status  int64  `gorm:"default:1"`
}

func (Channel) TableName() string {
	return "channels"
}
