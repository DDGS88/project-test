# 渠道模型可用性与质量定时探测 Spec

## Why

当前 tt-inspector 只能**被动**从网关日志里发现异常（正则规则、错误日志分析告警、错误率）。当某个渠道的某个模型已经不可达（上游挂了、key 失效、base_url 变更、模型被下线）而恰好没有真实流量经过时，系统完全无感知。

需要新增**主动**探测能力：按可配置的 cron 表达式定时对指定渠道的全部模型发最小请求做可用性探测；在可用性正常的前提下，再按独立 cron 从可用渠道里抽样做一次中转站真伪/质量检测（复用已部署的 veridrop）。异常时通过飞书告警。

## What Changes

- 侧边栏新增「渠道探测」菜单，页面内含「可用性探测」「质量探测」两个配置与结果页签。
- 渠道凭据来源：业务库（MySQL）`channels` 表的 `base_url` + `key`；模型列表来自 `abilities` 表按 `channel_id` 关联（现有查询已具备，需补充凭据查询能力）。
- **新增** 可用性探测器：每次运行对「白名单渠道 ∩ 启用且有 base_url+key」的渠道下**全部模型**各发一次最小 chat 请求（`max_tokens=1`，prompt 默认 `hi`），只判可达性。
- **新增** 质量探测器：独立 cron；从**最近一次可用性探测**的成功结果里，**每个可用渠道各随机挑 1 个模型**，调用 veridrop 检测接口，落库分数/结论，低于阈值告警。
- **新增** cron 表达式配置（标准 5 字段），页面可校验并预览下次运行时间。
- **新增** 探测结果持久化 + 页面查看（运行历史、失败明细、分数结论）。
- **新增** 飞书告警（复用现有 `notifier.FeishuNotifier`），可用性与质量各自可配 webhook 与 @用户。
- 新增 Go 依赖 `github.com/robfig/cron/v3`（已验证可拉取）。

## Impact

