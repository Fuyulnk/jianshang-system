# 简尚系统开发交接

这个文件用于 Codex 和 Claude 交替开发时保持上下文一致。每次接手前先读本文件和 `CLAUDE.md`，结束后补充本次交接记录。

## 协作约定

- 每次只让一个 Agent 工作，避免并发改同一批文件。
- 开始前先运行 `git status --short`，确认当前未提交改动。
- 只修改本次任务相关文件，不做无关重构。
- 不要回滚、删除、覆盖自己不确定来源的改动。
- 当前有效前端是 `frontend-new/`，不要改旧前端 `frontend/`。
- 后端使用 ESM、Fastify、better-sqlite3；数据库操作遵循现有同步 API 风格。
- 敏感操作和增删改接口需要按项目权限规则处理。
- 结束时记录：任务、修改文件、验证方式、遗留问题。

## 当前项目要点

- 前端：`frontend-new/`
- 后端：`backend/`
- 后端入口：`backend/src/index.js`
- 后端路由：`backend/src/routes/`
- 前端路由：`frontend-new/src/router/index.js`
- 布局入口：`frontend-new/src/layouts/MainLayout.vue`
- 项目规范：`CLAUDE.md`

## 前端包体积提醒

- 当前 `npm run build` 会出现 Vite chunk size 警告，主 JS 包约 1.1MB（gzip 后约 360KB）。
- 这不是当前功能错误，系统可以正常运行；但后续会做成 App，过大的首屏包会影响冷启动、JS 解析时间、内存占用和更新体积。
- 后续新增页面时优先使用路由懒加载，不要继续把重页面全部静态 import 到首屏包。
- 建议近期整理 `frontend-new/src/router/index.js`：
  - 登录页和主系统分开加载。
  - `SystemSettings.vue`、`FinanceOverview.vue`、`ProjectDetail.vue`、`EmployeeDashboard.vue` 等非首屏页面改成 `() => import(...)`。
  - 系统设置里的 AI 权限、用户管理等大块功能后续可拆成子组件并按 tab 延迟加载。
- 现阶段不用为了这个警告做激进优化；功能稳定后安排一次“前端加载结构整理”即可。

## 当前 Git 状态快照

记录时间：2026-05-18

当时工作树不是 clean 状态，包含以下已跟踪修改：

```text
 M backend/node_modules/.package-lock.json
 M backend/package-lock.json
 M backend/package.json
 M backend/src/index.js
```

当时还存在以下未跟踪文件/目录：

```text
?? .claude/
?? .gitignore
?? CLAUDE.md
?? backend/src/db/
?? backend/src/middleware/
?? backend/src/migrate_projects.js
?? backend/src/routes/
?? frontend-new/
?? frontend/
?? outputs/
```

注意：这些改动可能是用户或其他 Agent 的已有成果。除非用户明确要求，不要清理或回滚。

## 交接记录

### 2026-05-29 Codex Git 基线整理

- 任务：把长期脏工作树整理成可交接的 Git 基线，避免 Codex / Claude 后续互相踩未知改动。
- 已完成：
  - `backend/node_modules/` 已从 Git 索引移除，但本地目录仍保留；后续依赖只通过 `backend/package-lock.json` 还原。
  - `.gitignore` 补充忽略 `.claude/`、旧前端 `frontend/`、临时输出 `outputs/`、误放的 `backend/src/public/` 上传头像目录。
  - 正式纳入当前业务代码、`frontend-new/`、`backend/src/`、`CLAUDE.md`、`HANDOFF.md` 和 `handoff/` 交接文档。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/ai.js`
  - `node --check backend/src/routes/auth.js`
  - `node --check backend/src/routes/users.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
- 注意事项：
  - 不要把 `.env`、数据库、`dist/`、`backend/public/`、上传头像、`node_modules/` 加入 Git。
  - `frontend/` 和 `outputs/` 只是被忽略，没有删除；如需彻底归档/清理，单独确认后再做。

