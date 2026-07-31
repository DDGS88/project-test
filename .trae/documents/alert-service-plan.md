# AI 网关告警服务设计计划

## 一、项目概述

为 AI 统一网关平台构建独立的告警服务（`tt-inspector`），通过直连网关数据库轮询日志表，基于可配置的规则引擎进行匹配告警，并通过飞书 Webhook 推送通知。

## 二、当前状态分析

- `tt-inspector` 项目为空白 GoLand 模板（仅 `go.mod` + 模板 `main.go`）
- 日志表（位于网关库中）已具备良好的索引设计：`created_at`、`channel_id`、`type`、`user_id`、`model_name` 等关键字段均有索引
- 项目需从零搭建：分层结构、数据库连接、规则引擎、告警通知、API 接口

## 三、核心决策

| 决策项 | 选择 | 理由 |
|--------|------|------|
| 数据获取 | 直连同一数据库 | 用户确认 |
| 阈值机制 | 时间窗口内计数 | 用户确认 |
| 规则配置 | 数据库存储 + API CRUD + 热加载 | 用户确认 |
| 扩展方向 | 多维度可扩展 | 用户确认 |
| 通知方式 | 飞书 Webhook | 用户明确 |
| 前端管理界面 | React + TypeScript + Vite | TS 全栈一致，React 可复用用户技能 |

## 四、架构设计

```
tt-inspector/
├── cmd/
│   └── server/
│       └── main.go              # 入口，组装服务并启动
├── internal/
│   ├── config/
│   │   └── config.go            # 配置结构（DB、飞书、轮询参数等）
│   ├── model/
│   │   ├── log.go               # 日志表模型（只读，对应网关库）
│   │   └── alert_rule.go        # 告警规则表模型
│   ├── store/
│   │   ├── log_store.go         # 日志查询（只读）
│   │   └── rule_store.go        # 规则 CRUD
│   ├── engine/
│   │   ├── engine.go            # 规则引擎主流程（调度、执行、协调）
│   │   ├── rule.go              # Rule 接口定义 + 工厂
│   │   ├── rule_regex.go        # 正则匹配规则实现
│   │   ├── rule_error_rate.go   # 错误率规则实现（扩展预留）
│   │   └── rule_token.go        # Token 消耗规则实现（扩展预留）
│   ├── notifier/
│   │   ├── notifier.go          # Notifier 接口
│   │   └── feishu.go            # 飞书 Webhook 实现
│   └── api/
│       ├── router.go            # HTTP 路由注册（含 CORS、静态文件服务）
│       └── handler_rule.go      # 规则管理 API handler
├── web/                          # 前端项目
│   ├── index.html
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── main.tsx              # React 入口
│       ├── App.tsx               # 路由布局
│       ├── api/
│       │   └── rules.ts          # API 请求封装
│       ├── types/
│       │   └── rule.ts           # 前端类型定义
│       ├── pages/
│       │   └── RulesPage.tsx     # 规则列表页（主页面）
│       ├── components/
│       │   ├── RuleFormModal.tsx  # 创建/编辑规则弹窗
│       │   ├── RuleCard.tsx       # 规则卡片组件
│       │   └── Header.tsx         # 顶部导航
│       └── styles/
│           └── index.css         # 全局样式
├── config/
│   └── config.yaml              # 默认配置文件
├── go.mod
├── go.sum
└── Makefile
```

### 分层职责

1. **config** — 加载 YAML 配置（DB DSN、飞书 Webhook URL、轮询间隔、默认时间窗口等）
2. **model** — GORM 模型定义（`Log` 只读，`AlertRule` 可读写）
3. **store** — 数据访问层（`LogStore` 查询日志，`RuleStore` 管理规则）
4. **engine** — 规则引擎核心，基于策略模式，定时轮询日志并对每条启用的规则执行匹配，判定是否触发告警
5. **notifier** — 告警通知渠道抽象，首期实现飞书 Webhook
6. **api** — 规则的 HTTP CRUD 接口，供管理后台使用

## 五、数据模型设计

### 5.1 日志表（只读，定义在 model 中用于 GORM 查询）

