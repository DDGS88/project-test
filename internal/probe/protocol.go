package probe

import "strings"

// veridrop 支持的检测协议（对应其 /api/detect/{protocol} 三个接口）
const (
	// ProtocolOpenAI OpenAI 兼容协议（/v1/chat/completions）
	ProtocolOpenAI = "openai"
	// ProtocolAnthropic Anthropic Messages 协议（/v1/messages）
	ProtocolAnthropic = "anthropic"
	// ProtocolGemini Gemini generateContent 协议
	ProtocolGemini = "gemini"
)

// channelTypeProtocol new-api 渠道类型 → 探测协议
//
// 渠道类型决定 new-api 实际使用的转发协议，比模型名可靠：同一类型渠道下可能挂着名字
// 各异的模型（如 type=1 渠道里既有 gpt-* 也有 kimi-k3），个别中转站渠道还可能挂着与
// 类型不符的模型名。这里只登记已确认的类型，未登记的类型回退到模型名推断、再兜底
// OpenAI 兼容——对绝大多数 OpenAI 兼容类型而言结果一致。
var channelTypeProtocol = map[int64]string{
	1:  ProtocolOpenAI,    // OpenAI 兼容
	14: ProtocolAnthropic, // Anthropic Claude
	24: ProtocolGemini,    // Gemini
}

// resolveProtocol 判定渠道-模型使用的探测协议：渠道类型优先，其次按模型名推断，最后兜底 OpenAI 兼容
//
// 兜底为 OpenAI 兼容是因为它是事实标准，DeepSeek / GLM / Kimi / Qwen 等第三方模型
// 都提供 OpenAI 兼容接口。判定结果会写入探测结果，便于排查是否有渠道用错了协议。
func resolveProtocol(channelType int64, model string) string {
	if protocol, ok := channelTypeProtocol[channelType]; ok {
		return protocol
	}
	if protocol := inferProtocol(model); protocol != "" {
		return protocol
	}
	return ProtocolOpenAI
}

// inferProtocol 依据模型名推断 veridrop 检测协议，无法判断时返回空字符串
func inferProtocol(model string) string {
	name := strings.ToLower(strings.TrimSpace(model))
	if name == "" {
		return ""
	}
	// 兼容 "openai/gpt-4o"、"anthropic/claude-3"、"models/gemini-1.5-pro" 这类带前缀的写法
	if idx := strings.LastIndex(name, "/"); idx >= 0 {
		name = name[idx+1:]
	}

	switch {
	case strings.HasPrefix(name, "claude"):
		return ProtocolAnthropic
	case strings.HasPrefix(name, "gemini-"):
		return ProtocolGemini
	case strings.HasPrefix(name, "gpt-"),
		strings.HasPrefix(name, "chatgpt"),
		strings.HasPrefix(name, "o1"),
		strings.HasPrefix(name, "o3"),
		strings.HasPrefix(name, "o4"):
		return ProtocolOpenAI
	default:
		return ""
	}
}
