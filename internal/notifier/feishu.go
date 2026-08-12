package notifier

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
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

	if len(msg.AtUsers) > 0 {
		atContent := "\n\n"
		for _, u := range msg.AtUsers {
			atContent += fmt.Sprintf(`<at user_id="%s"></at>`, u)
		}
		content += atContent
		card.Card.Elements[0].Content = content
	}

	body, err := json.Marshal(card)
	if err != nil {
		return fmt.Errorf("marshal card: %w", err)
	}

	resp, err := n.client.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		n.logger.Error("webhook post failed",
			zap.String("url", webhookURL),
			zap.String("body", string(body)),
			zap.Error(err))
		return fmt.Errorf("post webhook: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		n.logger.Error("webhook non-200 response",
			zap.Int("status", resp.StatusCode),
			zap.String("body", string(respBody)),
			zap.String("request_body", string(body)))
		return fmt.Errorf("webhook returned status %d, body: %s", resp.StatusCode, string(respBody))
	}

	// 读取成功响应体，飞书可能返回业务错误
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
	n.logger.Info("feishu alert sent",
		zap.String("rule_name", msg.RuleName),
		zap.Int("match_count", msg.MatchCount),
		zap.String("response", string(respBody)))

	// 自定义群机器人在互动卡片中不支持 @ 通知，需要追加一条 text 消息来触发 @
	if len(msg.AtUsers) > 0 {
		atText := ""
		for _, u := range msg.AtUsers {
			atText += fmt.Sprintf(`<at user_id="%s"></at>`, u)
		}
		textBody, _ := json.Marshal(map[string]interface{}{
			"msg_type": "text",
			"content": map[string]string{
				"text": atText,
			},
		})
		textResp, err := n.client.Post(webhookURL, "application/json", bytes.NewReader(textBody))
		if err != nil {
			n.logger.Error("feishu at text message failed", zap.Error(err))
		} else {
			defer textResp.Body.Close()
			textRespBody, _ := io.ReadAll(io.LimitReader(textResp.Body, 1024))
			n.logger.Info("feishu at text message sent", zap.String("response", string(textRespBody)))
		}
	}

	return nil
}