```go
// Log 网关日志表（只读）
type Log struct {
    Id               int    `gorm:"primaryKey"`
    UserId           int    `gorm:"index"`
    CreatedAt        int64  `gorm:"index:idx_created_at_id;index:idx_created_at_type"`
    Type             int    `gorm:"index:idx_created_at_type"`
    Content          string `gorm:"type:text"`
    Username         string `gorm:"index"`
    TokenName        string `gorm:"index"`
    ModelName        string `gorm:"index"`
    Quota            int
    PromptTokens     int
    CompletionTokens int
    UseTime          int
    IsStream         bool
    ChannelId        int    `gorm:"index"`
    ChannelName      string `gorm:"->"`  // 只读
    TokenId          int    `gorm:"index"`
    Group            string `gorm:"index"`
    Ip               string `gorm:"index"`
    RequestId        string `gorm:"index"`
    UpstreamRequestId string `gorm:"index"`
    ResponseId       string `gorm:"index"`
    Other            string `gorm:"type:text"`
}
```

### 5.2 告警规则表

```go
// AlertRule 告警规则
type AlertRule struct {
    Id          int64     `gorm:"primaryKey;autoIncrement"`
    Name        string    `gorm:"type:varchar(128);not null"`         // 规则名称
    Enabled     bool      `gorm:"default:true;index"`                 // 是否启用
    RuleType    string    `gorm:"type:varchar(32);not null;index"`    // 规则类型: regex / error_rate / token_threshold
    Condition   string    `gorm:"type:text;not null"`                 // 规则条件 JSON

    // 告警配置
    WindowSec   int       `gorm:"default:300"`                        // 统计时间窗口（秒），默认5分钟
    Threshold   int       `gorm:"default:1"`                          // 触发阈值（窗口内匹配次数）
    CooldownSec int       `gorm:"default:600"`                        // 冷却时间（秒），避免重复告警

    // 通知配置
    WebhookURL  string    `gorm:"type:varchar(512);not null"`         // 飞书 Webhook URL

    // 元数据
    Description string    `gorm:"type:varchar(512)"`                  // 规则描述
    CreatedAt   time.Time `gorm:"autoCreateTime"`
    UpdatedAt   time.Time `gorm:"autoUpdateTime"`
}
```

**Condition 字段示例（JSON）：**

```json
// regex 类型 — 渠道维度正则告警
{
    "channel_id": 1,
    "pattern": "(?i)(timeout|connection refused|rate.?limit)",
    "field": "content"
}

// error_rate 类型 — 扩展预留
{
    "channel_id": 1,
    "type": 2  // type=2 表示错误
}

// token_threshold 类型 — 扩展预留
{
    "user_id": 0,         // 0 表示不限用户
    "model_name": "gpt-4",
    "token_field": "prompt_tokens",
    "single_request_threshold": 100000
}
```

## 六、核心流程

### 6.1 规则引擎主循环

```
┌──────────────────────────────────────────────────────┐
│                   Engine.Run()                        │
│                                                       │
│  每 PollInterval 秒执行一次                            │
│    │                                                  │
│    ├─ 1. 从 RuleStore 加载所有 Enabled=true 的规则    │
│    │     (规则缓存，可配置热加载间隔)                    │
│    │                                                  │
│    ├─ 2. 遍历每条规则                                  │
│    │     │                                            │
│    │     ├─ 检查是否在冷却期 → 跳过                     │
│    │     │                                            │
│    │     ├─ 根据 RuleType 调用对应 Rule 实现           │
│    │     │   Rule.Evaluate(db, rule, windowStart,      │
│    │     │                  windowEnd)                 │
│    │     │   → 返回 matchCount (匹配次数)              │
│    │     │                                            │
│    │     ├─ 若 matchCount >= Threshold                 │
│    │     │   → 构造告警消息                            │
│    │     │   → 调用 Notifier.Send(msg)                 │
│    │     │   → 更新冷却时间戳                          │
│    │     │                                            │
│    │     └─ 记录评估日志                               │
│    │                                                  │
│    └─ 3. 更新游标 (扫描位点)                           │
└──────────────────────────────────────────────────────┘
```

### 6.2 Regex 规则评估 SQL（示例）

```sql
SELECT COUNT(*) 
FROM logs 
WHERE created_at >= ? AND created_at < ? 
  AND channel_id = ? 
  AND content REGEXP ?
```

走 `idx_created_at_type` 索引（`created_at` + `type`），再结合 `channel_id` 索引。

### 6.3 告警去重与冷却

