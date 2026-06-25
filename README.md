# PULSE — AI Gateway

一个轻量级的 AI API 网关，统一管理和代理多个 AI 供应商（OpenAI、Anthropic 等）的请求，提供会话监控、审计日志、用量统计和端点管理功能。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | [Bun](https://bun.com) |
| 后端框架 | [Elysia](https://elysiajs.com) |
| 数据库 | SQLite (`bun:sqlite`) |
| 前端 | React 18 + TypeScript |
| 认证 | bcrypt 密码哈希 |

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发服务器 (HMR)
bun dev

# 生产构建
bun run build

# 生产运行
bun start
```

启动后访问 `http://localhost:3000`，默认管理员账号：`admin` / `admin123`。

## 项目结构

```
src/
├── index.ts              # 入口：Elysia 服务 + Bun.serve + WebSocket 代理
├── index.html            # 前端 HTML 入口
├── frontend.tsx          # React 挂载点
├── App.tsx               # 根组件（路由、登录、状态管理）
├── index.css             # 全局样式
├── db.ts                 # 数据库初始化 & Schema & 种子数据
├── types.ts              # TypeScript 类型定义
├── bun-env.d.ts          # Bun 环境类型声明
├── routes/
│   ├── auth.ts           # POST /api/auth/login, /api/auth/register
│   ├── sessions.ts       # GET/POST/PUT/DELETE /api/sessions
│   ├── logs.ts           # GET /api/logs (带筛选)
│   ├── endpoints.ts      # CRUD /api/endpoints
│   └── usage.ts          # GET /api/usage/stats, /by-model, /trend
└── components/
    ├── LoginPage.tsx      # 登录/注册页面
    ├── Sidebar.tsx        # 侧边导航栏
    ├── Topbar.tsx         # 顶部栏
    ├── SessionMonitor.tsx # 会话实时监控
    ├── AuditLogs.tsx      # 审计日志
    ├── Endpoints.tsx      # 端点管理
    └── Usage.tsx          # 用量统计
```

## API 文档

### 管理面板 API（内部使用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/auth/login` | 登录，返回用户信息 |
| POST | `/api/auth/register` | 注册新用户 |
| GET | `/api/sessions` | 获取所有会话列表 |
| GET | `/api/sessions/:id` | 获取单个会话详情及消息 |
| GET | `/api/sessions/:id/messages` | 获取会话消息 |
| POST | `/api/sessions` | 创建会话 |
| PUT | `/api/sessions/:id` | 更新会话 |
| DELETE | `/api/sessions/:id` | 删除会话 |
| GET | `/api/logs` | 获取请求日志（支持 `provider`、`status` 筛选） |
| GET | `/api/endpoints` | 获取所有端点 |
| GET | `/api/endpoints/:id` | 获取单个端点 |
| POST | `/api/endpoints` | 创建端点 |
| PUT | `/api/endpoints/:id` | 更新端点 |
| DELETE | `/api/endpoints/:id` | 删除端点 |
| GET | `/api/usage/stats` | 用量统计概览 |
| GET | `/api/usage/by-model` | 按模型分组统计 |
| GET | `/api/usage/trend` | 用量趋势数据 |
| GET | `/api/health` | 健康检查 |

### 网关代理 API（外部客户端调用）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/v1/chat/completions` | OpenAI 兼容接口，支持流式 |
| POST | `/anthropic/v1/messages` | Anthropic 兼容接口，支持流式 |

调用时在请求头传入在端点管理中配置的 `gateway_key`：
- OpenAI：`Authorization: Bearer <gateway_key>`
- Anthropic：`x-api-key: <gateway_key>`

## 端点配置

在管理面板的「Endpoints」页面配置上游供应商：

| 字段 | 说明 |
|---|---|
| 供应商名称 | 显示名称 |
| 端点 URL | 上游 API 地址 |
| API Key | 上游供应商的 API 密钥 |
| Gateway Key | 对外暴露的代理密钥 |
| Model Name | 默认模型名 |
| 价格 (input/output/cache) | 每百万 token 价格，用于成本计算 |

## 功能特性

- **多供应商代理** — 同时支持 OpenAI 和 Anthropic 格式，自动转换请求
- **流式响应** — 完整支持 SSE 流式输出，实时转发
- **会话追踪** — 自动创建会话、记录消息、统计 token 和延迟
- **成本核算** — 按 token 用量实时计算费用
- **请求日志** — 记录每次 API 调用的详情
- **用量分析** — 按模型、时间维度的统计图表

## 技术细节

- 数据库文件：`pulse.db`（SQLite WAL 模式）
- 首次启动自动建表并创建默认管理员
- API Key 在管理面板中脱敏显示（仅展示首尾各 4 位）
- 开发模式使用双端口：Elysia API (`3000`) + Bun HMR (`3001`)，通过 WebSocket 代理实现热更新
