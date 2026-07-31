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