- 每条规则维护一个 `last_alert_at` 时间戳（内存中，服务重启后丢失可接受）
- 在冷却期内（`CooldownSec`），即使再次达到阈值也不发送通知
- 冷却期过后，若再次触发则发送新告警

### 6.4 飞书通知消息格式

```json
{
    "msg_type": "interactive",
    "card": {
        "header": {
            "title": {"content": "🚨 AI 网关告警", "tag": "red"},
            "template": "red"
        },
        "elements": [
            {
                "tag": "markdown",
                "content": "**规则名称**: {rule_name}\n**匹配次数**: {match_count} / {threshold}\n**时间窗口**: {window_start} ~ {window_end}\n**匹配条件**: {condition_summary}"
            }
        ]
    }
}
```

## 七、配置示例

```yaml
# config/config.yaml
server:
  port: 9200
  read_timeout: 30s
  write_timeout: 30s

database:
  dsn: "user:password@tcp(127.0.0.1:3306)/gateway_db?charset=utf8mb4&parseTime=True&loc=Local"
  max_open_conns: 10
  max_idle_conns: 5

engine:
  poll_interval: 30s            # 轮询间隔
  rule_reload_interval: 60s     # 规则热加载间隔
  default_window_sec: 300       # 默认时间窗口（秒）
  default_cooldown_sec: 600     # 默认冷却时间（秒）
  checkpoint_file: "checkpoint.json"  # 游标持久化文件

logging:
  level: "info"
  format: "json"
```

## 八、API 接口设计

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/api/v1/rules` | 列出所有规则 |
| `POST` | `/api/v1/rules` | 创建规则 |
| `PUT` | `/api/v1/rules/:id` | 更新规则 |
| `DELETE` | `/api/v1/rules/:id` | 删除规则 |
| `GET` | `/api/v1/rules/:id` | 查看单条规则 |
| `POST` | `/api/v1/rules/:id/enable` | 启用规则 |
| `POST` | `/api/v1/rules/:id/disable` | 禁用规则 |

## 九、后端依赖选择

| 用途 | 依赖 | 理由 |
|------|------|------|
| Web 框架 | `github.com/gin-gonic/gin` | 轻量高性能 |
| ORM | `gorm.io/gorm` + `gorm.io/driver/mysql` | 与网关一致 |
| 配置 | `github.com/spf13/viper` | 标准化配置管理 |
| 日志 | `go.uber.org/zap` | 高性能结构化日志 |
| 飞书 SDK | 无（直接 HTTP 调用 Webhook） | 仅需发送消息，无需完整 SDK |
| CORS | `github.com/gin-contrib/cors` | 前端跨域支持 |

## 十、前端设计

### 10.1 技术选型

| 用途 | 选择 | 理由 |
|------|------|------|
| 框架 | React 18 + TypeScript | 用户已有 React/TS 技能 |
| 构建工具 | Vite | 极速 HMR，零配置起步 |
| 路由 | React Router v6 | 标准 SPA 路由，轻量 |
| 样式 | Tailwind CSS | 原子化 CSS，开发效率高 |
| HTTP | fetch 原生封装 | 无第三方依赖，API 简单 |
| 状态 | React hooks | 单页面无需 redux，hooks 足够 |

### 10.2 页面设计

```
┌──────────────────────────────────────────────────────┐
│  Header: AI Gateway Alert Manager    [+ 创建规则]     │
├──────────────────────────────────────────────────────┤
│                                                       │
│  ┌─ 规则类型筛选: [全部] [regex] [error_rate] ... ─┐ │
│  │                                                    │
│  └────────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────── RuleCard ───────────────┐               │
│  │ 规则名称          [启用 开关]  ···  │               │
│  │ 类型: regex · 渠道: xxx             │               │
│  │ 时间窗口: 300s · 阈值: 100          │               │
│  │ 条件摘要: pattern=xxx              │               │
│  │ 飞书 Webhook: https://...          │               │
│  │ [编辑] [删除]                      │               │
│  └────────────────────────────────────┘               │
│                                                       │
│  ┌─────────── RuleCard ───────────────┐               │
│  │ ...                                │               │
│  └────────────────────────────────────┘               │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### 10.3 核心组件说明

