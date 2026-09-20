package probe

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"tt-inspector/internal/store"

	"go.uber.org/zap"
)

func TestBuildChatCompletionsURL(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"https://api.example.com", "https://api.example.com/v1/chat/completions"},
		{"https://api.example.com/", "https://api.example.com/v1/chat/completions"},
		{"https://api.example.com/v1", "https://api.example.com/v1/chat/completions"},
		{"https://api.example.com/v1/", "https://api.example.com/v1/chat/completions"},
		{"https://api.example.com/v1beta", "https://api.example.com/v1beta/chat/completions"},
		{"  https://api.example.com  ", "https://api.example.com/v1/chat/completions"},
	}
	for _, c := range cases {
		if got := buildChatCompletionsURL(c.in); got != c.want {
			t.Errorf("buildChatCompletionsURL(%q) = %q, 期望 %q", c.in, got, c.want)
		}
	}
}

func TestFirstKey(t *testing.T) {
	cases := []struct {
		in   string
		want string
	}{
		{"sk-a", "sk-a"},
		{"sk-a,sk-b", "sk-a"},
		{" , sk-b , ", "sk-b"},
		{"", ""},
	}
	for _, c := range cases {
		if got := firstKey(c.in); got != c.want {
			t.Errorf("firstKey(%q) = %q, 期望 %q", c.in, got, c.want)
		}
	}
}

func TestBuildProbePayloadByProtocol(t *testing.T) {
	// Claude 系走 Anthropic Messages 协议（多数 Claude 渠道不支持 chat/completions）
	url, body, headers := buildProbePayload(probeJob{
		BaseUrl: "https://api.aaa.com", Key: "sk-a", Model: "claude-sonnet-4-6",
	}, "hi", 1)
	if url != "https://api.aaa.com/v1/messages" {
		t.Errorf("anthropic 探测地址 = %q", url)
	}
	if headers["x-api-key"] != "sk-a" || headers["anthropic-version"] == "" {
		t.Errorf("anthropic 鉴权头不正确: %+v", headers)
	}
	var anthropicBody map[string]interface{}
	_ = json.Unmarshal(body, &anthropicBody)
	if tokens, _ := anthropicBody["max_tokens"].(float64); tokens != 1 {
		t.Errorf("anthropic max_tokens = %v, 期望 1", anthropicBody["max_tokens"])
	}

	// base_url 已带 /v1 时不应拼接成 /v1/v1/messages
	url, _, _ = buildProbePayload(probeJob{
		BaseUrl: "https://api.aaa.com/v1", Key: "sk-a", Model: "claude-sonnet-4-6",
	}, "hi", 1)
	if url != "https://api.aaa.com/v1/messages" {
		t.Errorf("anthropic 探测地址（base_url 带 /v1）= %q", url)
	}

	// Gemini 走 generateContent
	url, _, headers = buildProbePayload(probeJob{
		BaseUrl: "https://g.example.com", Key: "sk-g", Model: "gemini-2.5-pro",
	}, "hi", 1)
	if url != "https://g.example.com/v1beta/models/gemini-2.5-pro:generateContent" {
		t.Errorf("gemini 探测地址 = %q", url)
	}
	if headers["x-goog-api-key"] != "sk-g" || headers["Authorization"] != "Bearer sk-g" {
		t.Errorf("gemini 鉴权头不正确: %+v", headers)
	}

	// 无法识别协议的模型（DeepSeek/Kimi/GLM 等）按 OpenAI 兼容接口处理，而不是跳过
	url, _, headers = buildProbePayload(probeJob{
		ChannelType: 1, BaseUrl: "https://d.example.com", Key: "sk-d", Model: "kimi-k3",
	}, "hi", 1)
	if url != "https://d.example.com/v1/chat/completions" {
		t.Errorf("默认协议探测地址 = %q", url)
	}
	if headers["Authorization"] != "Bearer sk-d" {
		t.Errorf("默认协议鉴权头不正确: %+v", headers)
	}

	// 渠道类型优先：type=1（OpenAI 兼容）渠道里挂着 claude 名字的模型也走 chat/completions
	url, _, headers = buildProbePayload(probeJob{
		ChannelType: 1, BaseUrl: "https://e.example.com", Key: "sk-e", Model: "claude-sonnet-4-6",
	}, "hi", 1)
	if url != "https://e.example.com/v1/chat/completions" {
		t.Errorf("渠道类型优先时的探测地址 = %q，期望 chat/completions", url)
	}
	if headers["Authorization"] != "Bearer sk-e" {
		t.Errorf("渠道类型优先时的鉴权头不正确: %+v", headers)
	}

	// 渠道类型为 Anthropic 时，即使模型名无法识别也走 Messages 协议
	url, _, headers = buildProbePayload(probeJob{
		ChannelType: 14, BaseUrl: "https://f.example.com", Key: "sk-f", Model: "claude-fable-5",
	}, "hi", 1)
	if url != "https://f.example.com/v1/messages" {
		t.Errorf("Anthropic 渠道探测地址 = %q", url)
	}
	if headers["x-api-key"] != "sk-f" {
		t.Errorf("Anthropic 渠道鉴权头不正确: %+v", headers)
	}
}

