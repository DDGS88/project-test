package probe

import "testing"

// TestResolveProtocolByChannelType 渠道类型优先于模型名
func TestResolveProtocolByChannelType(t *testing.T) {
	cases := []struct {
		channelType int64
		model       string
		want        string
	}{
		// 已收录的渠道类型直接决定协议
		{14, "claude-sonnet-4-6", ProtocolAnthropic},
		{24, "gemini-2.5-pro", ProtocolGemini},
		// 渠道类型优先：type=1（OpenAI 兼容）渠道即使挂着 claude 名字的模型也按 OpenAI 协议探测
		{1, "claude-sonnet-4-6", ProtocolOpenAI},
		// 未收录的类型回退到模型名
		{0, "claude-sonnet-4-6", ProtocolAnthropic},
		{0, "gemini-2.5-flash", ProtocolGemini},
		{3, "gemini-2.5-flash", ProtocolGemini},
	}
	for _, c := range cases {
		if got := resolveProtocol(c.channelType, c.model); got != c.want {
			t.Errorf("resolveProtocol(%d, %q) = %q, 期望 %q", c.channelType, c.model, got, c.want)
		}
	}
}

// TestResolveProtocolFallbackOpenAI 渠道类型与模型名都无法判定时兜底 OpenAI 兼容
func TestResolveProtocolFallbackOpenAI(t *testing.T) {
	// Kimi / DeepSeek / GLM 等第三方模型没有专门协议，均按 OpenAI 兼容探测而不是跳过
	models := []string{
		"kimi-k3", "deepseek-chat", "glm-4-plus", "qwen-max", "minimax-abab6.5",
		"gpt-4o", "o3-mini", "chatgpt-4o-latest", "", "unknown-model",
	}
	for _, model := range models {
		if got := resolveProtocol(1, model); got != ProtocolOpenAI {
			t.Errorf("resolveProtocol(1, %q) = %q, 期望 %q", model, got, ProtocolOpenAI)
		}
		// 渠道类型未知（0）时同样兜底
		if got := resolveProtocol(0, model); got != ProtocolOpenAI {
			t.Errorf("resolveProtocol(0, %q) = %q, 期望 %q", model, got, ProtocolOpenAI)
		}
	}
}

func TestInferProtocol(t *testing.T) {
	cases := map[string]string{
		"claude-3-5-sonnet-20241022": ProtocolAnthropic,
		"anthropic/claude-opus-4":    ProtocolAnthropic,
		"gpt-4o-mini":                ProtocolOpenAI,
		"openai/gpt-4o":              ProtocolOpenAI,
		"o3-mini":                    ProtocolOpenAI,
		"gemini-2.5-pro":             ProtocolGemini,
		"models/gemini-2.5-pro":      ProtocolGemini,
		"kimi-k3":                    "",
		"deepseek-chat":              "",
		"":                           "",
	}
	for model, want := range cases {
		if got := inferProtocol(model); got != want {
			t.Errorf("inferProtocol(%q) = %q, 期望 %q", model, got, want)
		}
	}
}
