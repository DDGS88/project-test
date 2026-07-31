package store

import (
	"fmt"
	"strings"
	"tt-inspector/internal/model"

	"gorm.io/gorm"
)

// LogSample 匹配到的日志样本
type LogSample struct {
	MatchedValue string `json:"matched_value"` // 匹配字段的值
	ResponseID   string `json:"response_id"`   // msg_id
	RequestID    string `json:"request_id"`
}

// LogStore 日志查询（只读）
type LogStore struct {
	db      *gorm.DB
	regexOp string // 正则操作符：MySQL 用 REGEXP，PostgreSQL 用 ~*
}

func NewLogStore(db *gorm.DB) *LogStore {
	op := "REGEXP" // MySQL 默认
	if strings.Contains(db.Dialector.Name(), "postgres") {
		op = "~*"
	}
	return &LogStore{db: db, regexOp: op}
}

// negateOp 返回反向正则操作符：PostgreSQL !~* ，MySQL NOT REGEXP
func (s *LogStore) negateOp() string {
	if s.regexOp == "~*" {
		return "!~*"
	}
	return "NOT REGEXP"
}

// CountByCondition 按条件统计日志数量
func (s *LogStore) CountByCondition(startTime, endTime int64, channelId int, statements []string, args []interface{}) (int64, error) {
	query := s.db.Model(&model.Log{}).
		Where("created_at >= ? AND created_at < ?", startTime, endTime)

	if channelId > 0 {
		query = query.Where("channel_id = ?", channelId)
	}

	for _, stmt := range statements {
		query = query.Where(stmt)
	}

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// allowedFields 允许进行正则匹配的字段白名单（防 SQL 注入）
var allowedFields = map[string]bool{
	"content":             true,
	"other":               true,
	"response_id":         true,
	"request_id":          true,
	"upstream_request_id": true,
}

// CountRegex 统计匹配正则的日志数量
func (s *LogStore) CountRegex(startTime, endTime int64, channelId int, field, pattern, modelName string, negate, excludeEmpty bool) (int64, error) {
	if !allowedFields[field] {
		return 0, fmt.Errorf("invalid field: %s", field)
	}

	query := s.db.Model(&model.Log{}).
		Where("created_at >= ? AND created_at < ?", startTime, endTime)

	if channelId > 0 {
		query = query.Where("channel_id = ?", channelId)
	}

	if modelName != "" && modelName != "全部模型" {
		query = query.Where("model_name = ?", modelName)
	}

	if excludeEmpty {
		query = query.Where(field + " != ''")
	}

	op := s.regexOp
	if negate {
		op = s.negateOp()
	}
	query = query.Where(field+" "+op+" ?", pattern)

	var count int64
	if err := query.Count(&count).Error; err != nil {
		return 0, err
	}
	return count, nil
}

// GetRegexSamples 获取匹配正则的日志样本（前5条，含匹配字段值 + request_id）
func (s *LogStore) GetRegexSamples(startTime, endTime int64, channelId int, field, pattern, modelName string, negate, excludeEmpty bool) ([]LogSample, error) {
	if !allowedFields[field] {
		return nil, fmt.Errorf("invalid field: %s", field)
	}

	query := s.db.Model(&model.Log{}).
		Select(fmt.Sprintf("%s AS matched_value, response_id, request_id", field)).
		Where("created_at >= ? AND created_at < ?", startTime, endTime)

	if channelId > 0 {
		query = query.Where("channel_id = ?", channelId)
	}

	if modelName != "" && modelName != "全部模型" {
		query = query.Where("model_name = ?", modelName)
	}

	if excludeEmpty {
		query = query.Where(field + " != ''")
	}

	op := s.regexOp
	if negate {
		op = s.negateOp()
	}

	query = query.Where(field+" "+op+" ?", pattern).
		Order("created_at DESC").
		Limit(5)

	var samples []LogSample
	if err := query.Scan(&samples).Error; err != nil {
		return nil, err
	}
	return samples, nil
}
