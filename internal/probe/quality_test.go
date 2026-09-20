package probe

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tt-inspector/internal/store"

	"go.uber.org/zap"
)

// TestProbeCandidateByChannelType 验证质量探测按「渠道类型优先」选定协议，
// 且第三方模型（Kimi/DeepSeek/GLM 等）不再因为无法从模型名推断协议而被跳过
func TestProbeCandidateByChannelType(t *testing.T) {
	cases := []struct {
		name        string
		channelType int64
		model       string
		wantPath    string
		wantProto   string
	}{
		{"Kimi 渠道走 OpenAI 兼容", 1, "kimi-k3", "/api/detect/openai", ProtocolOpenAI},
		{"DeepSeek 模型兜底 OpenAI 兼容", 0, "deepseek-chat", "/api/detect/openai", ProtocolOpenAI},
		{"Anthropic 渠道走 Claude 检测", 14, "claude-sonnet-4-6", "/api/detect/claude", ProtocolAnthropic},
		{"Gemini 渠道走 Gemini 检测", 24, "gemini-2.5-pro", "/api/detect/gemini", ProtocolGemini},
		{"渠道类型优先于模型名", 1, "claude-sonnet-4-6", "/api/detect/openai", ProtocolOpenAI},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var gotPath string
			var gotModel, gotKey, gotBaseURL, gotMode string

			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				switch {
				case r.Method == http.MethodPost && strings.HasPrefix(r.URL.Path, "/api/detect/"):
					gotPath = r.URL.Path
					_ = r.ParseForm()
					gotModel = r.PostForm.Get("model")
					gotKey = r.PostForm.Get("api_key")
					gotBaseURL = r.PostForm.Get("base_url")
					gotMode = r.PostForm.Get("mode")
					_, _ = w.Write([]byte(`{"job_id":"job-1"}`))
				case r.URL.Path == "/api/status/job-1":
					_, _ = w.Write([]byte(`{"job_id":"job-1","status":"done"}`))
				case r.URL.Path == "/api/result/job-1.json":
					_, _ = w.Write([]byte(`{"job_id":"job-1","total_score":92.5,"verdict":"genuine"}`))
				default:
					w.WriteHeader(http.StatusNotFound)
				}
			}))
			defer srv.Close()

			prober := NewQualityProber(nil, nil, NewVeridropClient(srv.URL, zap.NewNop()), nil, zap.NewNop())
			credMap := map[int64]store.ProbeTarget{
				25: {ChannelId: 25, Type: c.channelType, Name: "relay", BaseUrl: "https://relay.example.com", Key: "sk-x"},
			}

			res := prober.probeCandidate(context.Background(),
				store.ProbeResult{ChannelId: 25, ChannelName: "relay", Model: c.model},
				credMap, QualityConfig{Mode: "standard", TimeoutSec: 5, ScoreThreshold: 60})

			if res.Status != store.ProbeItemOK {
				t.Fatalf("期望检测成功（不应跳过），实际 status=%s error=%s", res.Status, res.Error)
			}
			if res.Protocol != c.wantProto {
				t.Errorf("protocol = %q, 期望 %q", res.Protocol, c.wantProto)
			}
			if gotPath != c.wantPath {
				t.Errorf("提交路径 = %q, 期望 %q", gotPath, c.wantPath)
			}
			if gotModel != c.model {
				t.Errorf("提交的 model = %q, 期望 %q", gotModel, c.model)
			}
			if gotKey != "sk-x" {
				t.Errorf("提交的 api_key = %q, 期望 sk-x", gotKey)
			}
			if gotBaseURL != "https://relay.example.com" {
				t.Errorf("提交的 base_url = %q", gotBaseURL)
			}
			if gotMode != "standard" {
				t.Errorf("提交的 mode = %q, 期望 standard", gotMode)
			}
			if res.Score != 92.5 || res.Verdict != "genuine" {
				t.Errorf("报告解析结果不正确: score=%v verdict=%q", res.Score, res.Verdict)
			}
		})
	}
}
