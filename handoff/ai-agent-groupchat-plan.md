# AI 多 Agent 群聊协作计划

## 1. 概述

在简尚系统聊天页面内，建立一个含 Claude、Codex、Hermes 三个 AI Agent 的协作群聊。用户在群里通过 @mention 触发对应 AI 工作，AI 干完后 @下一个 AI，形成任务流转闭环。

### 核心原则

- **仅 @ 触发**：AI 只响应自己被 @ 的消息，不会主动发言或互相聊天
- **一次一个**：每个 AI 完成自己的部分后 @下一个，不会并行冲突
- **上下文透明**：任务状态、交接记录、项目信息在任务面板中全程可见
- **不额外占额度**：没有被 @ 就不消耗 API 额度

---

## 2. 现有基础（✅ 已有）

| 模块 | 状态 | 说明 |
|------|------|------|
| 群聊系统 | ✅ | 群聊创建、消息收发、成员管理已实现 |
| @AI 功能 | ✅ | 输入框支持 `@AI` 标签，可扩展为 @具体 Agent |
| AI 分身系统 | ✅ | 4 个分身（general/finance/warehouse/project），独立 `agent_key` |
| AI 工具系统 | ✅ | 通过 `executeTool` 调用业务接口，有权限控制 |
| AI 审计日志 | ✅ | `ai_audit_logs` 记录每次 AI 调用 |
| Claude Code 常驻 | ✅ | Claude 可直接响应 |
| 文件上传/附件 | ✅ | 群聊文件上传、图片预览、下载已实现 |

---

## 3. 需要开发的内容

### 3.1 Agent 桥接层（核心）

需要在后端新增一个 AI Agent 调用调度器，负责把群聊 @消息转发给对应的 AI。

**新增文件：**

```
backend/src/services/agentBridge.js      — Agent 调用调度器
backend/src/routes/agent-hooks.js        — Agent Webhook 接收端
```

**agentBridge.js 核心逻辑：**

```javascript
// 伪代码
function dispatchToAgent(agentKey, message, context) {
  switch (agentKey) {
    case 'claude':
      // Claude Code 常驻，通过 websocket 或轮询获取任务
      return callClaudeAPI(message, context)
    case 'codex':
      // Codex 有外部 API
      return callCodexAPI(message, context)
    case 'hermes':
      // Hermes 安全审计
      return callHermesAPI(message, context)
  }
}
```

**三种接入方式：**

| Agent | 接入方式 | 说明 |
|-------|---------|------|
| Claude | WebSocket / 任务队列 | Claude Code 常驻，可以轮询任务队列或通过 WebSocket 推送 |
| Codex | HTTP API / CLI | Codex 有 CLI 或 HTTP API，可以传递项目目录和指令 |
| Hermes | HTTP API / CLI | 同 Codex，需要传递项目路径和代码范围 |

**最简单的 V1 实现：**
后端生成任务记录 → 相关 Agent 轮询自己的待办 → 取任务、干活、回填结果 → @下一个

### 3.2 @mention 路由增强

**修改文件：** `backend/src/routes/chat.js`

**当前状态：** 仅有 `@AI` 标签插入输入框，没有后端路由逻辑。

**需要做：**

1. 消息发送时检测 `@Claude`、`@Codex`、`@Hermes` 关键词
2. 匹配到 Agent 关键词时：
   - 将消息同时转发给对应 Agent（通过 Agent 桥接层）
   - 在消息中标记 `agent_mention: true` 和 `target_agent: 'codex'`
3. Agent 回复时只回复自己被 @ 的那条消息（通过 `reply_to_message_id`）

**检测规则：**
- `@Claude` / `@claude` → 路由到 Claude
- `@Codex` / `@codex` → 路由到 Codex
- `@Hermes` / `@hermes` → 路由到 Hermes
- 同时 @多个 → 按顺序依次触发（当前一个完成后）

### 3.3 任务面板（前端）

**修改文件：** `frontend-new/src/views/chat/ChatIndex.vue`

在聊天页面右侧或下方新增任务面板：

```
┌─────────────────────┬──────────────────┐
│  群聊消息列表       │  当前任务         │
│                     │  ┌────────────┐  │
│  @Codex 计划...     │  │ 📋 任务 #7  │  │
│                     │  │ 状态: 进行中 │  │
│  Codex: 已处理      │  │ 负责人: Codex│  │
│   @Claude 请实现    │  │ 下一步: Claude│  │
│                     │  │             │  │
│  Claude: 已完成     │  │ 交接记录:    │  │
│   @Hermes 请审计    │  │ ✅ Codex 完成│  │
│                     │  │ ⏳ Claude 进行│  │
│                     │  │ ⬜ Hermes 等待│  │
│                     │  └────────────┘  │
└─────────────────────┴──────────────────┘
```

