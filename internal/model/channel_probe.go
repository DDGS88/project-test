package model

import "time"

// ProbeSetting 探测配置（键值对，value 为 JSON 字符串）
type ProbeSetting struct {
	Key   string `gorm:"type:varchar(64);primaryKey" json:"key"`
	Value string `gorm:"type:text" json:"value"`
}

func (ProbeSetting) TableName() string {
	return "probe_settings"
}

// ProbeRun 一次探测运行记录（kind 区分可用性 / 质量）
type ProbeRun struct {
	Id         int64      `gorm:"primaryKey;autoIncrement" json:"id"`
	Kind       string     `gorm:"type:varchar(16);index;not null" json:"kind"`
	Trigger    string     `gorm:"type:varchar(16)" json:"trigger"` // cron / manual
	Status     string     `gorm:"type:varchar(16);index" json:"status"`
	StartedAt  time.Time  `json:"started_at"`
	FinishedAt *time.Time `json:"finished_at,omitempty"`
	Total      int        `gorm:"default:0" json:"total"`
	OkCount    int        `gorm:"default:0" json:"ok_count"`
	FailCount  int        `gorm:"default:0" json:"fail_count"`
	SkipCount  int        `gorm:"default:0" json:"skip_count"`
	Message    string     `gorm:"type:varchar(512)" json:"message"`
	CreatedAt  time.Time  `json:"created_at"`
}

func (ProbeRun) TableName() string {
	return "probe_runs"
}

// ProbeResult 单条探测结果
//
// 可用性探测使用 StatusCode / LatencyMs / Error；
// 质量探测使用 Score / Verdict / ReportUrl。
type ProbeResult struct {
	Id          int64     `gorm:"primaryKey;autoIncrement" json:"id"`
	RunId       int64     `gorm:"index;not null" json:"run_id"`
	Kind        string    `gorm:"type:varchar(16);index" json:"kind"`
	ChannelId   int64     `gorm:"index" json:"channel_id"`
	ChannelName string    `gorm:"type:varchar(191)" json:"channel_name"`
	Model       string    `gorm:"type:varchar(255)" json:"model"`
	Status      string    `gorm:"type:varchar(16);index" json:"status"` // ok / fail / skip
	StatusCode  int       `json:"status_code"`
	LatencyMs   int64     `json:"latency_ms"`
	Error       string    `gorm:"type:varchar(512)" json:"error"`
	Score       float64   `json:"score"`
	Verdict     string    `gorm:"type:varchar(64)" json:"verdict"`
	ReportUrl   string    `gorm:"type:varchar(512);column:report_url" json:"report_url"`
	ProbedAt    time.Time `gorm:"index" json:"probed_at"`
}

func (ProbeResult) TableName() string {
	return "probe_results"
}
