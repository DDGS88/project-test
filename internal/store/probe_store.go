package store

import (
	"time"

	"tt-inspector/internal/model"

	"gorm.io/gorm"
)

// 探测相关模型别名
type (
	ProbeSetting = model.ProbeSetting
	ProbeRun     = model.ProbeRun
	ProbeResult  = model.ProbeResult
)

// 探测类型
const (
	ProbeKindAvailability = "availability"
	ProbeKindQuality      = "quality"
)

// 运行状态
const (
	ProbeStatusRunning = "running"
	ProbeStatusDone    = "done"
	ProbeStatusFailed  = "failed"
)

// 单条结果状态
const (
	ProbeItemOK   = "ok"
	ProbeItemFail = "fail"
	ProbeItemSkip = "skip"
)

// ProbeStore 探测配置 / 运行记录 / 结果明细存储
type ProbeStore struct {
	db *gorm.DB
}

func NewProbeStore(db *gorm.DB) *ProbeStore {
	return &ProbeStore{db: db}
}

// GetSetting 读取配置项（不存在时返回空字符串）
func (s *ProbeStore) GetSetting(key string) (string, error) {
	var setting ProbeSetting
	err := s.db.Where("key = ?", key).First(&setting).Error
	if err == gorm.ErrRecordNotFound {
		return "", nil
	}
	return setting.Value, err
}

// SetSetting 写入配置项
func (s *ProbeStore) SetSetting(key, value string) error {
	return s.db.Where("key = ?", key).Assign(ProbeSetting{Value: value}).
		FirstOrCreate(&ProbeSetting{Key: key}).Error
}

// CreateRun 创建运行记录
func (s *ProbeStore) CreateRun(run *ProbeRun) error {
	return s.db.Create(run).Error
}

// FinishRun 更新运行结束状态与统计
func (s *ProbeStore) FinishRun(id int64, status string, total, okCount, failCount, skipCount int, message string) error {
	now := time.Now()
	return s.db.Model(&ProbeRun{}).Where("id = ?", id).Updates(map[string]interface{}{
		"status":      status,
		"finished_at": &now,
		"total":       total,
		"ok_count":    okCount,
		"fail_count":  failCount,
		"skip_count":  skipCount,
		"message":     message,
	}).Error
}

// InsertResults 批量写入探测结果
func (s *ProbeStore) InsertResults(results []ProbeResult) error {
	if len(results) == 0 {
		return nil
	}
	return s.db.CreateInBatches(&results, 200).Error
}

// ListRuns 查询运行历史（按 id 倒序）
func (s *ProbeStore) ListRuns(kind string, limit int) ([]ProbeRun, error) {
	if limit <= 0 {
		limit = 20
	}
	q := s.db.Model(&ProbeRun{}).Order("id DESC").Limit(limit)
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	var runs []ProbeRun
	err := q.Find(&runs).Error
	return runs, err
}

// LastRun 查询某类型最近一次运行
func (s *ProbeStore) LastRun(kind string) (*ProbeRun, error) {
	var run ProbeRun
	err := s.db.Where("kind = ?", kind).Order("id DESC").First(&run).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

// ListResults 查询结果明细；onlyFailed 为 true 时只返回失败项
func (s *ProbeStore) ListResults(runId int64, kind string, onlyFailed bool, limit int) ([]ProbeResult, error) {
	if limit <= 0 {
		limit = 200
	}
	q := s.db.Model(&ProbeResult{}).Order("id ASC").Limit(limit)
	if runId > 0 {
		q = q.Where("run_id = ?", runId)
	}
	if kind != "" {
		q = q.Where("kind = ?", kind)
	}
	if onlyFailed {
		q = q.Where("status = ?", ProbeItemFail)
	}
	var results []ProbeResult
	err := q.Find(&results).Error
	return results, err
}

// LatestOKAvailabilityResults 返回「最近一次存在成功结果」的可用性运行的 OK 明细。
// 质量探测以此为候选来源；没有可用记录时返回空切片。
func (s *ProbeStore) LatestOKAvailabilityResults() ([]ProbeResult, error) {
	var run ProbeRun
	err := s.db.Where("kind = ? AND status = ? AND ok_count > 0",
		ProbeKindAvailability, ProbeStatusDone).Order("id DESC").First(&run).Error
	if err == gorm.ErrRecordNotFound {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}

	var results []ProbeResult
	err = s.db.Where("run_id = ? AND status = ?", run.Id, ProbeItemOK).
		Order("channel_id ASC, id ASC").Find(&results).Error
	return results, err
}

// FailStaleRuns 将遗留的 running 状态运行标记为失败（服务重启场景）
func (s *ProbeStore) FailStaleRuns() error {
	return s.db.Model(&ProbeRun{}).Where("status = ?", ProbeStatusRunning).
		Updates(map[string]interface{}{
			"status":      ProbeStatusFailed,
			"message":     "服务重启，运行被中断",
			"finished_at": time.Now(),
		}).Error
}
