# Tasks

- [x] Task 1: 数据模型与存储层：新增探测配置/运行/结果表，扩展渠道凭据查询
  - [x] SubTask 1.1: 扩展 `internal/model/channel.go` 的 `Channel` 只读模型，增加 `key`、`base_url`、`status` 字段（对应 MySQL `channels` 表列）
  - [x] SubTask 1.2: 新建 `internal/model/channel_probe.go`，定义 `ProbeSetting`（key/value）、`ProbeRun`（kind/trigger/status/started_at/finished_at/total/ok_cnt/fail_cnt/skip_cnt/message）、`ProbeResult`（run_id/kind/channel_id/channel_name/model/status/status_code/latency_ms/error/score/verdict/report_url/probed_at）
  - [x] SubTask 1.3: 在 `internal/store/channel_store.go` 增加 `ListProbeTargets()`：按渠道聚合返回 id/name/base_url/key/status + 该渠道模型列表（`abilities` 关联，去重）
  - [x] SubTask 1.4: 新建 `internal/store/probe_store.go`：设置读写（Get/SetSetting）、Run 创建与结束更新、Result 批量创建、Run 列表查询、按 run 查询结果（支持 only_failed）、最近一次成功可用性结果查询（按渠道分组供质量探测使用）
  - [x] SubTask 1.5: 在 `internal/server/server.go` 对三张新表执行 `AutoMigrate`（建在 logDB）

- [x] Task 2: cron 解析与探测调度器
  - [x] SubTask 2.1: 在 `go.mod` 引入 `github.com/robfig/cron/v3`（已验证可拉取）
  - [x] SubTask 2.2: 新建 `internal/probe/cron.go`：封装「校验 5 字段表达式 / 计算下次运行时间 / 构造调度器」的统一入口，非法表达式返回明确错误
  - [x] SubTask 2.3: 新建 `internal/probe/cron_test.go`：覆盖合法表达式、非法表达式（字段数不足）、下次运行时间计算、`*/n` 与列表/区间语法
  - [x] SubTask 2.4: 新建 `internal/probe/scheduler.go`：可用性/质量两套调度循环，支持配置热更新（保存后重排）、并发互斥（同一探测不重入）、运行状态查询（是否运行中、上次/下次运行时间、最近一次运行的成功/失败统计）；`ctx` 取消时优雅退出

- [x] Task 3: 可用性探测器
  - [x] SubTask 3.1: 新建 `internal/probe/availability.go`：目标筛选（白名单 ∩ status=1 ∩ 有 base_url+key）、base_url 归一化（缺 `/v1` 时追加）、`key` 多值取首个、并发受控（worker pool，上限 `concurrency`）、单请求超时
  - [x] SubTask 3.2: 实现单次最小请求探测（`max_tokens=1`、prompt 可配、`stream=false`），判定成功/失败，记录 status_code、latency_ms、错误摘要；请求体不落库完整响应，仅存前 500 字符
  - [x] SubTask 3.3: 跳过规则实现（不在白名单/非启用/缺凭据/无模型），记为 skipped 且不纳入告警
  - [x] SubTask 3.4: 运行结果落库（`ProbeRun` + `ProbeResult` 批量写入），运行结束后触发失败汇总飞书告警（按渠道聚合、含明细样本、按 `cooldown_sec` 冷却、未配置 webhook 时仅记录）
  - [x] SubTask 3.5: 支持手动触发（异步执行，不影响定时调度）
  - [x] SubTask 3.6: 按渠道类型与模型协议分流探测请求（Claude 系走 Anthropic Messages `/v1/messages` + `x-api-key`/`anthropic-version`；Gemini 走 `/v1beta/models/{model}:generateContent`；其余按 OpenAI 兼容 `/chat/completions`），避免 Claude 专用中转站被误判为不可用

