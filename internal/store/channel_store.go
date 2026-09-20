package store

import (
	"tt-inspector/internal/model"

	"gorm.io/gorm"
)

// ChannelStore 渠道和模型查询（只读）
type ChannelStore struct {
	db *gorm.DB
}

func NewChannelStore(db *gorm.DB) *ChannelStore {
	return &ChannelStore{db: db}
}

// row 中间结构，用于JOIN查询
type channelModelRow struct {
	ChannelId int64  `gorm:"column:channel_id"`
	Name      string `gorm:"column:name"`
	Tag       string `gorm:"column:tag"`
	Model     string `gorm:"column:model"`
}

// ListChannelsWithModels 获取所有渠道及其关联模型（GROUP BY 在应用层，兼容 MySQL/PG）
func (s *ChannelStore) ListChannelsWithModels() ([]model.ChannelWithModels, error) {
	var rows []channelModelRow
	err := s.db.Raw(`
		SELECT DISTINCT c.id AS channel_id, c.name, COALESCE(c.tag, '') AS tag, a.model
		FROM channels c
		LEFT JOIN abilities a ON c.id = a.channel_id
		ORDER BY c.id, a.model
	`).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	// 应用层 GROUP BY channel_id
	resultMap := make(map[int64]*model.ChannelWithModels)
	var orderedIds []int64

	for _, row := range rows {
		ch, exists := resultMap[row.ChannelId]
		if !exists {
			ch = &model.ChannelWithModels{
				ChannelId: row.ChannelId,
				Name:      row.Name,
				Tag:       row.Tag,
				Models:    []string{},
			}
			resultMap[row.ChannelId] = ch
			orderedIds = append(orderedIds, row.ChannelId)
		}
		if row.Model != "" {
			// 应用层去重（防止相同 channel 下 model 重复）
			found := false
			for _, m := range ch.Models {
				if m == row.Model {
					found = true
					break
				}
			}
			if !found {
				ch.Models = append(ch.Models, row.Model)
			}
		}
	}

	result := make([]model.ChannelWithModels, 0, len(orderedIds))
	for _, id := range orderedIds {
		result = append(result, *resultMap[id])
	}

	return result, nil
}

// ListChannels 获取所有渠道（仅 id + name）
type ChannelOption struct {
	Id   int64  `json:"id"`
	Name string `json:"name"`
}

func (s *ChannelStore) ListChannels() ([]ChannelOption, error) {
	var channels []model.Channel
	if err := s.db.Select("id, name").Order("id").Find(&channels).Error; err != nil {
		return nil, err
	}
	opts := make([]ChannelOption, len(channels))
	for i, ch := range channels {
		opts[i] = ChannelOption{Id: ch.Id, Name: ch.Name}
	}
	return opts, nil
}

// ListModelsByChannel 获取指定渠道的模型列表（去重）
func (s *ChannelStore) ListModelsByChannel(channelId int64) ([]string, error) {
	var models []string
	err := s.db.Model(&model.Ability{}).
		Where("channel_id = ?", channelId).
		Distinct("model").
		Order("model").
		Pluck("model", &models).Error
	return models, err
}

// GetChannelNameMap 获取所有渠道 id → name 的映射
func (s *ChannelStore) GetChannelNameMap() (map[int64]string, error) {
	var channels []model.Channel
	if err := s.db.Select("id, name").Find(&channels).Error; err != nil {
		return nil, err
	}
	m := make(map[int64]string, len(channels))
	for _, ch := range channels {
		m[ch.Id] = ch.Name
	}
	return m, nil
}

// ProbeTarget 探测目标渠道：渠道凭据 + 该渠道关联模型列表
//
// Type 为 new-api 渠道类型，用于判定探测协议（见 probe.resolveProtocol）。
type ProbeTarget struct {
	ChannelId int64
	Type      int64
	Name      string
	BaseUrl   string
	Key       string
	Status    int64
	Models    []string
}

// channelProbeRow 探测目标查询的中间结构
type channelProbeRow struct {
	ChannelId   int64  `gorm:"column:channel_id"`
	ChannelType int64  `gorm:"column:channel_type"`
	Name        string `gorm:"column:name"`
	BaseUrl     string `gorm:"column:base_url"`
	ApiKey      string `gorm:"column:api_key"`
	Status      int64  `gorm:"column:status"`
	Model       string `gorm:"column:model"`
}

// ListProbeTargets 查询所有渠道的探测凭据与关联模型（应用层按渠道聚合 + 模型去重）
//
// 注意：channels.key 是 MySQL 保留字，直接作为列别名（AS key）会导致语法错误，
// 因此别名统一用 api_key。
func (s *ChannelStore) ListProbeTargets() ([]ProbeTarget, error) {
	var rows []channelProbeRow
	err := s.db.Raw(`
		SELECT c.id AS channel_id,
		       COALESCE(c.type, 0) AS channel_type,
		       c.name AS name,
		       COALESCE(c.base_url, '') AS base_url,
		       COALESCE(c.key, '') AS api_key,
		       COALESCE(c.status, 1) AS status,
		       a.model AS model
		FROM channels c
		LEFT JOIN abilities a ON c.id = a.channel_id
		ORDER BY c.id, a.model
	`).Scan(&rows).Error
	if err != nil {
		return nil, err
	}

	resultMap := make(map[int64]*ProbeTarget)
	var orderedIds []int64
	seenModels := make(map[int64]map[string]struct{})

	for _, row := range rows {
		target, exists := resultMap[row.ChannelId]
		if !exists {
			target = &ProbeTarget{
				ChannelId: row.ChannelId,
				Type:      row.ChannelType,
				Name:      row.Name,
				BaseUrl:   row.BaseUrl,
				Key:       row.ApiKey,
				Status:    row.Status,
				Models:    []string{},
			}
			resultMap[row.ChannelId] = target
			orderedIds = append(orderedIds, row.ChannelId)
			seenModels[row.ChannelId] = make(map[string]struct{})
		}
		if row.Model == "" {
			continue
		}
		if _, dup := seenModels[row.ChannelId][row.Model]; dup {
			continue
		}
		seenModels[row.ChannelId][row.Model] = struct{}{}
		target.Models = append(target.Models, row.Model)
	}

	result := make([]ProbeTarget, 0, len(orderedIds))
	for _, id := range orderedIds {
		result = append(result, *resultMap[id])
	}
	return result, nil
}