// TestProbeModelAnthropic 验证 Claude 模型会打到 /v1/messages 并带上 Anthropic 鉴权头
func TestProbeModelAnthropic(t *testing.T) {
	var gotPath, gotApiKey, gotVersion string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotApiKey = r.Header.Get("x-api-key")
		gotVersion = r.Header.Get("anthropic-version")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"content":[{"type":"text","text":"hi"}]}`))
	}))
	defer srv.Close()

	prober := &AvailabilityProber{client: &http.Client{}, logger: zap.NewNop()}
	res := prober.probeModel(context.Background(), probeJob{
		ChannelId: 7, ChannelName: "reachapi-claude", BaseUrl: srv.URL, Key: "sk-c", Model: "claude-haiku-4-5-20251001",
	}, AvailabilityConfig{TimeoutSec: 5, MaxTokens: 1, Prompt: "hi"})

	if res.Status != store.ProbeItemOK {
		t.Fatalf("期望探测成功，实际 status=%s error=%s", res.Status, res.Error)
	}
	if gotPath != "/v1/messages" {
		t.Errorf("Claude 模型请求路径 = %q，期望 /v1/messages", gotPath)
	}
	if gotApiKey != "sk-c" {
		t.Errorf("x-api-key = %q，期望 sk-c", gotApiKey)
	}
	if gotVersion == "" {
		t.Error("缺少 anthropic-version 请求头")
	}
}

// TestProbeModel 覆盖可用性探测的请求构造与成功/失败判定
func TestProbeModel(t *testing.T) {
	var gotAuth string
	var gotPath string
	var gotBody map[string]interface{}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAuth = r.Header.Get("Authorization")
		gotPath = r.URL.Path
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)

		if model, _ := gotBody["model"].(string); model == "no-such-model" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"error":{"message":"model not found"}}`))
			return
		}
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(`{"choices":[{"message":{"content":"hi"}}]}`))
	}))
	defer srv.Close()

	prober := &AvailabilityProber{client: &http.Client{}, logger: zap.NewNop()}
	cfg := AvailabilityConfig{TimeoutSec: 5, MaxTokens: 1, Prompt: "hi", Concurrency: 1}

	// 正常返回 200
	res := prober.probeModel(context.Background(), probeJob{
		ChannelId: 1, ChannelName: "渠道A", BaseUrl: srv.URL, Key: "sk-test", Model: "gpt-4o-mini",
	}, cfg)
	if res.Status != store.ProbeItemOK {
		t.Fatalf("期望探测成功，实际 status=%s error=%s", res.Status, res.Error)
	}
	if res.StatusCode != http.StatusOK {
		t.Errorf("状态码 = %d, 期望 200", res.StatusCode)
	}
	if gotAuth != "Bearer sk-test" {
		t.Errorf("Authorization = %q, 期望 %q", gotAuth, "Bearer sk-test")
	}
	if gotPath != "/v1/chat/completions" {
		t.Errorf("请求路径 = %q，说明 base_url 未正确补全 /v1", gotPath)
	}
	if tokens, ok := gotBody["max_tokens"].(float64); !ok || tokens != 1 {
		t.Errorf("max_tokens = %v, 期望 1", gotBody["max_tokens"])
	}
	if stream, ok := gotBody["stream"].(bool); !ok || stream {
		t.Errorf("stream = %v, 期望 false", gotBody["stream"])
	}

	// 上游返回 404
	res = prober.probeModel(context.Background(), probeJob{
		ChannelId: 1, ChannelName: "渠道A", BaseUrl: srv.URL, Key: "sk-test", Model: "no-such-model",
	}, cfg)
	if res.Status != store.ProbeItemFail {
		t.Fatalf("期望探测失败，实际 status=%s", res.Status)
	}
	if res.StatusCode != http.StatusNotFound {
		t.Errorf("状态码 = %d, 期望 404", res.StatusCode)
	}
	if !strings.Contains(res.Error, "model not found") {
		t.Errorf("错误信息应包含上游返回内容，实际为 %q", res.Error)
	}
}