### 2026-05-29 Codex AI 安全底座第一阶段落地

- 任务：按用户确认的方向，先落地 AI 权限/隔离/审计安全底座的第一阶段。
- 已完成：
  - `backend/src/middleware/auth.js` — 认证中间件接入数据库，所有请求会刷新当前用户最新 `role / role_version / employee_id`；带旧 `roleVersion` 的 token 在角色版本变化后会被拒绝并提示重新登录。
  - `backend/src/index.js` — 迁移 `users.role_version`、`users.employee_id`、`chat_history.user_id`；创建 `ai_audit_logs`；为聊天历史和工程归属字段补索引；旧聊天历史回填到 `fuyulnk` 名下；Socket.io 登录也使用最新用户身份。
  - `backend/src/routes/auth.js` — 登录 token 写入 `roleVersion / employeeId`；`/api/me` 改为走统一认证中间件，返回最新角色和员工绑定信息。
  - `backend/src/routes/users.js` — 创建/分配角色时校验角色必须存在；分配角色后递增 `role_version`；入职向导不再允许员工自己改岗位，岗位必须由超级管理员分配。
  - `frontend-new/src/components/OnboardingWizard.vue` — 移除员工自选岗位步骤，只保留个人资料和 AI 偏好；页面文案提示岗位/权限由超级管理员分配。
  - `backend/src/routes/ai.js` — `chat_history` 按 `user_id` 保存和读取；`get_projects` 工具按当前用户角色和项目归属过滤，普通员工只能查自己创建/负责/施工负责的项目；AI 模型参数从 `system_settings` 实时读取；新增 AI 调用审计写入 `ai_audit_logs`；加入较宽松的聊天限流。
  - `backend/src/routes/settings.js`、`backend/src/index.js` 群聊 AI — 测试 AI 和群聊 AI 也改为读取数据库中的模型参数，`AI_API_KEY` 仍然只读 `.env`。
  - `backend/src/db/init.js`、`backend/src/db/seed.js` — 新库初始化时同步包含 `role_version / employee_id / chat_history.user_id / ai_audit_logs`。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/middleware/auth.js`
  - `node --check backend/src/routes/auth.js`
  - `node --check backend/src/routes/users.js`
  - `node --check backend/src/routes/ai.js`
  - `node --check backend/src/routes/settings.js`
  - `node --check backend/src/db/init.js && node --check backend/src/db/seed.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 本地用 `PORT=3011 npm start` 验证迁移成功；`/health` 正常；登录 `fuyulnk` 返回 `role=super_admin`、`role_version=1`。
  - 本地临时把 `fuyulnk.role_version` 递增后，用旧 token 调 `/api/me` 返回 401：“用户权限已变更，请重新登录”；随后已恢复 `role_version=1`。
  - `/api/chat/history` 现在按当前用户返回；旧历史已回填到 `fuyulnk`。
  - 已部署正式服务器；部署前备份：`/root/jianshang-system-backup-20260529-131431.tgz`。
  - 线上验证：`/health` 正常；`pm2 list` 显示 `jianshang-web` online；`fuyulnk|super_admin|1|0`；`ai_audit_logs` 已创建；线上旧 `chat_history` 16 条已回填到 `user_id=1`。
- 注意事项：
  - 本次还没有做前端“员工档案绑定 user”的管理界面；`users.employee_id` 已有字段，后续要把 `employees.id / employee_code(JS-...)` 和系统账号绑定起来。
  - 本次还没有做“权限申请/审批”界面；后续用 `ai_user_tools` 做个人覆盖权限。
  - 写入类 AI 工具只是进入审计和限流框架，尚未实现后端确认表 `ai_action_confirmations`。
  - 直接业务 API（交易、产品、员工等）仍有部分“登录即可读/写”的历史权限问题，后续必须按同一权限模型收紧，否则员工可绕过 AI 直接调 API。
  - 本地启动时知识库脚本会尝试监听 `18790`；如果已有知识库服务占用，会打印 `Address already in use`，不影响后端主服务。

