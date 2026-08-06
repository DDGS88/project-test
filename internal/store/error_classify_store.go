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

// SeedDefaults 写入默认分类规则（幂等：keyword 已存在则跳过）
func (s *ErrorClassifyStore) SeedDefaults() error {
	defaults := []ErrorClassifyRule{
		{Keyword: "Overloaded", StatusCode: 500, Category: "5xx 服务器错误", SubCategory: "500 - Upstream Overloaded (模型容量崩溃/上游过载)", Recommendation: "建议开启“按渠道”告警，并触发网关自动负载均衡降级到备用渠道。", Priority: 100},
		{Keyword: "upstream overloaded", StatusCode: 500, Category: "5xx 服务器错误", SubCategory: "500 - Upstream Overloaded (上游过载)", Recommendation: "建议开启“按渠道”告警，并触发网关自动负载均衡降级到备用渠道。", Priority: 90},
		{Keyword: "tool_use_id", StatusCode: 400, Category: "400 参数格式错误", SubCategory: "400 - Tool Use Context Mismatch (工具调用 ID 不配对)", Recommendation: "客户端会话 History 中存在未找到 Tool Use 对应的 Tool Result 块。可设为低优先级或通知对应开发者修复 Agent History 上下文清洗逻辑。", Priority: 100},
		{Keyword: "text content blocks must be non-empty", StatusCode: 400, Category: "400 参数格式错误", SubCategory: "400 - Empty Text Block (消息 text content 块为空)", Recommendation: "前端或 SDK 在构建 messages 数组时塞入了空字符串。建议在网关做轻量正则校验或在仪表盘屏蔽该误报。", Priority: 100},
		{Keyword: "429", StatusCode: 429, Category: "429 频率限制", SubCategory: "429 - Rate Limit (TPM/RPM 配额到达限制)", Recommendation: "已达到并发限速，建议开启自动平滑重试或扩容渠道算力额度。", Priority: 80},
		{Keyword: "rate limit", StatusCode: 0, Category: "429 频率限制", SubCategory: "429 - Rate Limit (TPM/RPM 配额限制)", Recommendation: "已达到频率限制，建议开启自动平滑重试或扩容渠道算力额度。", Priority: 70},
		{Keyword: "context_length_exceeded", StatusCode: 400, Category: "400 参数格式错误", SubCategory: "400 - Context Length Exceeded (上下文长度超限)", Recommendation: "输入 token 超过模型最大上下文窗口。建议在网关侧截断或拒绝超长请求。", Priority: 90},
		{Keyword: "maximum context length", StatusCode: 400, Category: "400 参数格式错误", SubCategory: "400 - Max Context Length (上下文超限)", Recommendation: "输入 token 超过模型最大上下文窗口。建议在网关侧截断或拒绝超长请求。", Priority: 90},
		{Keyword: "invalid_api_key", StatusCode: 401, Category: "401 鉴权错误", SubCategory: "401 - Invalid API Key (API Key 无效)", Recommendation: "检查渠道 API Key 配置是否正确或是否已过期。", Priority: 100},
		{Keyword: "unauthorized", StatusCode: 401, Category: "401 鉴权错误", SubCategory: "401 - Unauthorized (未授权)", Recommendation: "检查渠道鉴权配置。", Priority: 90},
		{Keyword: "insufficient_quota", StatusCode: 429, Category: "429 频率限制", SubCategory: "429 - Insufficient Quota (配额不足)", Recommendation: "账户配额已用完，请充值或等待配额重置。", Priority: 95},
		{Keyword: "billing", StatusCode: 0, Category: "4xx 客户端错误", SubCategory: "402 - Billing Issue (计费问题)", Recommendation: "检查账户余额或计费状态。", Priority: 60},
		{Keyword: "server_error", StatusCode: 500, Category: "5xx 服务器错误", SubCategory: "500 - Internal Server Error (上游服务器内部错误)", Recommendation: "上游模型服务异常，建议开启自动重试和渠道切换。", Priority: 60},
		{Keyword: "service_unavailable", StatusCode: 503, Category: "5xx 服务器错误", SubCategory: "503 - Service Unavailable (上游服务不可用)", Recommendation: "上游模型服务暂时不可用，建议开启自动重试和渠道切换。", Priority: 90},
		{Keyword: "timeout", StatusCode: 504, Category: "5xx 服务器错误", SubCategory: "504 - Gateway Timeout (上游超时)", Recommendation: "上游模型服务响应超时，建议调整超时配置或切换到更快渠道。", Priority: 90},
		{Keyword: "bad_request", StatusCode: 400, Category: "400 参数格式错误", SubCategory: "400 - Bad Request (请求格式错误)", Recommendation: "检查请求参数格式是否符合 API 规范。", Priority: 50},
		{Keyword: "not_found", StatusCode: 404, Category: "4xx 客户端错误", SubCategory: "404 - Not Found (模型/路由不存在)", Recommendation: "检查模型名称或路由配置是否正确。", Priority: 80},
		{Keyword: "permission_denied", StatusCode: 403, Category: "403 权限错误", SubCategory: "403 - Permission Denied (权限拒绝)", Recommendation: "检查用户是否有该模型/渠道的访问权限。", Priority: 80},
		{Keyword: "safety", StatusCode: 400, Category: "400 参数格式错误", SubCategory: "400 - Content Safety Block (内容安全拦截)", Recommendation: "输入或输出内容触发了安全策略，建议引导用户修改输入。", Priority: 80},
	}

	for _, r := range defaults {
		var existing ErrorClassifyRule
		err := s.db.Where("keyword = ? AND status_code = ?", r.Keyword, r.StatusCode).First(&existing).Error
		if err == gorm.ErrRecordNotFound {
			if err := s.db.Create(&r).Error; err != nil {
				return err
			}
		}
	}
	return nil
}
