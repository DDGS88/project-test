package store

import (
	"tt-inspector/internal/model"

	"gorm.io/gorm"
)

type ErrorClassifyRule = model.ErrorClassifyRule

type ErrorClassifyStore struct {
	db *gorm.DB
}

func NewErrorClassifyStore(db *gorm.DB) *ErrorClassifyStore {
	return &ErrorClassifyStore{db: db}
}

func (s *ErrorClassifyStore) List() ([]ErrorClassifyRule, error) {
	var rules []ErrorClassifyRule
	err := s.db.Order("priority DESC, id ASC").Find(&rules).Error
	return rules, err
}

func (s *ErrorClassifyStore) Create(rule *ErrorClassifyRule) error {
	return s.db.Create(rule).Error
}

func (s *ErrorClassifyStore) Update(rule *ErrorClassifyRule) error {
	return s.db.Save(rule).Error
}

func (s *ErrorClassifyStore) Delete(id int64) error {
	return s.db.Delete(&ErrorClassifyRule{}, id).Error
}

// SeedDefaults 已移除——分类规则由用户自行创建
func (s *ErrorClassifyStore) SeedDefaults() error {
	return nil
}