## 下一步建议优先级

### P0：AI 权限、员工隔离和审计安全底座

- 聊天历史必须按员工/用户隔离：
  - `chat_history` 增加 `user_id`，保存每条 user/assistant/system 消息的归属。
  - `/api/chat/history` 只能返回当前登录用户自己的会话；`super_admin` 后续可另做审计入口查看全量。
  - `session_id` 必须和 `user_id` 共同校验，避免员工拿到别人的 `session_id` 后读取或续写会话。
- 员工身份关系要打通：
  - 用户注册后先是系统账号，再由超级管理员分配岗位/角色。
  - `users` 需要绑定 `employees`，可用现有 `employees.employee_code`（`JS-...`）作为员工档案编号，但系统内部建议用 `employee_id` 外键关联，避免只靠字符串。
  - 新员工没有分配岗位和员工档案前，默认只允许基础登录、完成入职资料、看自己的空工作台，不开放业务数据查询。
- AI 工具权限要分两层：
  - 岗位默认权限：`ai_role_tools` 决定某职位默认能调用哪些工具，例如普通员工可查自己的工程，仓管可查库存/出入库，财务可查财务汇总。
  - 个人临时/额外授权：`ai_user_tools` 覆盖岗位默认值；员工需要新权限时走申请，超级管理员批准后写入个人覆盖权限。
- `get_projects` 必须落地数据范围过滤：
  - 即使某岗位拥有 `get_projects`，也不能默认查全部工程。
  - 普通员工只能查 `created_by / manager_user_id / assignee_user_id` 与自己相关的项目。
  - 管理员、超级管理员、财务、仓管是否能查全部项目，要按岗位职责细分；仓管可看与材料出入库相关字段，财务可看结算相关字段。
  - AI 工具执行器不能绕过 `projects` 路由的权限逻辑，最好复用同一套项目查询/过滤函数。
- 创建/修改/删除类 AI 工具要做硬限制：
  - 短期先关闭普通员工所有写入类工具，只允许查询。
  - 写入类工具按岗位开放，例如财务可创建交易、仓管可创建出入库、管理员可创建/推进工程。
  - “无条件调用相应 API”可以作为岗位能力，但仍建议对高风险动作保留后端硬校验：金额、删除、状态跨阶段推进、客户确认、结算完成等必须有二次确认或审批记录。
  - 二次确认不能只靠提示词，后端要有 `pending_action` 或 `ai_action_confirmations` 之类的确认表，确认后才真正执行。
- AI 审计必须记录：
  - 谁调用：`user_id / employee_id / role`。
  - 调了什么：工具名、参数摘要、结果摘要、是否写入。
  - 查了哪些数据范围：例如项目 ID、账户 ID、员工 ID，不直接记录完整敏感内容。
  - 成本信息：输入 token、输出 token、模型、耗时、是否失败。
  - 建议新增 `ai_audit_logs` 表，后续在超级管理员后台做筛选查看。
- 频率和成本限制先给默认档，后续按真实使用微调：
  - 限流先开大一点，避免影响真实录入；尤其财务可能一次性粘贴一大段收支让 AI 批量整理/录入。
  - 普通员工：每分钟 20 次、每天 300 次、单次输出上限 1500-2000 tokens。
  - 仓管/财务/项目管理：每分钟 40 次、每天 800 次、单次输出上限 3000-4000 tokens。
  - 超级管理员：每分钟 80 次、每天 2000 次，允许更高输出。
  - 写入类工具不要按极低频率拦截；建议先按每分钟 20 次、每天 300 次给财务/仓管/项目管理开放，同时全部进审计。
  - 对批量录入类工具单独设计 `batch_id` 和明细审计，不要把“一次批量录入 20 条流水”算成 20 次聊天限流。
  - 真正需要限制的是异常行为：短时间重复失败、非授权岗位尝试写入、删除/大额/跨阶段推进等高风险动作。