func TestBuildJobsSkipRules(t *testing.T) {
	prober := &AvailabilityProber{logger: zap.NewNop()}
	targets := []store.ProbeTarget{
		{ChannelId: 1, Name: "正常", BaseUrl: "https://a.example.com", Key: "sk-1", Status: 1,
			Models: []string{"gpt-4o", "gpt-4o-mini"}},
		{ChannelId: 2, Name: "缺凭据", BaseUrl: "", Key: "", Status: 1, Models: []string{"gpt-4o"}},
		{ChannelId: 3, Name: "已禁用", BaseUrl: "https://c.example.com", Key: "sk-3", Status: 2,
			Models: []string{"gpt-4o"}},
		{ChannelId: 4, Name: "无模型", BaseUrl: "https://d.example.com", Key: "sk-4", Status: 1},
		{ChannelId: 5, Name: "不在白名单", BaseUrl: "https://e.example.com", Key: "sk-5", Status: 1,
			Models: []string{"gpt-4o"}},
	}

	// 白名单只保留 1 和 2
	jobs, skipped := prober.buildJobs(targets, AvailabilityConfig{ChannelIds: []int64{1, 2}})

	if len(jobs) != 2 {
		t.Fatalf("期望 2 个待探测任务（渠道1的两个模型），实际 %d", len(jobs))
	}
	if len(skipped) != 1 {
		t.Fatalf("期望 1 条跳过记录（渠道2缺凭据），实际 %d: %+v", len(skipped), skipped)
	}
	if skipped[0].ChannelId != 2 || skipped[0].Status != store.ProbeItemSkip {
		t.Errorf("跳过记录不符合预期: %+v", skipped[0])
	}

	// 白名单为空时覆盖全部渠道：渠道1（2 个模型）+ 渠道5（1 个模型）共 3 个任务，
	// 渠道2缺凭据、渠道3禁用、渠道4无模型 → 3 条跳过
	jobs, skipped = prober.buildJobs(targets, AvailabilityConfig{})
	if len(jobs) != 3 {
		t.Errorf("白名单为空时待探测任务应为 3，实际 %d", len(jobs))
	}
	if len(skipped) != 3 {
		t.Errorf("白名单为空时跳过记录应为 3，实际 %d", len(skipped))
	}

	// 每渠道模型数上限：渠道1 与渠道5 各取 1 个
	jobs, _ = prober.buildJobs(targets, AvailabilityConfig{MaxModelsPerChannel: 1})
	if len(jobs) != 2 {
		t.Errorf("限制每渠道 1 个模型时待探测任务应为 2，实际 %d", len(jobs))
	}
}

func TestPickPerChannel(t *testing.T) {
	candidates := []store.ProbeResult{
		{ChannelId: 1, Model: "a"}, {ChannelId: 1, Model: "b"},
		{ChannelId: 2, Model: "c"},
		{ChannelId: 3, Model: "d"}, {ChannelId: 3, Model: "e"}, {ChannelId: 3, Model: "f"},
	}

	picks := pickPerChannel(candidates)
	if len(picks) != 3 {
		t.Fatalf("期望每个渠道各抽 1 个共 3 条，实际 %d", len(picks))
	}

	seen := make(map[int64]string)
	for _, p := range picks {
		if _, dup := seen[p.ChannelId]; dup {
			t.Errorf("渠道 %d 被重复抽样", p.ChannelId)
		}
		seen[p.ChannelId] = p.Model
	}
	// 抽到的模型必须属于该渠道
	owned := map[int64]map[string]bool{
		1: {"a": true, "b": true},
		2: {"c": true},
		3: {"d": true, "e": true, "f": true},
	}
	for ch, model := range seen {
		if !owned[ch][model] {
			t.Errorf("渠道 %d 抽到了不属于它的模型 %q", ch, model)
		}
	}
}
