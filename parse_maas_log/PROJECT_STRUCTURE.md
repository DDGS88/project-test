# 项目结构说明

本文档说明 `parse_maas_log` 项目各目录与文件的作用。

## 目录结构总览

```
parse_maas_log/
├── web_app.py                  # Flask Web 应用主入口
├── parse_and_report.py         # 核心解析引擎 & HTML 报告生成
├── server_db.py                # SQLite 数据库操作层
├── login.html                  # 登录页面
├── index.html                  # 主控制台页面
├── name-apikey-mapping.csv     # Resource ID → 名称映射表
├── requirements.txt            # Python 依赖清单
├── Dockerfile                  # Docker 镜像构建文件
├── docker-compose.yml          # Docker Compose 编排配置
├── .dockerignore               # Docker 构建忽略规则
├── .gitignore                  # Git 忽略规则
├── uploads/                    # 上传文件存储目录（运行时自动创建）
├── reports/                    # HTML 报告输出目录（运行时自动创建）
├── chunks/                     # 分片上传临时目录（运行时自动创建）
├── server_data.db              # SQLite 数据库文件（运行时自动创建）
├── .venv/                      # Python 虚拟环境
└── .idea/                      # PyCharm IDE 配置
```

---

## 核心源码文件

### web_app.py

Flask Web 应用主入口，负责：

- **路由与页面**：登录页、主页、报告查看、文件下载
- **登录认证**：基于 session 的登录装饰器 `login_required`，支持环境变量配置管理员账号（`ADMIN_USER` / `ADMIN_PASS`）
- **分片上传**：支持大文件分片上传（每片 5MB），包含三个接口：
  - `/api/upload_init` — 初始化上传，返回 `upload_id`
  - `/api/upload_chunk` — 接收单个分片
  - `/api/upload_complete` — 合并分片，生成最终文件
- **解析接口**：`/api/parse` 调用解析引擎，生成 HTML 报告并存入数据库
- **历史记录管理**：查询、删除解析记录
- **启动方式**：`python web_app.py`，默认监听 `0.0.0.0:8899`

### parse_and_report.py

核心解析引擎与报告生成器，可独立运行也可被 Web 应用调用：

- **文件解析**：
  - `parse_csv()` — 解析 CSV 文件，自动检测 Tab/逗号分隔符
  - `parse_xlsx()` — 解析 XLSX 文件（依赖 openpyxl）
  - `parse_file()` — 统一入口，按扩展名自动选择解析器
- **映射表加载**：`load_mapping()` 加载 Resource ID → 名称映射，并从中提取用户名（如 `api-key-日本电信-5` → `日本电信`）
- **多维度聚合**：`aggregate()` 按 Payer User Name / Resource ID / User / Product / Instance ID 五个维度统计，支持子资源明细
- **HTML 报告生成**：`build_html()` 生成自包含 HTML 报告，含概览卡片、Canvas 柱状图、可展开表格
- **命令行模式**：`python parse_and_report.py <CSV路径>` 直接生成报告

### server_db.py

SQLite 数据库操作层，提供数据持久化：

- **数据库初始化**：`init_db()` 创建 `parse_records` 和 `uploads` 两张表
- **解析记录管理**：增删查改解析历史记录
- **上传记录管理**：记录上传文件信息，查询最新映射表
- **统计接口**：`get_stats()` 返回累计解析次数、记录数、金额
- **数据库路径**：`server_data.db`，启用 WAL 模式提升并发性能

---

## 前端页面

### login.html

登录页面，提供：

- 用户名/密码输入表单
- 调用 `/api/login` 接口验证凭据
- 登录成功后跳转主页
- 错误提示展示

### index.html

主控制台页面，提供：

- **上传区**：消费明细 CSV/XLSX 上传 + 映射表上传（可选），支持拖拽
- **操作栏**：开始解析、刷新历史、退出登录
- **进度条**：分片上传实时进度显示
- **解析结果摘要**：总记录数、总 Usage、总金额、Payer 用户
- **历史记录表格**：查看报告、下载 CSV、删除记录
- **全局 401 拦截**：session 过期自动跳转登录页

---

## 配置文件

### name-apikey-mapping.csv

Resource ID → 人类可读名称的映射表：

- **格式**：Tab 或逗号分隔，需包含「名称」和「资源ID」两列
- **作用**：将 `apikey-20260718174458-zdczz` 这样的 Resource ID 映射为 `api-key-antdigital` 等可读名称
- **用户名提取**：从名称中提取用户名（去掉 `api-key-` 前缀和末尾的 `-数字` 后缀）
- **使用方式**：可不上传，系统默认使用此文件；也可通过 Web 上传新的映射表覆盖

### requirements.txt

Python 依赖清单：

| 包名 | 版本要求 | 用途 |
|------|---------|------|
| flask | ≥ 3.0 | Web 框架 |
| gunicorn | ≥ 21.0 | 生产级 WSGI 服务器 |
| openpyxl | ≥ 3.1 | XLSX 文件解析 |

### Dockerfile

Docker 镜像构建文件：

- 基础镜像：`python:3.11-slim`
- 安装依赖并复制源码
- 使用 gunicorn 运行（4 workers，300s 超时）
- 暴露端口 5000

### docker-compose.yml

Docker Compose 编排配置：

- 端口映射：`8899:5000`
- 环境变量：`ADMIN_USER`、`ADMIN_PASS`、`SECRET_KEY`
- 卷挂载：`uploads/`、`reports/`、`server_data.db`、`name-apikey-mapping.csv`
- 重启策略：`unless-stopped`

### .dockerignore

Docker 构建时忽略的文件，避免将缓存、上传文件、数据库等打入镜像。

### .gitignore

Git 版本控制忽略规则。

---

## 运行时目录

以下目录在应用启动时自动创建，用于存储运行时数据：

| 目录/文件 | 作用 | 生命周期 |
|-----------|------|---------|
| `uploads/` | 存储用户上传的 CSV/XLSX 文件和映射表 | 持久化，随解析记录删除而清理 |
| `reports/` | 存储生成的 HTML 分析报告 | 持久化，随解析记录删除而清理 |
| `chunks/` | 分片上传的临时分片和元数据 | 临时，上传完成后自动清理 |
| `server_data.db` | SQLite 数据库文件 | 持久化，记录解析历史和上传记录 |

---

## 开发环境

### .venv/

Python 虚拟环境目录，包含项目依赖的独立安装环境。通过 `python -m venv .venv` 创建。

### .idea/

PyCharm IDE 的项目配置目录，包含：

- `modules.xml` — 模块定义
- `misc.xml` — 杂项配置
- `workspace.xml` — 工作区状态
- `dataSources.xml` — 数据源（SQLite）配置
- `.gitignore` — IDE 层面的忽略规则

---

## 数据流说明

```
用户上传 CSV/XLSX
      │
      ▼
  uploads/  ──►  parse_and_report.py（解析 + 聚合 + 生成 HTML）
      │                    │
      │                    ▼
      │              reports/*.html
      │                    │
      ▼                    ▼
  server_db.py  ◄─── 记录元数据  ──►  server_data.db
      │
      ▼
  历史记录展示（index.html）
```
