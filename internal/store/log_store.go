package store

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
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
	ChannelId    int    `json:"channel_id"`
	ModelName    string `json:"model_name"`
	IsStream     bool   `json:"is_stream"`
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

// CountRegexBatch 批量统计多个正则的匹配数量（共享同一组过滤条件）
// 将 N 次 COUNT 合并为 1 次 SUM(CASE WHEN)，窗口内只扫一遍日志。
// 返回的计数与 patterns 一一对应。
func (s *LogStore) CountRegexBatch(startTime, endTime int64, channelId int, field, modelName string, negate, excludeEmpty bool, logType int, patterns []string) ([]int64, error) {
	if !allowedFields[field] {
		return nil, fmt.Errorf("invalid field: %s", field)
	}
	if len(patterns) == 0 {
		return []int64{}, nil
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

	selects := make([]string, 0, len(patterns))
	args := make([]interface{}, 0, len(patterns))
	for _, p := range patterns {
		selects = append(selects,
			fmt.Sprintf("COALESCE(SUM(CASE WHEN %s %s ? THEN 1 ELSE 0 END), 0)", field, op))
		args = append(args, p)
	}

	query = query.Select(strings.Join(selects, ", "), args...)

	counts := make([]int64, len(patterns))
	dest := make([]interface{}, len(patterns))
	for i := range counts {
		dest[i] = &counts[i]
	}

	if err := query.Row().Scan(dest...); err != nil {
		return nil, err
	}
	return counts, nil
}

// GetRegexSamples 获取匹配正则的日志样本（前5条，含匹配字段值 + request_id）
func (s *LogStore) GetRegexSamples(startTime, endTime int64, channelId int, field, pattern, modelName string, negate, excludeEmpty bool, logType int) ([]LogSample, error) {
	if !allowedFields[field] {
		return nil, fmt.Errorf("invalid field: %s", field)
	}

	query := s.db.Model(&model.Log{}).
		Select(fmt.Sprintf("%s AS matched_value, response_id, request_id, channel_id, model_name, is_stream", field)).
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

// ScanLogEntry 扫描匹配用的错误日志条目（内存批量匹配规则）
type ScanLogEntry struct {
	Content     string
	ChannelName string
	ModelName   string
	Username    string
}

// GetErrorLogsForScan 获取窗口内 type=5 错误日志，供内存批量匹配规则
// 一次查询即可供所有规则使用，避免每条规则各自扫表做正则。
func (s *LogStore) GetErrorLogsForScan(startTime, endTime int64) ([]ScanLogEntry, error) {
	var results []ScanLogEntry
	err := s.db.Model(&model.Log{}).
		Select("content, channel_name, model_name, username").
		Where("type = ?", 5).
		Where("created_at >= ? AND created_at < ?", startTime, endTime).
		Scan(&results).Error
	return results, err
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
// 通过内存匹配统计，避免将大量关键词拼成正则 OR 全表扫描打满 CPU
func (s *LogStore) GetOverviewStats(rulePatterns []string, windowHours int) (*OverviewStats, error) {
	stats := &OverviewStats{}
	since := time.Now().Add(-time.Duration(windowHours) * time.Hour).Unix()

	// 一次性拉取窗口内 type=5 错误日志，内存做大小写不敏感子串匹配
	entries, err := s.GetErrorLogsForScan(since, time.Now().Unix())
	if err != nil {
		return nil, err
	}

	keywords := make([]string, 0, len(rulePatterns))
	for _, p := range rulePatterns {
		p = strings.TrimSpace(p)
		if p != "" {
			keywords = append(keywords, strings.ToLower(p))
		}
	}

	stats.TotalErrors = int64(len(entries))
	stats.MatchedErrors = 0
	for i := range entries {
		content := strings.ToLower(entries[i].Content)
		for _, kw := range keywords {
			if strings.Contains(content, kw) {
				stats.MatchedErrors++
				break
			}
		}
	}

	if stats.MatchedErrors > stats.TotalErrors {
		stats.MatchedErrors = stats.TotalErrors
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

// GetUnmatchedErrorSamples 获取指定时间窗口内未匹配规则的错误样本
// 内存匹配 + 聚合，避免将大量关键词逐个拼成 NOT 正则全表扫描
func (s *LogStore) GetUnmatchedErrorSamples(rulePatterns []string, limit int, windowHours int) ([]ErrorSampleWithId, error) {
	since := time.Now().Add(-time.Duration(windowHours) * time.Hour).Unix()

	type logRow struct {
		Id          int64
		Content     string
		Other       string
		ModelName   string
		ChannelName string
		Username    string
	}
	var rows []logRow
	if err := s.db.Model(&model.Log{}).
		Select("id, content, other, model_name, channel_name, username").
		Where("type = ?", 5).
		Where("created_at >= ?", since).
		Where("content != ''").
		Scan(&rows).Error; err != nil {
		return nil, err
	}

	// 规范化关键词，内存做大小写不敏感子串匹配（等价于原转义后的 ~* 字面量匹配）
	keywords := make([]string, 0, len(rulePatterns))
	for _, p := range rulePatterns {
		p = strings.TrimSpace(p)
		if p != "" {
			keywords = append(keywords, strings.ToLower(p))
		}
	}

	type groupKey struct {
		content     string
		other       string
		modelName   string
		channelName string
		username    string
	}
	type group struct {
		id  int64
		cnt int64
	}
	groups := make(map[groupKey]*group)

	for i := range rows {
		row := rows[i]

		lower := strings.ToLower(row.Content)
		matched := false
		for _, kw := range keywords {
			if strings.Contains(lower, kw) {
				matched = true
				break
			}
		}
		if matched {
			continue
		}

		content := row.Content
		if r := []rune(content); len(r) > 120 {
			content = string(r[:120])
		}
		key := groupKey{
			content:     content,
			other:       row.Other,
			modelName:   row.ModelName,
			channelName: row.ChannelName,
			username:    row.Username,
		}

		g, ok := groups[key]
		if !ok {
			g = &group{id: row.Id}
			groups[key] = g
		}
		g.cnt++
		if row.Id < g.id {
			g.id = row.Id
		}
	}

	results := make([]ErrorSampleWithId, 0, len(groups))
	for key, g := range groups {
		results = append(results, ErrorSampleWithId{
			Id:          g.id,
			Content:     key.content,
			Other:       key.other,
			ModelName:   key.modelName,
			ChannelName: key.channelName,
			Username:    key.username,
			Cnt:         g.cnt,
		})
	}

	sort.Slice(results, func(i, j int) bool { return results[i].Cnt > results[j].Cnt })
	if len(results) > limit {
		results = results[:limit]
	}
	return results, nil
}

// CacheHitRateSeries 缓存命中率折线序列（按用户或渠道）
type CacheHitRateSeries struct {
	Name   string     `json:"name"`
	Values []*float64 `json:"values"` // 每个时间桶的命中率(0-100)，无数据为 null
}

// CacheHitRateResult 缓存命中率统计结果
type CacheHitRateResult struct {
	Date    string               `json:"date"`
	Buckets []string             `json:"buckets"` // 时间桶标签，如 "00:00"
	Series  []CacheHitRateSeries `json:"series"`
}

// GetCacheHitRate 统计某一天内的缓存命中率，按用户或渠道维度分组
// 命中率 = cache_tokens / (cache_tokens + cache_creation_tokens)
func (s *LogStore) GetCacheHitRate(dimension string, dayStart, dayEnd int64, bucketMinutes, topN int) (*CacheHitRateResult, error) {
	switch dimension {
	case "user", "channel":
	default:
		return nil, fmt.Errorf("unsupported dimension: %s", dimension)
	}
	if bucketMinutes <= 0 {
		bucketMinutes = 10
	}
	if topN <= 0 {
		topN = 10
	}

	type logRow struct {
		Other     string
		Username  string
		ChannelId int
		CreatedAt int64
	}
	type parsedCache struct {
		CacheTokens         float64 `json:"cache_tokens"`
		CacheCreationTokens float64 `json:"cache_creation_tokens"`
	}

	bucketSec := int64(bucketMinutes * 60)
	numBuckets := int((dayEnd - dayStart) / bucketSec)
	if numBuckets <= 0 {
		numBuckets = 1
	}

	// 每个维度键的请求量与每个时间桶的 token 累加
	type bucketAgg struct {
		cacheTokens    float64
		creationTokens float64
	}
	type dimAgg struct {
		requests int64
		buckets  []bucketAgg
	}
	dims := make(map[string]*dimAgg)

	// 按小时分批查询，逐批聚合后释放，避免一次性加载整天的日志
	hourSec := int64(3600)
	for cursor := dayStart; cursor < dayEnd; cursor += hourSec {
		chunkEnd := cursor + hourSec
		if chunkEnd > dayEnd {
			chunkEnd = dayEnd
		}

		var rows []logRow
		if err := s.db.Model(&model.Log{}).
			Select("other, username, channel_id, created_at").
			Where("created_at >= ? AND created_at < ?", cursor, chunkEnd).
			Where("other != ''").
			Scan(&rows).Error; err != nil {
			return nil, err
		}

		for _, r := range rows {
			var key string
			if dimension == "user" {
				if r.Username == "" {
					continue
				}
				key = r.Username
			} else {
				if r.ChannelId == 0 {
					continue
				}
				key = strconv.Itoa(r.ChannelId)
			}

			var parsed parsedCache
			if err := json.Unmarshal([]byte(r.Other), &parsed); err != nil {
				continue
			}
			if parsed.CacheTokens == 0 && parsed.CacheCreationTokens == 0 {
				continue
			}

			idx := int((r.CreatedAt - dayStart) / bucketSec)
			if idx < 0 {
				idx = 0
			}
			if idx >= numBuckets {
				idx = numBuckets - 1
			}

			d, ok := dims[key]
			if !ok {
				d = &dimAgg{buckets: make([]bucketAgg, numBuckets)}
				dims[key] = d
			}
			d.requests++
			d.buckets[idx].cacheTokens += parsed.CacheTokens
			d.buckets[idx].creationTokens += parsed.CacheCreationTokens
		}
	}

	// 按请求量取 Top N
	type keyWithRequests struct {
		key      string
		requests int64
	}
	ordered := make([]keyWithRequests, 0, len(dims))
	for k, d := range dims {
		ordered = append(ordered, keyWithRequests{k, d.requests})
	}
	sort.Slice(ordered, func(i, j int) bool { return ordered[i].requests > ordered[j].requests })
	if len(ordered) > topN {
		ordered = ordered[:topN]
	}

	buckets := make([]string, numBuckets)
	for i := 0; i < numBuckets; i++ {
		minutes := i * bucketMinutes
		buckets[i] = fmt.Sprintf("%02d:%02d", minutes/60, minutes%60)
	}

	series := make([]CacheHitRateSeries, 0, len(ordered))
	for _, item := range ordered {
		d := dims[item.key]
		values := make([]*float64, numBuckets)
		for i := 0; i < numBuckets; i++ {
			denom := d.buckets[i].cacheTokens + d.buckets[i].creationTokens
			if denom > 0 {
				v := d.buckets[i].cacheTokens / denom * 100
				values[i] = &v
			}
		}
		series = append(series, CacheHitRateSeries{Name: item.key, Values: values})
	}

	return &CacheHitRateResult{Buckets: buckets, Series: series}, nil
}
