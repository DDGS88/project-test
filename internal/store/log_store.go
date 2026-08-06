package store

import (
	"fmt"
	"strings"
	"time"
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
func (s *LogStore) CountRegex(startTime, endTime int64, channelId int, field, pattern, modelName string, negate, excludeEmpty bool, logType int) (int64, error) {
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

	if logType > 0 {
		query = query.Where("type = ?", logType)
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
func (s *LogStore) GetRegexSamples(startTime, endTime int64, channelId int, field, pattern, modelName string, negate, excludeEmpty bool, logType int) ([]LogSample, error) {
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

	if logType > 0 {
		query = query.Where("type = ?", logType)
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

// GroupCount 按维度分组的统计结果
type GroupCount struct {
	GroupValue string `json:"group_value"`
	Count      int64  `json:"count"`
}

// alertGranularityFields 告警粒度到数据库字段的映射
var alertGranularityFields = map[string]string{
	"按模型": "model_name",
	"按渠道": "channel_name",
	"按用户": "username",
}

// CountErrorLogsGrouped 统计 type=5 错误日志并按维度分组
func (s *LogStore) CountErrorLogsGrouped(startTime, endTime int64, patternKeyword, groupByField string) ([]GroupCount, error) {
	col, ok := alertGranularityFields[groupByField]
	if !ok {
		return nil, fmt.Errorf("unsupported alert granularity: %s", groupByField)
	}

	query := s.db.Model(&model.Log{}).
		Select(fmt.Sprintf("%s AS group_value, COUNT(*) AS count", col)).
		Where("created_at >= ? AND created_at < ?", startTime, endTime).
		Where("type = ?", 5).
		Where("content "+s.regexOp+" ?", patternKeyword).
		Group(col).
		Order("count DESC")

	var results []GroupCount
	if err := query.Scan(&results).Error; err != nil {
		return nil, err
	}
	return results, nil
}

// GroupedStatItem 按维度分组的统计项
type GroupedStatItem struct {
	GroupValue string `json:"group_value"`
	Count      int64  `json:"count"`
	RawKey     string `json:"raw_key"`  // 原始分组键（渠道为 channel_id，用于二次查询）
	Keywords   string `json:"keywords"` // 该分组下的关键词摘要（仅按关键词时有值）
}

// GetGroupedErrorStats 按维度分组统计 type=5 错误日志，支持时间窗口
// 渠道维度返回 channel_id（调用方需自行通过 channels 表映射名称）
func (s *LogStore) GetGroupedErrorStats(dimension string, windowHours int) ([]GroupedStatItem, error) {
	windowStart := time.Now().Add(-time.Duration(windowHours) * time.Hour).Unix()

	colMap := map[string]string{
		"channel": "channel_id",
		"model":   "model_name",
		"user":    "username",
	}
	col, ok := colMap[dimension]
	if !ok {
		return nil, fmt.Errorf("unsupported dimension: %s", dimension)
	}

	query := s.db.Model(&model.Log{}).
		Select(fmt.Sprintf("%s AS group_value, %s AS raw_key, COUNT(*) AS count", col, col)).
		Where("type = ?", 5).
		Where("created_at >= ?", windowStart)

	if dimension == "channel" {
		query = query.Where("channel_id != 0")
	} else {
		query = query.Where(col + " != ''")
	}

	var results []GroupedStatItem
	err := query.Group(col).
		Order("count DESC").
		Limit(50).
		Scan(&results).Error
	return results, err
}

// GetGroupedErrorByKeyword 按关键词分组统计（取 content 前 60 字符作为分组键）
func (s *LogStore) GetGroupedErrorByKeyword(windowHours int) ([]GroupedStatItem, error) {
	windowStart := time.Now().Add(-time.Duration(windowHours) * time.Hour).Unix()

	var results []GroupedStatItem
	err := s.db.Model(&model.Log{}).
		Select("LEFT(content, 60) AS group_value, COUNT(*) AS count").
		Where("type = ?", 5).
		Where("created_at >= ?", windowStart).
		Where("content != ''").
		Group("LEFT(content, 60)").
		Order("count DESC").
		Limit(50).
		Scan(&results).Error
	return results, err
}

// GroupedErrorDetail 分组错误明细（单条日志）
type GroupedErrorDetail struct {
	Id          int64  `json:"id"`
	Content     string `json:"content"`
	Other       string `json:"other"`
	ModelName   string `json:"model_name"`
	ChannelName string `json:"channel_name"`
	ChannelId   int    `json:"channel_id"`
	Username    string `json:"username"`
	GroupName   string `json:"group_name"`
	CreatedAt   int64  `json:"created_at"`
}

// GetGroupedErrorSamples 按维度获取分组下的错误日志明细
func (s *LogStore) GetGroupedErrorSamples(dimension, rawKey string, windowHours, limit int) ([]GroupedErrorDetail, error) {
	windowStart := time.Now().Add(-time.Duration(windowHours) * time.Hour).Unix()

	colMap := map[string]string{
		"channel": "channel_id",
		"model":   "model_name",
		"user":    "username",
		"keyword": "content",
	}
	col, ok := colMap[dimension]
	if !ok {
		return nil, fmt.Errorf("unsupported dimension: %s", dimension)
	}

	qo, qc := s.quoteGroup()

	query := s.db.Model(&model.Log{}).
		Select(fmt.Sprintf("id, LEFT(content, 200) AS content, other, model_name, channel_name, channel_id, username, %s AS group_name, created_at", qo+"group"+qc)).
		Where("type = ?", 5).
		Where("created_at >= ?", windowStart)

	if dimension == "keyword" {
		query = query.Where("content LIKE ?", "%"+rawKey+"%")
	} else {
		query = query.Where(col+" = ?", rawKey)
	}

	var results []GroupedErrorDetail
	err := query.Order("created_at DESC").
		Limit(limit).
		Scan(&results).Error
	return results, err
}

// quoteGroup 返回 group 列名的引号字符（open, close），兼容 MySQL/PG
func (s *LogStore) quoteGroup() (string, string) {
	if s.regexOp == "~*" {
		return "\"", "\""
	}
	return "`", "`"
}

// ErrorSample 错误类型样本
type ErrorSample struct {
	Content     string `json:"content"`
	Other       string `json:"other"`
	ModelName   string `json:"model_name"`
	ChannelName string `json:"channel_name"`
	GroupName   string `json:"group_name"`
	Cnt         int64  `json:"cnt"`
}

// GetRecentErrorSamples 获取最近 type=5 错误日志的不同类型样本（按 content 前 120 字符分组去重）
func (s *LogStore) GetRecentErrorSamples(limit int) ([]ErrorSample, error) {
	qo, qc := s.quoteGroup()
	var results []ErrorSample
	err := s.db.Model(&model.Log{}).
		Select(fmt.Sprintf("LEFT(content, 120) AS content, other, model_name, channel_name, %s AS group_name, COUNT(*) AS cnt", qo+"group"+qc)).
		Where("type = ?", 5).
		Where("content != ''").
		Group(fmt.Sprintf("LEFT(content, 120), other, model_name, channel_name, %s", qo+"group"+qc)).
		Order("MAX(created_at) DESC").
		Limit(limit).
		Scan(&results).Error
	return results, err
}

// OverviewStats 概览统计
type OverviewStats struct {
	TotalErrors     int64   `json:"total_errors"`
	MatchedErrors   int64   `json:"matched_errors"`
	UnmatchedErrors int64   `json:"unmatched_errors"`
	MatchRate       float64 `json:"match_rate"`
	ActiveRules     int64   `json:"active_rules"`
}

// GetOverviewStats 获取指定时间窗口内错误日志概览统计
func (s *LogStore) GetOverviewStats(rulePatterns []string, windowHours int) (*OverviewStats, error) {
	stats := &OverviewStats{}
	since := time.Now().Add(-time.Duration(windowHours) * time.Hour).Unix()

	// 总 type=5 错误数
	if err := s.db.Model(&model.Log{}).
		Where("type = ?", 5).
		Where("created_at >= ?", since).
		Count(&stats.TotalErrors).Error; err != nil {
		return nil, err
	}

	// 已匹配数：各规则的 pattern 匹配的总数
	stats.MatchedErrors = 0
	for _, pattern := range rulePatterns {
		if pattern == "" {
			continue
		}
		var cnt int64
		if err := s.db.Model(&model.Log{}).
			Where("type = ?", 5).
			Where("created_at >= ?", since).
			Where("content "+s.regexOp+" ?", pattern).
			Count(&cnt).Error; err != nil {
			return nil, err
		}
		stats.MatchedErrors += cnt
	}

	stats.UnmatchedErrors = stats.TotalErrors - stats.MatchedErrors
	if stats.TotalErrors > 0 {
		stats.MatchRate = float64(stats.MatchedErrors) / float64(stats.TotalErrors) * 100
	}

	return stats, nil
}

// ErrorSampleWithId 带ID的错误样本（用于转换规则时需要日志数据）
type ErrorSampleWithId struct {
	Id          int64  `json:"id"`
	Content     string `json:"content"`
	Other       string `json:"other"`
	ModelName   string `json:"model_name"`
	ChannelName string `json:"channel_name"`
	Username    string `json:"username"`
	Cnt         int64  `json:"cnt"`
}

// GetUnmatchedErrorSamples 获取最近 24 小时未匹配规则的错误样本
func (s *LogStore) GetUnmatchedErrorSamples(rulePatterns []string, limit int) ([]ErrorSampleWithId, error) {
	var results []ErrorSampleWithId
	since := time.Now().Add(-24 * time.Hour).Unix()

	query := s.db.Model(&model.Log{}).
		Select("MIN(id) AS id, LEFT(content, 120) AS content, other, model_name, channel_name, username, COUNT(*) AS cnt").
		Where("type = ?", 5).
		Where("created_at >= ?", since).
		Where("content != ''")

	// 排除已匹配的 pattern（逐个 NOT REGEXP / !~*）
	for _, pattern := range rulePatterns {
		if pattern != "" {
			query = query.Where("content "+s.negateOp()+" ?", pattern)
		}
	}

	err := query.Group("LEFT(content, 120), other, model_name, channel_name, username").
		Order("cnt DESC").
		Limit(limit).
		Scan(&results).Error
	return results, err
}
