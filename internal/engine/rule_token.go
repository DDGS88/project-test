package engine

// TokenThresholdCondition Token 消耗阈值条件（扩展预留）
type TokenThresholdCondition struct {
	UserId                 int    `json:"user_id"`
	ModelName              string `json:"model_name"`
	TokenField             string `json:"token_field"`
	SingleRequestThreshold int    `json:"single_request_threshold"`
}
