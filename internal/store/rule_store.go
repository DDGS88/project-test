package store

import (
	"tt-inspector/internal/model"

	"gorm.io/gorm"
)

// AlertRule 告警规则（导出供其他包使用）
type AlertRule = model.AlertRule

// RuleStore 规则 CRUD
type RuleStore struct {
	db *gorm.DB
}

func NewRuleStore(db *gorm.DB) *RuleStore {
	return &RuleStore{db: db}
}

// List 获取所有规则
func (s *RuleStore) List() ([]AlertRule, error) {
	var rules []AlertRule
	err := s.db.Order("id DESC").Find(&rules).Error
	return rules, err
}

// ListEnabled 获取所有启用的规则
func (s *RuleStore) ListEnabled() ([]AlertRule, error) {
	var rules []AlertRule
	err := s.db.Where("enabled = ?", true).Order("id DESC").Find(&rules).Error
	return rules, err
}

// Get 获取单条规则
func (s *RuleStore) Get(id int64) (*AlertRule, error) {
	var rule AlertRule
	err := s.db.First(&rule, id).Error
	if err != nil {
		return nil, err
	}
	return &rule, nil
}

// Create 创建规则
func (s *RuleStore) Create(rule *AlertRule) error {
	return s.db.Create(rule).Error
}

// Update 更新规则
func (s *RuleStore) Update(rule *AlertRule) error {
	return s.db.Save(rule).Error
}

// Delete 删除规则
func (s *RuleStore) Delete(id int64) error {
	return s.db.Delete(&AlertRule{}, id).Error
}

// SetEnabled 启用/禁用规则
func (s *RuleStore) SetEnabled(id int64, enabled bool) error {
	return s.db.Model(&AlertRule{}).Where("id = ?", id).Update("enabled", enabled).Error
}