**任务面板包含：**
- 当前任务标题和描述
- 当前负责人 / 下一步负责人
- 交接记录时间线（谁什么时候完成了什么）
- 关联项目 ID 和文件链接

### 3.4 任务数据库

**新增表：** `agent_tasks`

```sql
CREATE TABLE agent_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_message_id TEXT,             -- 触发消息 ID
  title TEXT NOT NULL,              -- 任务标题
  description TEXT,                 -- 任务描述
  current_agent TEXT,               -- 当前负责人 (claude/codex/hermes)
  next_agent TEXT,                  -- 下一步负责人
  status TEXT DEFAULT 'pending',    -- pending/in_progress/completed/blocked
  project_id INTEGER DEFAULT 0,    -- 关联项目
  context_data TEXT,                -- 上下文 JSON（文件列表、分支等）
  created_by INTEGER,              -- 发起人用户 ID
  created_at DATETIME,
  updated_at DATETIME
)

CREATE TABLE agent_task_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  agent_key TEXT NOT NULL,          -- 哪个 Agent
  action TEXT NOT NULL,             -- assigned/started/completed/failed
  result_summary TEXT,              -- 结果摘要
  duration_ms INTEGER,              -- 耗时
  created_at DATETIME
)
```

### 3.5 防暴走机制

- Agent 只处理标记了 `agent_mention: true` 且 `target_agent` 匹配自己的消息
- Agent 回复时自动检测是否包含 @其他 Agent；如果包含，创建下一个任务记录
- 如果 Agent 回复没有 @任何人，流程结束
- 同一个 Agent 被多次 @时，按顺序排队，不并行
- 超时机制：一个任务超过 30 分钟没有进展，自动通知用户

### 3.6 Agent CLI 封装

每个 Agent 需要一个 CLI 封装，让后端可以调用：

```bash
# Claude Code（已有）
claude -p "任务描述" --project /path/to/project

# Codex（需要封装）
codex -m "任务描述" --project /path/to/project

# Hermes（需要封装）
hermes audit --path /path/to/project --scope "changed_files"
```

V1 可以先做**任务队列模式**：后端把任务写进 `agent_tasks` 表，Agent 轮询自己的待办任务，取到后干活，干完回填。

---

## 4. 实现步骤（建议顺序）

### Phase 1：基础设施（1-2 天）

```
1. 建 agent_tasks 和 agent_task_logs 表
2. 实现 agentBridge.js 调度器（任务队列模式）
3. 实现 @mention 路由和消息检测
4. 简单的 CLI 封装（后端 spawn 子进程调 Claude/Codex/Hermes）
```

### Phase 2：任务面板（1 天）

```
5. 聊天页右侧任务面板 UI
6. 任务状态实时更新
7. 交接记录时间线展示
```

### Phase 3：闭环测试（1 天）

```
8. 端到端跑通：@Codex → Codex做 → @Claude → Claude做 → @Hermes → 审计
9. 多任务排队和并发控制
10. 超时和异常处理
```

### Phase 4：打磨（1 天）

```
11. 额度控制（避免 AI 互相@消耗过多额度）
12. 权限（只有管理员能 @AI 干活）
13. 任务撤回 / 重新分配
14. 通知（任务完成时通知用户）
```

---

## 5. 风险和注意事项

| 风险 | 说明 | 缓解措施 |
|------|------|---------|
| 额度消耗 | 三个 AI 轮流调用可能快速消耗 API 额度 | 每次调用前确认、限制每日调用次数、@才触发 |
| 上下文丢失 | Agent 之间传递的上下文可能不完整 | 用 `context_data` JSON 字段结构化传递 |
| 任务卡死 | Agent 没有响应或任务超时 | 30 分钟超时通知、手动重新分配 |
| 并发冲突 | 多个 Agent 同时改同一文件 | 每次只一个 Agent 工作、Git 分支隔离 |
| 安全问题 | Agent 执行的代码可能引入漏洞 | Hermes 终审机制保留、所有写入操作审计 |

---

## 6. 相关资源

- `handoff/2026-06-18-database-framework-api-v1.md` — 数据库分层和事实服务
- `backend/src/ai/toolRegistry.js` — AI 工具注册表
- `frontend-new/src/views/chat/ChatIndex.vue` — 聊天页面
- `backend/src/routes/chat.js` — 聊天后端
- `CLAUDE.md` — 项目协作规则
- `AGENTS.md` — 多 Agent 协作硬规则

---

## 7. 版本记录