- 用户改岗位/角色后权限必须实时同步：
  - 不能只相信 JWT 里的旧 `role`。
  - 方案一：缩短 token 有效期，并在关键接口实时从数据库读取用户最新角色。
  - 方案二：在 JWT 中加入 `role_version`，用户角色变化时递增版本，旧 token 立即失效。
  - AI、权限、财务、工程等敏感接口优先实时查库或校验 `role_version`。
- AI 设置页和运行配置要统一：
  - `AI_API_KEY` 仍然放 `.env`，不要在前端明文展示。
  - `ai_model / ai_temperature / ai_max_tokens` 应从数据库 `system_settings` 实时读取，设置页保存后立即生效。
  - 暂不把设置页和 `.env` 做双向同步；`.env` 只作为服务器环境配置文件，主要保存密钥、端口等不应该暴露给前端的配置。
  - 如果以后需要在页面更新密钥，也要做成“只写入、不回显”：前端只能看到“已配置/未配置”，不能读取完整密钥。
- 知识库服务要梳理清楚：
  - 当前简尚系统把 `127.0.0.1:18790` 当知识库搜索服务使用，代码指向 `~/.openclaw/workspace/scripts/search-server.py`。
  - OpenClaw 网关端口不要和知识库端口混用；当前本机 OpenClaw 网关配置查到是 `18789`。
  - 后续要把知识库服务做成可启动、可健康检查、可部署的独立服务，线上 PM2/systemd 持久运行。

### 2026-05-29 Codex AI 权限与员工隔离设计讨论

- 用户明确方向：
  - 按员工 ID/员工档案隔离是必做项；员工编号已有 `JS-...` 形式。
  - `get_projects` 不应只是“有无权限”，还必须实时按该员工负责/参与项目过滤。
  - 新账号注册后应由超级管理员分配职位/岗位，岗位决定默认 AI 工具权限。
  - 员工想获得岗位外的新 AI 权限，后续应走申请/授权，由超级管理员发放个人覆盖权限。
  - 写入类 AI 能力可按职位开放；普通员工默认只能查询，不能让 AI 代创建/修改业务数据。
  - AI 审计、频率限制、token 输出限制需要设计默认值，后续按真实使用微调。
  - 用户改角色/职位后，旧 token 携带旧角色的问题必须解决，敏感接口不能继续按旧角色放行。
- 已沉淀到上方 `P0：AI 权限、员工隔离和审计安全底座`，后续接手请优先按该清单拆任务实现。
- 当前判断：
  - 角色工具表 `ai_role_tools` 和个人覆盖表 `ai_user_tools` 已具备雏形，但缺数据范围过滤、用户历史隔离、审计日志、限流和角色变更即时失效。
  - `AI_API_KEY` 建议继续放 `.env`；模型、温度、输出上限应改为从 `system_settings` 读取，设置页保存后立即生效。
  - `127.0.0.1:18790` 在简尚系统代码中是知识库搜索服务端口，不应与 OpenClaw 网关混淆；当前本机 OpenClaw 网关配置查到为 `18789`。

### P0：先做线上账号与权限稳定性检查

- 用 `fuyulnk` 退出重登，确认前端显示超级管理员，且能进入用户管理、角色权限、AI 权限、系统设置。
- 用普通员工/仓管/财务各建一个测试账号，确认菜单和接口权限一致，不要只看前端菜单。
- 给 `/api/users/:id/role` 增加角色合法性校验：只能写入 `roles` 表存在的角色，避免传入脏角色字符串。
- 检查初始化/迁移逻辑顺序：空库首次启动时要能完整建出 `users / roles / role_permissions / projects` 等基础表，避免服务器新环境出现 `no such table`。

### P1：工程订单试运行闭环