- [x] Task 4: 质量探测器（veridrop 客户端）
  - [x] SubTask 4.1: 新建 `internal/probe/veridrop_client.go`：封装 veridrop HTTP 调用（提交检测任务 / 查询任务状态 / 拉取报告 JSON），base 地址取 `cfg.Veridrop.Upstream`
  - [x] SubTask 4.2: 新建 `internal/probe/quality.go`：从最近一次可用性成功结果按渠道分组、每渠道随机抽 1 个模型；协议判定统一走 `internal/probe/protocol.go` 的 `resolveProtocol`（渠道类型优先 → 模型名兜底 → 兜底 OpenAI 兼容），并把实际使用的协议写入结果便于排查
  - [x] SubTask 4.3: 实现提交 + 轮询（间隔轮询直到 done/error，总耗时受 `timeout_sec` 限制），解析 `total_score`/`verdict`，结果落库
  - [x] SubTask 4.4: 低于 `score_threshold` 或检测失败时发送飞书告警（含渠道、模型、分数、结论、报告链接，按 `cooldown_sec` 冷却）；无可用性成功结果时记为跳过并说明原因
  - [x] SubTask 4.5: 支持手动触发（异步执行）
  - [x] SubTask 4.6: 新增 `internal/probe/protocol.go` 统一协议判定：以 new-api `channels.type`（1=OpenAI 兼容、14=Anthropic、24=Gemini）为主、模型名前缀为辅，未识别的类型与模型兜底 OpenAI 兼容（Kimi/DeepSeek/GLM 等第三方模型均走 OpenAI 兼容协议），并在探测结果中记录实际使用的协议
  - [x] SubTask 4.7: `store.ProbeTarget` 增加渠道类型字段、`ProbeResult` 增加 `protocol` 字段，前端结果明细表新增「协议」列

- [x] Task 5: 探测 API 层
  - [x] SubTask 5.1: 新建 `internal/api/handler_probe.go`：`GET/PUT` 探测配置（含下次运行时间与调度状态）、cron 校验接口、手动触发接口（可用性/质量）、运行历史与结果明细查询接口、webhook 连通性测试接口
  - [x] SubTask 5.2: 在 `internal/api/router.go` 注册以上路由（归入需鉴权的 `/api/v1` 分组）
  - [x] SubTask 5.3: 配置保存时校验 cron 与数值范围（并发≥1、超时>0、max_tokens≥1），非法返回 400；保存成功后调用调度器热更新

- [x] Task 6: 服务装配与配置项
  - [x] SubTask 6.1: 在 `internal/config/config.go` 增加 `Probe` 配置段（默认 cron、超时、并发、质量阈值等）与默认值兜底
  - [x] SubTask 6.2: 在 `config/config.yaml`、`config/config.dev.yaml`、`config/config.prod.yaml` 增加 `probe` 段
  - [x] SubTask 6.3: 在 `internal/server/server.go` 装配 ProbeStore、探测器、调度器并启动（`ctx` 取消时优雅停止），注册路由

- [x] Task 7: 前端页面
  - [x] SubTask 7.1: `types.ts` 增加 `channel-probe` 到 `MainTab`，并新增探测配置/运行/结果类型
  - [x] SubTask 7.2: `Sidebar.tsx` 增加「渠道探测」导航项；`App.tsx` 增加对应路由分支
  - [x] SubTask 7.3: `api/rules.ts` 追加探测相关 API 封装（配置读写、cron 校验、手动触发、运行历史、结果明细、webhook 测试）
  - [x] SubTask 7.4: 新建 `components/ChannelProbeView.tsx`：顶部状态卡（上次/下次运行、上次运行成功/失败/跳过统计）+「可用性探测」「质量探测」两个页签；每个页签含配置表单（启用、cron 带校验与下次运行预览、渠道多选、并发、超时、max_tokens、prompt、告警 webhook、@用户）、保存、立即执行；结果区展示运行历史与失败明细
  - [x] SubTask 7.5: 页面交互复用现有设计语言（`material-symbols-outlined` 图标、现有配色与暗色主题 CSS 变量），保存/触发失败给出 toast 提示；保存前拦截非法 cron，cron 输入变更时清除旧校验提示

- [x] Task 8: 端到端验证
  - [x] SubTask 8.1: 运行 `go build ./...` 与 `go vet ./...`，确保后端编译通过；运行 `go test ./internal/probe/...`
  - [x] SubTask 8.2: 前端 `npm run build`（或 `bun run build`）确保 TypeScript 与构建通过
  - [x] SubTask 8.3: 使用真实渠道手动触发一次可用性探测，核对结果与实际可达性一致（同时验证 `channels.key` 是否为可用明文）
  - [x] SubTask 8.4: 验证非法 cron 被拒绝、合法 cron 正确计算下次运行时间、配置保存后热生效
  - [x] SubTask 8.5: 验证质量探测在无可用性成功结果时跳过、在有结果时按渠道抽样并落库分数

# Task Dependencies

- Task 2 依赖 Task 1（SubTask 2.4 需要 ProbeStore）
- Task 3、Task 4 依赖 Task 1、Task 2
- Task 5 依赖 Task 1、Task 2、Task 3、Task 4
- Task 6 依赖 Task 1、Task 2、Task 3、Task 4、Task 5
- Task 7 依赖 Task 5（接口约定确定后即可并行开发前端）
- Task 8 依赖全部任务完成
- Task 3 与 Task 4 可并行开发；Task 7 的子任务之间可并行