| 版本 | 日期 | 说明 |
|------|------|------|
| V1 | 2026-06-21 | 初始计划，保留待开干 |
| V1.1 | 2026-06-21 | Hermes 审计建议补充 |

---

## 8. Hermes 审计建议（2026-06-21）

### 8.1 CLI spawn 子进程方案需重新考虑

**当前计划**：后端 spawn claude/codex/hermes CLI

**问题**：
- Node.js `child_process` 有超时、内存、并发限制
- CLI 进程崩溃后后端不知道结果
- 多个 Agent 并行 spawn 会吃光服务器资源
- 生产环境不适合跑长时间 CLI 进程

**建议 V1 改为**：
- Agent 不在服务器上执行代码
- Agent 只做"分析 + 回复"，写代码的任务仍然由用户手动触发 Codex/Claude CLI
- 群聊里 Agent 的角色是"任务分解 + 交接记录"，不是"自动执行代码"

### 8.2 "AI 干活"和"AI 聊天"要分开

**当前计划**：@Claude 实现代码 → Claude 在群里回复并写代码

**问题**：
- 群聊消息是实时的，代码执行是长时间的（10-30 分钟）
- 用户在群里干等 30 分钟看 Claude 回复，体验差

**建议**：
- 群聊里 Agent 只做"任务分解 + 状态更新"
- 真正的代码执行走现有的 Codex/Claude CLI
- Agent 回复格式示例：`任务已分配给 Codex，预计 15 分钟完成。你可以开 Codex 终端查看进度。`

### 8.3 任务表建议补充字段

```sql
ALTER TABLE agent_tasks ADD COLUMN timeout_at DATETIME;        -- 超时时间（不要硬编码 30 分钟）
ALTER TABLE agent_tasks ADD COLUMN priority TEXT DEFAULT 'normal'; -- normal / urgent
ALTER TABLE agent_tasks ADD COLUMN parent_task_id INTEGER DEFAULT 0; -- 支持子任务
ALTER TABLE agent_tasks ADD COLUMN result_artifact TEXT DEFAULT '';  -- 结果产物路径
ALTER TABLE agent_tasks ADD COLUMN error_message TEXT DEFAULT '';    -- 失败原因
```

### 8.4 @mention 检测需要更严格的解析

**当前计划**：检测 `@Claude` / `@Codex` / `@Hermes` 关键词

**问题**：用户可能说"上次 @Claude 做的那个功能有 bug"，这不是要触发 Claude，只是引用。

**建议（三选一）**：
- 只有消息开头的 @ 才触发
- 用专门的触发语法：`/codex 做XXX`
- 在输入框用 mention 组件（类似现在的 @AI），前端发送时带结构化标记

### 8.5 安全审计需要前移

**当前计划**：Hermes 在最后做终审

**问题**：如果 Codex 写的代码有安全漏洞，Claude 基于有漏洞的代码继续开发，最后 Hermes 审出来要全部返工。

**建议**：
- 关键节点（涉及权限、金额、数据库）先让 Hermes 审
- 或者 Codex 写完后自动触发 Hermes 快速扫描，通过了再 @Claude

### 8.6 额度控制需要更精细

**当前计划**：限制每日调用次数

**问题**：一次复杂任务可能消耗大量 token，每日次数限制不等于额度限制。

**建议**：
- 按 token 估算费用，设置每日预算上限
- 调用前预估 token 数，超出预算时提示用户
- 记录每次调用的 token 消耗到 `ai_audit_logs`

### 8.7 Phase 1 建议拆分

当前 Phase 1 包含：建表 + 调度器 + @路由 + CLI 封装，太重。

**建议拆为**：

**Phase 1a（0.5 天）**：仅 @mention 路由
- 消息中检测 @Agent
- 在 `ai_audit_logs` 记录
- Agent 回复一条确认消息（不执行代码）

**Phase 1b（1 天）**：任务队列
- 建 `agent_tasks` 表
- Agent 回复时创建任务记录
- 任务状态更新通知

**Phase 1c（1 天）**：Agent 执行
- 接入 Claude/Codex CLI
- 结果回填

### 8.8 缺少回滚机制

**问题**：Agent 执行的代码导致系统异常时，没有自动回滚方案。

**建议**：
- 每次 Agent 执行前自动 `git stash` 或创建分支
- 提供 `/abort` 命令终止当前任务
- 任务失败时自动回退到执行前的 git 状态

### 8.9 总结

**核心建议**：V1 不要让 Agent 自动写代码。先做"任务分解 + 交接记录"的群聊协作，代码执行仍然由用户手动触发 Codex/Claude。这样风险最低，也最符合 AGENTS.md 的"每次只能一个 AI 工作"原则。