- 用真实工单资料跑一条完整工程流程：客户信息确认、工勘、开工条件、派工、交底、材料出库、施工、检查、验收、回库、结算、售后。
- 补“工程订单附件/凭证”能力：工勘交底单、成本交底单、施工照片、验收照片、售后单等文件先能挂到项目下。
- 补材料出库/回库明细，不要只改项目状态；至少记录材料、数量、经手人、时间。
- 补客户确认/内部验收记录：先做轻量字段或日志，不急着做签名板。
- 把 `users` 和 `employees` 的关系定下来，当前工程负责人/施工负责人绑定的是系统用户，不是员工档案。

### P1：AI 浮窗第二阶段

- 把当前“置顶小页面”继续升级成真正工作面板：可移动面板位置、会话列表/任务状态、最近工程/客户上下文入口。
- 继续压掉拖动/缩放时的选择副作用：检查 emoji、标题、底层页面文本是否还可能被选中。
- 加一个“停靠/收起”形态：右侧贴边、底部小条、桌宠本体三种状态，避免遮挡业务页面。
- 移动端只保留底部抽屉，不做自由拖拽缩放。

### P2：前端包体积和 App 化准备

- 先做路由懒加载，降低首屏 JS：`SystemSettings.vue`、`FinanceOverview.vue`、`ProjectDetail.vue`、`EmployeeDashboard.vue` 等页面改为动态 import。
- 暂时不要为 Vite chunk 警告做激进拆包；先保证业务流程可用。
- 等 App 方向明确后，再评估离线缓存、更新策略、首屏加载动画和移动端导航。

### P2：部署流程沉淀

- 把当前正式部署步骤整理成脚本，例如 `scripts/deploy.sh`：
  - `frontend-new` 构建
  - 同步 `dist` 到 `backend/public`
  - rsync 到 `root@8.135.8.37:/root/jianshang-system/backend`
  - 排除 `.env`、`public/avatars`、`node_modules`、`data/`
  - 服务器重启 `pm2 restart jianshang-web`
  - 自动 curl `/health`
- 部署前自动备份线上目录，并把备份文件名输出到终端。
- 在 `CLAUDE.md` 里同步“正式服务器只用 root 路径，不用 admin 路径”。

### 2026-05-28 Codex 线上超级管理员权限修复

- 任务：用户反馈线上登录后 `fuyulnk` 从超级管理员变成管理员，权限减少。
- 原因：线上数据库中 `users.username = 'fuyulnk'` 的 `role` 实际为 `admin`；旧 token 也会继续携带 `admin` 角色，导致 `/api/users`、`/api/roles`、`/api/role-permissions` 返回 403。
- 本次操作：
  - 已在正式服务器数据库 `/root/fuyulnk/jianshang.db` 中把 `fuyulnk` 更新为 `super_admin`。
  - `backend/src/index.js` 启动时校正 `fuyulnk` 为 `super_admin`，防止后续启动后仍保持错误角色。
  - `backend/src/routes/users.js` 禁止把 `fuyulnk` 降权或删除。
  - `backend/src/db/init.js`、`backend/src/db/seed.js` 默认所有者账号改为 `super_admin`。
  - `frontend-new/src/views/system/SystemSettings.vue`、`frontend-new/src/views/users/UserList.vue` 隐藏 `fuyulnk` 的分配角色/删除入口。
  - 已重新构建前端、同步 `backend/public/` 并推送正式服务器，重启 `pm2` 进程 `jianshang-web`。
- 验证：
  - 服务器查询：`SELECT id, username, role FROM users WHERE username = 'fuyulnk';` 返回 `1|fuyulnk|super_admin`。
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/users.js`
  - `node --check backend/src/db/init.js`
  - `node --check backend/src/db/seed.js`
  - `npx vite build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - `http://8.135.8.37:3000/health` 返回正常。
- 注意事项：
  - 用户如果已经以 `admin` token 登录，需要退出登录后重新登录；旧 token 里仍然带 `admin`，不会自动升级。

### 2026-05-28 Codex 服务器部署交接

