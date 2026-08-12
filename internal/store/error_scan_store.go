package store

import (
	"tt-inspector/internal/model"

	"gorm.io/gorm"
)

// ErrorScanRule 别名
type ErrorScanRule = model.ErrorScanRule

// ScanSetting 别名
type ScanSetting = model.ScanSetting

// ErrorScanStore 错误扫描规则 CRUD
type ErrorScanStore struct {
	db *gorm.DB
}

func NewErrorScanStore(db *gorm.DB) *ErrorScanStore {
	return &ErrorScanStore{db: db}
}

// List 获取所有错误扫描规则
func (s *ErrorScanStore) List() ([]ErrorScanRule, error) {
	var rules []ErrorScanRule
	err := s.db.Order("id DESC").Find(&rules).Error
	return rules, err
}

// Get 获取单条
func (s *ErrorScanStore) Get(id int64) (*ErrorScanRule, error) {
	var rule ErrorScanRule
	err := s.db.First(&rule, id).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// Create 创建
func (s *ErrorScanStore) Create(rule *ErrorScanRule) error {
	return s.db.Create(rule).Error
}

// Update 更新
func (s *ErrorScanStore) Update(rule *ErrorScanRule) error {
	return s.db.Save(rule).Error
}

// UpdateFields 按字段部分更新（只更新 map 中存在的字段）
func (s *ErrorScanStore) UpdateFields(id int64, fields map[string]interface{}) error {
	if len(fields) == 0 {
		return nil
	}
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).Updates(fields).Error
}

// Delete 删除
func (s *ErrorScanStore) Delete(id int64) error {
	return s.db.Delete(&ErrorScanRule{}, id).Error
}

// SetAlertEnabled 设置告警开关
func (s *ErrorScanStore) SetAlertEnabled(id int64, enabled bool) error {
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).Update("is_alert_enabled", enabled).Error
}

// SetSuppressed 设置误报屏蔽
func (s *ErrorScanStore) SetSuppressed(id int64, suppressed bool) error {
	updates := map[string]interface{}{
		"suppressed": suppressed,
	}
	if !suppressed {
		updates["is_alert_enabled"] = true // 恢复时自动开启告警
	}
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).Updates(updates).Error
}

// SetFeishuWebhook 设置飞书 Webhook
func (s *ErrorScanStore) SetFeishuWebhook(id int64, url string) error {
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).Update("feishu_webhook", url).Error
}

// BulkSetFeishuWebhook 批量设置飞书 Webhook
func (s *ErrorScanStore) BulkSetFeishuWebhook(url string) error {
	return s.db.Model(&ErrorScanRule{}).Where("1 = 1").Update("feishu_webhook", url).Error
}

// UpdateGranularity 更新扫描/告警粒度
func (s *ErrorScanStore) UpdateGranularity(id int64, scanGranularity, alertGranularity string) error {
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).Updates(map[string]interface{}{
		"scan_granularity":  scanGranularity,
		"alert_granularity": alertGranularity,
	}).Error
}

// UpdateHourlyCount 更新小时错误计数
func (s *ErrorScanStore) UpdateHourlyCount(id int64, count int) error {
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).
		Update("hourly_error_count", count).Error
}

// UpdateDailyCount 更新每天错误计数
func (s *ErrorScanStore) UpdateDailyCount(id int64, count int) error {
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).
		Update("daily_error_count", count).Error
}

// UpdateThresholdAndExcludes 更新告警阈值和排除列表
func (s *ErrorScanStore) UpdateThresholdAndExcludes(id int64, threshold int, excludeChannels, excludeUsers, filterMode string) error {
	updates := map[string]interface{}{
		"alert_threshold":  threshold,
		"exclude_channels": excludeChannels,
		"exclude_users":    excludeUsers,
		"filter_mode":      filterMode,
	}
	return s.db.Model(&ErrorScanRule{}).Where("id = ?", id).Updates(updates).Error
}

// GetSetting 获取设置值
func (s *ErrorScanStore) GetSetting(key string) (string, error) {
	var setting ScanSetting
	err := s.db.Where("key = ?", key).First(&setting).Error
	if err == gorm.ErrRecordNotFound {
		return "", nil
	}
	return setting.Value, err
}

// SetSetting 设置设置值
func (s *ErrorScanStore) SetSetting(key, value string) error {
	return s.db.Where("key = ?", key).Assign(ScanSetting{Value: value}).FirstOrCreate(&ScanSetting{Key: key}).Error
}
