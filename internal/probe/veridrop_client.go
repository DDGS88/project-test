package probe

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"go.uber.org/zap"
)

// 检测协议 → veridrop 检测接口路径
//
// 注意 anthropic 的路径是 /api/detect/claude（veridrop 侧沿用历史命名），
// 写成 /api/detect/anthropic 会 404。
var veridropDetectPaths = map[string]string{
	ProtocolOpenAI:    "/api/detect/openai",
	ProtocolAnthropic: "/api/detect/claude",
	ProtocolGemini:    "/api/detect/gemini",
}

// veridropReportPrefix 报告页面前缀（由控制台反向代理挂载）
const veridropReportPrefix = "/veridrop/r/"

// VeridropJobStatus veridrop 任务状态
type VeridropJobStatus struct {
	JobID    string `json:"job_id"`
	Protocol string `json:"protocol"`
	Status   string `json:"status"`
	Error    string `json:"error"`
}

// VeridropReport veridrop 检测报告（只取需要的字段）
type VeridropReport struct {
	JobID      string  `json:"job_id"`
	Protocol   string  `json:"protocol"`
	BaseURL    string  `json:"base_url"`
	Model      string  `json:"target_model"`
	TotalScore float64 `json:"total_score"`
	Verdict    string  `json:"verdict"`
}

// VeridropClient veridrop 检测服务客户端
type VeridropClient struct {
	baseURL string
	client  *http.Client
	logger  *zap.Logger
}

func NewVeridropClient(baseURL string, logger *zap.Logger) *VeridropClient {
	return &VeridropClient{
		baseURL: strings.TrimRight(strings.TrimSpace(baseURL), "/"),
		client:  &http.Client{},
		logger:  logger,
	}
}

// Configured 是否配置了 veridrop 上游地址
func (c *VeridropClient) Configured() bool {
	return c.baseURL != ""
}

// Submit 提交一次检测任务，返回 job_id
func (c *VeridropClient) Submit(ctx context.Context, protocol, baseURL, apiKey, model, mode string) (string, error) {
	path, ok := veridropDetectPaths[protocol]
	if !ok {
		return "", fmt.Errorf("不支持的检测协议: %s", protocol)
	}

	form := url.Values{}
	form.Set("base_url", baseURL)
	form.Set("api_key", apiKey)
	form.Set("model", model)
	form.Set("mode", mode)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("构造检测请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := c.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("提交检测任务失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("提交检测任务返回 %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var out struct {
		JobID string `json:"job_id"`
	}
	if err := json.Unmarshal(body, &out); err != nil || out.JobID == "" {
		return "", fmt.Errorf("解析检测任务响应失败: %s", truncateErr(string(body)))
	}
	return out.JobID, nil
}

// Status 查询检测任务状态
func (c *VeridropClient) Status(ctx context.Context, jobID string) (*VeridropJobStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/status/"+url.PathEscape(jobID), nil)
	if err != nil {
		return nil, fmt.Errorf("构造状态查询请求失败: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("查询检测状态失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("查询检测状态返回 %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var status VeridropJobStatus
	if err := json.Unmarshal(body, &status); err != nil {
		return nil, fmt.Errorf("解析检测状态失败: %w", err)
	}
	return &status, nil
}

// Result 拉取检测报告 JSON
func (c *VeridropClient) Result(ctx context.Context, jobID string) (*VeridropReport, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.baseURL+"/api/result/"+url.PathEscape(jobID)+".json", nil)
	if err != nil {
		return nil, fmt.Errorf("构造报告请求失败: %w", err)
	}

	resp, err := c.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("拉取检测报告失败: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("拉取检测报告返回 %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var report VeridropReport
	if err := json.Unmarshal(body, &report); err != nil {
		return nil, fmt.Errorf("解析检测报告失败: %w", err)
	}
	return &report, nil
}

// ReportPath 生成报告页面路径（相对控制台，可直接在浏览器打开）
func (c *VeridropClient) ReportPath(jobID string) string {
	return veridropReportPrefix + jobID
}
