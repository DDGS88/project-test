package store

import (
	"tt-inspector/internal/model"

	"gorm.io/gorm"
)

// ErrorScanRule 别名
type ErrorScanRule = model.ErrorScanRule

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