| 组件 | 职责 |
|------|------|
| `App.tsx` | 路由定义，根布局 |
| `RulesPage.tsx` | 规则列表主页面：加载规则、筛选、刷新 |
| `RuleCard.tsx` | 单条规则卡片：展示摘要、启用/禁用开关、编辑/删除操作 |
| `RuleFormModal.tsx` | 创建/编辑规则弹窗：表单含规则类型选择、条件 JSON 编辑器、阈值/窗口/冷却配置、Webhook URL |
| `Header.tsx` | 顶部导航栏：标题 + 新建按钮 |

### 10.4 规则表单设计

根据 `RuleType` 动态渲染不同的条件表单：

| RuleType | 表单字段 |
|----------|---------|
| `regex` | 渠道 ID（下拉）、匹配字段（content/other）、正则表达式、时间窗口、阈值、冷却时间、Webhook URL |
| `error_rate` | 渠道 ID、时间窗口、错误率百分比阈值、Webhook URL |
| `token_threshold` | 用户 ID（可选）、模型名、Token 字段、单次请求上限、Webhook URL |

当前首期仅实现 `regex` 类型的完整表单，其余类型预留 UI 骨架。

### 10.5 后端静态文件服务

- 开发阶段：前端 `vite dev` 独立运行在 `localhost:5173`，通过 Vite proxy 转发 API 到后端 `localhost:9200`
- 生产阶段：前端 `vite build` 输出到 `web/dist/`，Go 后端通过 `router.Static("/", "./web/dist")` 直接托管静态文件



## 十一、实现步骤

### Step 1: 后端项目骨架搭建
- 创建目录结构
- 初始化 `go.mod` 依赖
- 编写 `config/config.go` 配置加载（Viper）
- 编写 `cmd/server/main.go` 入口（Gin + GORM 初始化 + 引擎启动）

### Step 2: 数据层
- 编写 `model/log.go` 和 `model/alert_rule.go` 模型
- 编写 `store/log_store.go` 日志查询层（只读）
- 编写 `store/rule_store.go` 规则 CRUD
- 编写 GORM AutoMigrate（仅 AlertRule 表；Log 表只读不迁移）

### Step 3: 规则引擎
- 定义 `engine/rule.go` Rule 接口 + 工厂
- 实现 `engine/rule_regex.go` 正则匹配规则
- 实现 `engine/engine.go` 主循环（调度、冷却、调用 notifier）
- 实现游标/位点管理（文件持久化，防重启重复扫描）

### Step 4: 通知模块
- 定义 `notifier/notifier.go` 接口
- 实现 `notifier/feishu.go` 飞书 Webhook 通知

### Step 5: 后端 API 层
- 编写 `api/router.go` 路由注册（含 CORS、静态文件 fallback）
- 编写 `api/handler_rule.go` 规则 CRUD handler
- 规则变更后通知引擎热加载

### Step 6: 前端项目初始化
- `cd web` 创建 Vite + React + TS 项目
- 安装依赖：`react-router-dom`、`tailwindcss`、`@tailwindcss/vite`
- 配置 `vite.config.ts`（dev proxy → `localhost:9200`）
- 编写 `types/rule.ts` 类型定义

### Step 7: 前端页面开发
- 编写 `api/rules.ts` API 请求封装
- 编写 `components/Header.tsx`
- 编写 `components/RuleCard.tsx`（含启用/禁用开关）
- 编写 `components/RuleFormModal.tsx`（regex 表单完整 + 其他类型骨架）
- 编写 `pages/RulesPage.tsx` 组装页面
- 编写 `App.tsx` + `main.tsx` 入口

### Step 8: 前后端联调与生产构建
- 验证全链路：创建规则 → 引擎轮询 → 匹配阈值 → 飞书告警
- 生产构建：`vite build` → `web/dist/`，Go 后端托管静态文件
- 编写 `Makefile`（`make dev` / `make build`）

## 十二、安全与运维考虑

1. **只读连接**：日志表使用只读数据库账号
2. **Webhook URL 加密存储**：飞书 Webhook URL 建议在数据库中加密存储（当前先明文，后续迭代）
3. **游标持久化**：使用文件存储扫描位点，服务重启不丢进度
4. **优雅关闭**：监听 SIGTERM/SIGINT，保存游标后退出
5. **监控自身**：引擎本身也输出结构化日志，可观测轮询耗时、规则评估耗时
6. **告警风暴防护**：冷却机制 + 最大告警频率限制
