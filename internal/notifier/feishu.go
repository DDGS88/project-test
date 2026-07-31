package notifier

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"go.uber.org/zap"
)

// FeishuCard 飞书卡片消息结构
type FeishuCard struct {
	MsgType string         `json:"msg_type"`
	Card    FeishuCardBody `json:"card"`
}

type FeishuCardBody struct {
	Header   FeishuCardHeader    `json:"header"`
	Elements []FeishuCardElement `json:"elements"`
}

type FeishuCardHeader struct {
	Title    FeishuCardTitle `json:"title"`
	Template string          `json:"template"`
}

type FeishuCardTitle struct {
	Content string `json:"content"`
	Tag     string `json:"tag"`
}

type FeishuCardElement struct {
	Tag     string `json:"tag"`
	Content string `json:"content"`
}

// FeishuNotifier 飞书 Webhook 通知器
type FeishuNotifier struct {
	client *http.Client
	logger *zap.Logger
}

func NewFeishuNotifier(logger *zap.Logger) *FeishuNotifier {
	return &FeishuNotifier{
		client: &http.Client{
			Timeout: 10 * time.Second,
		},
		logger: logger,
	}
}

func (n *FeishuNotifier) Send(webhookURL string, msg AlertMessage) error {
	content := fmt.Sprintf(
		"**规则名称**: %s\n**规则类型**: %s\n**匹配次数**: %d / %d\n**时间窗口**: %s ~ %s\n**匹配条件**: %s\n**规则描述**: %s",
		msg.RuleName,
		msg.RuleType,
		msg.MatchCount,
		msg.Threshold,
		msg.WindowStart.Format("2006-01-02 15:04:05"),
		msg.WindowEnd.Format("2006-01-02 15:04:05"),
		msg.Condition,
		msg.Description,
	)

	if len(msg.Samples) > 0 {
		content += "\n\n**匹配样本**:"
		for i, s := range msg.Samples {
			matchedVal := s.MatchedValue
			if len(matchedVal) > 80 {
				matchedVal = matchedVal[:80] + "..."
			}
			content += fmt.Sprintf("\n> %d. %s | MsgID: `%s` | RequestID: `%s`", i+1, matchedVal, s.ResponseID, s.RequestID)
		}
	}

	card := FeishuCard{
		MsgType: "interactive",
		Card: FeishuCardBody{
			Header: FeishuCardHeader{
				Title: FeishuCardTitle{
					Content: "AI Gateway Alert",
					Tag:     "plain_text",
				},
				Template: "red",
			},
			Elements: []FeishuCardElement{
				{
					Tag:     "markdown",
					Content: content,
				},
			},
		},
	}

	body, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("marshal card: %w", err)
	}

	resp, err := n.client.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("webhook returned status %d", resp.StatusCode)
	}

	n.logger.Info("feishu alert sent",
		zap.String("rule_name", msg.RuleName),
		zap.Int("match_count", msg.MatchCount))

	return nil
}