- 受影响能力：渠道探测调度、渠道凭据只读查询、飞书告警复用、控制台侧边栏与页面
- 受影响代码：
  - 后端模型/存储：[channel.go](file:///Users/broocean/GolandProjects/tt-inspector/internal/model/channel.go)、新增 `internal/model/channel_probe.go`、[channel_store.go](file:///Users/broocean/GolandProjects/tt-inspector/internal/store/channel_store.go)、新增 `internal/store/probe_store.go`
  - 后端探测与调度：新增 `internal/probe/{cron.go,scheduler.go,availability.go,quality.go,veridrop_client.go}`
  - 后端 API：[router.go](file:///Users/broocean/GolandProjects/tt-inspector/internal/api/router.go)、新增 `internal/api/handler_probe.go`
  - 服务装配与建表：[server.go](file:///Users/broocean/GolandProjects/tt-inspector/internal/server/server.go)、[config.go](file:///Users/broocean/GolandProjects/tt-inspector/internal/config/config.go)、[config.yaml](file:///Users/broocean/GolandProjects/tt-inspector/config/config.yaml) 等三份配置
  - 前端：[Sidebar.tsx](file:///Users/broocean/GolandProjects/tt-inspector/ai-gateway-console/src/components/Sidebar.tsx)、[App.tsx](file:///Users/broocean/GolandProjects/tt-inspector/ai-gateway-console/src/App.tsx)、[types.ts](file:///Users/broocean/GolandProjects/tt-inspector/ai-gateway-console/src/types.ts)、[rules.ts](file:///Users/broocean/GolandProjects/tt-inspector/ai-gateway-console/src/api/rules.ts)、新增 `ChannelProbeView.tsx`
- 新增数据表（建在 `log_database`，即告警平台库）：`probe_settings`、`probe_runs`、`probe_results`
- **不改动**：现有规则引擎、错误扫描、veridrop 反向代理链路（`/veridrop`）均保持原样

## 关键假设与风险

- 假设 `channels.key` 为可直接使用的明文 API Key（new-api 默认行为）。若该实例开启了渠道 key 加密，探测会统一返回鉴权失败 —— 此时需要网关侧提供明文或解密方案，属本次范围外，会在验证阶段用真实渠道确认。
- 假设渠道 `base_url` 为 OpenAI 兼容根地址（可能带或不带 `/v1`），探测时做归一化处理；`base_url` 为空的渠道直接跳过、不计入失败。
- veridrop 检测有上游成本与耗时（单次 30–75 秒），因此质量探测默认抽样量小（每渠道 1 个）且 cron 频率低。

## ADDED Requirements

### Requirement: 渠道凭据只读查询

系统 SHALL 能只读查询业务库渠道的探测凭据与模型列表。

渠道模型（只读）新增字段：`key`、`base_url`、`status`。系统 SHALL 提供「按渠道聚合」的查询，返回渠道 id、名称、base_url、key、status 及该渠道下的模型列表（来自 `abilities` 表）。

#### Scenario: 查询可用渠道凭据
- **WHEN** 调用渠道凭据查询
- **THEN** 返回渠道 id、名称、`base_url`、`key`、`status`，以及该渠道关联的去重模型列表

#### Scenario: 渠道包含多个 key
- **WHEN** `channels.key` 为逗号分隔的多个 key
- **THEN** 探测时使用第一个非空 key

### Requirement: 探测配置持久化

系统 SHALL 支持「可用性探测」与「质量探测」两套独立配置，持久化在告警平台库，服务重启后不丢失。

可用性探测配置字段：
- `enabled` 启用开关（默认 false）
- `cron` 标准 5 字段 cron 表达式（默认 `0 */6 * * *`）
- `channel_ids` 渠道白名单（为空时表示「全部满足凭据条件的渠道」）
- `max_models_per_channel` 每渠道最多探测模型数，0 表示不限
- `concurrency` 并发数（默认 5）
- `timeout_sec` 单请求超时秒数（默认 15）
- `max_tokens` 默认 1
- `prompt` 探测内容（默认 `hi`）
- `cooldown_sec` 告警冷却秒数（默认 1800）
- `feishu_webhook`、`at_users` 告警配置

质量探测配置字段：
- `enabled` 启用开关（默认 false）
- `cron` 标准 5 字段 cron 表达式（默认 `0 4 * * *`）
- `mode` veridrop 检测模式（默认 `standard`）
- `score_threshold` 分数告警阈值（默认 60，低于则告警）
- `timeout_sec` 单个检测任务等待超时（默认 300）
- `cooldown_sec` 告警冷却秒数（默认 3600）
- `feishu_webhook`、`at_users` 告警配置

#### Scenario: 保存非法 cron
- **WHEN** 提交无法解析的 cron 表达式
- **THEN** 接口返回 400 且配置不被保存

#### Scenario: 保存合法 cron
- **WHEN** 提交合法 cron 表达式
- **THEN** 配置保存成功，且接口返回该表达式的下次运行时间

#### Scenario: 配置热生效
- **WHEN** 配置保存成功
- **THEN** 调度器在无需重启服务的情况下按新配置重排下一次运行时间

### Requirement: cron 表达式校验与下次运行时间

系统 SHALL 使用标准 5 字段 cron 表达式（分 时 日 月 周）驱动调度，并 SHALL 能单独校验表达式、返回解析结果与下次运行时间。

#### Scenario: 校验表达式
- **WHEN** 提交 `0 */6 * * *`
- **THEN** 返回 `valid=true` 与下次运行时间

#### Scenario: 校验非法表达式
- **WHEN** 提交 `*/6 * *`
- **THEN** 返回 `valid=false` 与错误说明

### Requirement: 渠道模型可用性探测

系统 SHALL 按配置的 cron 定时执行可用性探测，对每个目标渠道下的模型各发起一次最小请求，判定其是否可达，并将结果落库。

探测范围 SHALL 为「渠道白名单 ∩ 启用（`status=1`）且有 `base_url`、`key`」，白名单为空时取全部满足条件的渠道。每个目标渠道 SHALL 覆盖其**全部模型**（`max_models_per_channel` > 0 时按该上限截断）。

单次探测请求：
- URL：`{base_url 归一化}/chat/completions`，若 `base_url` 不以 `/v1`（或 `/v1beta`）结尾则先追加 `/v1`
- Header：`Authorization: Bearer {key}`、`Content-Type: application/json`
- Body：`{"model": "{模型}", "messages": [{"role": "user", "content": "{prompt}"}], "max_tokens": {max_tokens}, "stream": false}`

判定规则：HTTP 2xx 记为成功；非 2xx 记为失败并记录状态码与响应体摘要；网络错误/超时记为失败并记录错误原因。每次探测 SHALL 记录耗时（毫秒）。

跳过规则（记为 skipped，不计入失败、不触发告警）：渠道不在白名单、渠道非启用、缺 `base_url` 或 `key`、渠道无模型。

#### Scenario: 模型可用
- **WHEN** 探测请求返回 HTTP 200
- **THEN** 该「渠道-模型」结果记为成功，并记录耗时

#### Scenario: 模型不可用
- **WHEN** 探测请求返回 HTTP 404 / 401 / 5xx 或超时
- **THEN** 该「渠道-模型」结果记为失败，记录状态码或错误原因

#### Scenario: 渠道缺少凭据
- **WHEN** 目标渠道 `base_url` 或 `key` 为空
- **THEN** 该渠道下所有模型记为跳过，原因标注「缺少 base_url/key」，且不触发告警

#### Scenario: 并发受控
- **WHEN** 探测任务包含大量渠道-模型组合
- **THEN** 同时在途的探测请求数不超过配置的 `concurrency`

#### Scenario: 手动触发
- **WHEN** 用户点击「立即执行」
- **THEN** 立即异步启动一次可用性探测，接口立即返回已受理

### Requirement: 可用性异常飞书告警

系统 SHALL 在一次可用性探测运行结束后，若存在失败项，则按渠道聚合发送一条飞书告警，内容包含：运行时间、失败渠道数、失败模型数、失败明细样本（渠道名、模型、状态码或错误原因）。系统 SHALL 按 `cooldown_sec` 做冷却，冷却期内不重复发送。

#### Scenario: 存在失败项
- **WHEN** 一次运行中 3 个「渠道-模型」失败
- **THEN** 发送一条飞书告警卡片，含失败明细

#### Scenario: 未配置 webhook
- **WHEN** 失败项存在但未配置 `feishu_webhook`
- **THEN** 仅记录日志与落库，不发送通知，且不影响探测任务本身

#### Scenario: 冷却期内
- **WHEN** 距上次同配置告警未超过 `cooldown_sec`
- **THEN** 不重复发送告警

#### Scenario: 全部成功
- **WHEN** 一次运行无失败项
- **THEN** 不发送任何告警消息

### Requirement: 渠道模型质量探测

系统 SHALL 按配置的独立 cron 定时执行质量探测；质量探测 SHALL 依赖**最近一次可用性探测**的成功结果，不依赖本次可用性是否刚跑完。

候选集合 SHALL 为「最近一次可用性运行中判定成功的渠道-模型」，按渠道分组，**每个可用渠道随机抽取 1 个模型**。若不存在可用性成功结果，则本次运行记为「跳过」并说明原因，不告警。

对每个候选，系统 SHALL 调用 veridrop 检测接口：
1. 依据模型名推断协议（`claude*` → anthropic；`gpt-*`/`o1`/`o3`/`o4`/`chatgpt*` → openai；`gemini*` → gemini）；无法推断的候选跳过
2. 提交检测任务（form 参数：`base_url`、`api_key`、`model`、`mode`），获得 `job_id`
3. 轮询任务状态直到 `done` 或 `error`，总等待不超过 `timeout_sec`
4. `done` 时读取报告 JSON，取 `total_score` 与 `verdict`

质量探测结果 SHALL 落库，并在分数低于 `score_threshold` 或检测失败时按 `cooldown_sec` 冷却发送飞书告警。

#### Scenario: 抽取候选并检测
- **WHEN** 最近一次可用性运行中渠道 A、B 各有成功模型
- **THEN** 分别从 A、B 各随机取 1 个模型提交 veridrop 检测，两个渠道各产生一条质量结果

#### Scenario: 无可用性成功结果
- **WHEN** 从未运行过可用性探测，或最近一次运行无任何成功项
- **THEN** 本次质量探测记为跳过，记录原因，不发送告警

#### Scenario: 分数低于阈值
- **WHEN** 某渠道检测 `total_score` 低于 `score_threshold`
- **THEN** 落库该结果并发送飞书告警（含渠道、模型、分数、结论与报告链接）

#### Scenario: 检测超时
- **WHEN** 轮询超过 `timeout_sec` 任务仍未完成
- **THEN** 该候选记为失败并记录超时原因

### Requirement: 探测结果查询与展示

系统 SHALL 提供运行历史与结果明细查询接口，并在控制台展示。

#### Scenario: 查看运行历史
- **WHEN** 打开「渠道探测」页面
- **THEN** 展示最近若干次运行（可用性/质量分别），含触发方式、开始/结束时间、总数/成功数/失败数/跳过数

#### Scenario: 查看失败明细
- **WHEN** 选择某次运行并筛选失败项
- **THEN** 展示渠道、模型、状态码、错误原因、耗时（质量探测展示分数与结论）

#### Scenario: 查看下次运行时间
- **WHEN** 探测已启用且 cron 合法
- **THEN** 页面展示该探测的下次预计运行时间

### Requirement: 控制台入口

系统 SHALL 在侧边栏新增「渠道探测」入口，点击进入渠道探测页面；该页面 SHALL 提供配置表单（启用、cron、渠道白名单、并发、超时、max_tokens、prompt、告警 webhook 与 @用户）、保存、「立即执行」按钮，以及可用性/质量两套结果视图。

#### Scenario: 保存配置
- **WHEN** 用户修改配置并保存成功
- **THEN** 页面提示保存成功，并刷新展示的下次运行时间

#### Scenario: 保存非法 cron
- **WHEN** 用户填入非法 cron 表达式并保存
- **THEN** 页面提示表达式非法，配置未被保存