- 任务：按 Claude 的正式发布路径把当前后端和 `frontend-new` 构建产物推送到服务器。
- 正式服务器路径：
  - SSH：`root@8.135.8.37`
  - 项目目录：`/root/jianshang-system`
  - 后端目录：`/root/jianshang-system/backend`
  - PM2 进程：`jianshang-web`
- 本次操作：
  - 本地执行 `npx vite build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）。
  - 将 `frontend-new/dist/` 同步到 `backend/public/`。
  - 部署前在服务器创建备份：`/root/jianshang-system-backup-20260528-171224.tgz`。
  - 使用 `rsync` 推送 `backend/` 到正式后端目录；为保护线上配置和上传文件，额外排除了 `.env`、`.env.*`、`public/avatars`、`node_modules`、`data/`。
  - 在服务器执行 `npm install --prefix backend`，随后 `pm2 restart jianshang-web`、`pm2 save`。
- 验证：
  - `http://8.135.8.37:3000/health` 返回 `{"status":"ok","message":"简尚系统运行中",...}`。
  - 服务器本机 `curl http://127.0.0.1:3000/` 返回前端 HTML，`HEAD /` 返回 200。
  - `pm2 list` 显示 `jianshang-web` online。
- 注意事项：
  - 不要再使用仓库旧 remote 指向的 `admin@8.135.8.37:/home/admin/jianshang-system` 作为正式部署路径；那里不是当前线上服务。
  - 本次曾按旧线索误在 `admin` 账号下启动过 `jianshang-system`，已执行 `pm2 delete jianshang-system` 清理，避免端口冲突。
  - `npm install` 报告 11 个依赖漏洞（4 moderate、7 high），本次未执行 `npm audit fix`，避免引入破坏性依赖升级。

### 2026-05-28 Codex 工程订单试运行底座

- 任务：把工程订单从“看板原型”推进到可试运行底座，优先补权限、分配和流程校验。
- 修改文件：
  - `backend/src/index.js` — 为 `projects` 增加 `manager_user_id`、`assignee_user_id` 迁移字段。
  - `backend/src/migrate_projects.js` — 新建项目表结构同步增加负责人/施工负责人字段。
  - `backend/src/routes/projects.js` — 增加可分配人员接口；工程订单列表/详情按角色和分配过滤；新增/编辑/删除/状态推进加后端权限；状态推进只能按流程顺序，并对工勘、派工、交底、开工、施工备注、完工、结算金额做关键必填校验。
  - `backend/src/routes/employee-dashboard.js` — 普通员工只看自己创建/负责/施工负责的项目；员工待办按“待开工/施工中/待检查验收”分组。
  - `frontend-new/src/views/projects/ProjectList.vue` — 列表显示负责人/施工负责人；新建项目可选择负责人和施工负责人；非管理角色不显示新建/删除入口。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 顶部显示负责人/施工负责人；编辑弹窗支持分配人员；施工负责人可进入“更新施工记录”，后台只接受施工相关字段。
  - `frontend-new/src/views/EmployeeDashboard.vue` — 待办卡片显示施工负责人。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/projects.js`
  - `node --check backend/src/routes/employee-dashboard.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 已重启后端 `npm start`，数据库确认存在 `manager_user_id` / `assignee_user_id`。
  - 创建了样例工程订单：`系统试运行样例项目`，用于页面验证和给用户看成果。
  - API 验证：在未填写工勘记录/日期时推进 `info_confirmed -> survey_done` 被拒绝，返回“请先补全：工勘记录或工勘日期”。
- 注意事项：
  - 后端当前用 `npm start` 常驻运行，`npm run dev` 的 `node --watch` 在本机报 `EMFILE: too many open files, watch`。
  - 这轮还没有做照片/附件、材料出库明细、客户签字、面积核算和财务流水关联；这些应作为下一阶段交付凭证模块。
  - 当前分配先绑定系统用户，不是员工档案；后续建议把 `users` 与 `employees` 建正式关联。

