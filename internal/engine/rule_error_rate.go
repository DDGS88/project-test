package engine

// ErrorRateCondition 错误率条件（扩展预留）
type ErrorRateCondition struct {
	ChannelId int `json:"channel_id"`
	Type      int `json:"type"` // type=5 表示上游错误
}