### 2026-05-28 Codex 视觉体检与 AI 浮窗交互修补

- 任务：按真实页面观感巡查核心页面，并优化 AI 浮窗第一阶段交互粗糙点。
- 修改文件：
  - `frontend-new/src/components/AiPetWidget.vue` — 拖动和缩放时清理选区并给 `body` 加禁选状态，避免选中浮窗 emoji 或底层页面文字；标题栏/按钮/缩放手柄禁用文本选择；右键菜单位置 clamp 到视口内；面板质感调整为更像工作面板。
  - `frontend-new/src/views/transactions/TransactionList.vue` — 交易流水折叠改用 `el-collapse-transition` 做高度过渡；修复暗色模式筛选栏、账户组 hover 露白。
  - `frontend-new/src/styles/element-overrides.css` — 补暗色模式下 Element Plus select/date wrapper 的背景和文字颜色。
- 验证：
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - `node --check backend/src/routes/users.js`
  - `node --check backend/src/routes/finance.js`
  - Chrome 视觉检查：控制台、交易流水、财务总览、系统设置；AI 浮窗打开后未见明显重叠破版，交易流水暗色露白已修。
- 注意事项：
  - AI 浮窗当前仍是“围绕小图标展开的浮动工作面板”，已修第一阶段交互毛刺；后续如果继续深化，可以考虑把窗口移动/停靠、会话入口、任务状态做成更完整的助理工作区。
  - `handoff/animation-tasks.md` 中“交易流水折叠动画”已处理。

### 2026-05-28 Codex

- 任务：修补 Claude 近两天新增功能中的权限和流程问题。
- 修改文件：
  - `frontend-new/src/components/OnboardingWizard.vue` — 移除“管理员”岗位选择，完成配置后跳到完成页。
  - `backend/src/routes/users.js` — 入职向导只允许 `finance / warehouse / employee`，非法角色在写入前拒绝。
  - `frontend-new/src/views/system/SystemSettings.vue` — 补 `computed` import，避免系统设置页运行时报错。
  - `backend/src/routes/finance.js` — 财务接口限制为 `super_admin / admin / finance`；修正 `status != cancelled OR status IS NULL` 的 SQL 括号。
  - `frontend-new/src/layouts/MainLayout.vue` — 财务总览菜单按权限显示。
  - `CLAUDE.md` — 同步当前状态和入职/财务权限规则。
- 验证：
  - `node --check backend/src/routes/finance.js`
  - `node --check backend/src/routes/users.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
- 注意事项：
  - 本次未启动后端做真实接口登录联调。
  - `handoff/animation-tasks.md` 里还有交易流水折叠动画任务未处理。

### 2026-05-23 Codex

- 任务：实现 AI 桌宠聊天窗口可缩放。
- 修改文件：
  - `frontend-new/src/components/AiPetWidget.vue` — 桌面端聊天窗口支持右下角拖拽缩放，尺寸保存到 `localStorage.ai-pet-size`；新增还原尺寸按钮和右键菜单项；缩放时禁用文字选择；窗口定位改为 clamp 到视口内；窄屏下改为底部抽屉并隐藏缩放手柄。
- 验证：
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 尝试启动 Vite dev server 成功，地址 `http://127.0.0.1:5173/`；已停止。
- 注意事项：
  - 本地 Node 环境没有 Playwright，且没有可用 Browser 插件；未做自动截图视觉验证。
  - 没有修改后端接口。

### 2026-05-23 Codex

- 任务：修补 Claude 今日实现中的入职向导资料落库、角色权限绕过、AI 偏好即时生效等小问题。
- 修改文件：
  - `backend/src/index.js` — 为用户表增加入职资料和 AI 偏好字段迁移；Socket.io 认证改用 `verifyToken()`。
  - `backend/src/routes/auth.js` — 登录和 `/api/me` 返回入职资料/AI 偏好；`/api/me` 改用 `verifyToken()` 兼容 JWT 轮换。
  - `backend/src/middleware/auth.js` — 清理未用 import。
  - `backend/src/routes/users.js` — `/api/profile/onboarding` 保存资料和 AI 偏好；移除普通用户自改角色接口。
  - `frontend-new/src/components/OnboardingWizard.vue` — 完成向导时提交资料/偏好，修复欢迎页底部空按钮。
  - `frontend-new/src/components/AiPetWidget.vue` — 支持读取/响应 AI 名称和显示状态偏好。
  - `frontend-new/src/layouts/MainLayout.vue` — 获取用户信息后同步 AI 偏好到浮窗组件。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/middleware/auth.js`
  - `node --check backend/src/routes/users.js`
  - `node --check backend/src/routes/auth.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
- 注意事项：
  - 前端构建会刷新 `frontend-new/dist/` 中的产物；该目录当前仍处于未跟踪状态。
  - 本次没有启动后端服务做真实登录联调。

### 2026-05-23 Claude Code

- 任务：实施四大功能模块 — AI 工具权限、入职向导、设置页整合、页面动画
- 修改文件：
  - `backend/src/index.js` — 添加 ai_role_tools/ai_user_tools 建表 + seed 数据 + onboarding_done 迁移
  - `backend/src/routes/ai-permissions.js` — 新建，AI 工具权限管理 API（5 个端点）
  - `backend/src/routes/ai.js` — 工具过滤逻辑（getAllowedTools 函数）
  - `backend/src/routes/users.js` — 新增 PUT /api/profile/onboarding
  - `backend/src/routes/auth.js` — 登录返回 onboarding_done 字段
  - `backend/src/routes/chat.js` — 清理无用 import
  - `frontend-new/src/views/system/AiPermissions.vue` — 新建，AI 权限管理页面
  - `frontend-new/src/views/system/SystemSettings.vue` — 整合个人资料 tab（头像+改密码）
  - `frontend-new/src/components/OnboardingWizard.vue` — 新建，入职向导组件
  - `frontend-new/src/layouts/MainLayout.vue` — 集成向导 + AI 权限菜单 + 路由动画 CSS
  - `frontend-new/src/router/index.js` — 添加 AI 权限路由
  - `frontend-new/src/views/accounts/AccountList.vue` — 添加骨架屏
  - `frontend-new/vite.config.js` — 添加 /avatars 代理规则
  - `CLAUDE.md` — 更新当前状态
  - `HANDOFF.md` — 本次交接记录
- 修复过的问题：
  1. ai.js 登录验证用了硬编码密钥 → 改为 config.verifyToken
  2. 头像保存路径指向 src/public/ → 修正为 public/
  3. Vite 缺少 /avatars 代理 → 添加
  4. 入职向导不能选角色（用户要求角色只能管理员分配）→ 改为填基础信息
  5. 老用户每次登录弹向导 → app_config 迁移标记修复
- 验证方式：
  1. 用新账号登录 → 弹出向导（onboarding_done=0）
  2. 向导填姓名/手机号/部门 → 完成 → 不再弹出
  3. 回到登录 → 老账号登录 → 不弹向导（onboarding_done=1）
  4. 进入系统管理 → AI 权限 → 切换角色工具开关
  5. 用对应角色登录 → 问 AI 查数据 → 被禁工具返回无权限
  6. 系统设置 → 个人资料 → 上传头像/改密码
  7. 路由切换有平滑动画，列表页有骨架屏

### 2026-05-18 Codex

- 任务：读取项目结构，建立协作交接文件。
- 修改文件：`HANDOFF.md`
- 验证：已读取 `CLAUDE.md`、主要 package 配置、后端入口、权限/用户/角色路由、前端路由和主布局。
- 注意事项：
  - `CLAUDE.md` 写数据库位置是 `backend/data/jianshang.db`，但当前代码实际使用 `~/fuyulnk/jianshang.db`。
  - `backend/node_modules/.package-lock.json` 当前也处于 modified，不建议主动纳入功能改动。
