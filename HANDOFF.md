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

### 2026-06-02 Codex 小工程：本地启动、设置稳定、工程权限范围

- 任务：在大工程前先做几个低风险小工程，提高本地可用性和员工试用稳定性。
- 已完成：
  - `scripts/start-local.command` — 新增本地一键启动检查脚本；会检查后端 `3001`、前端 `5173`、知识库 `18790`，缺哪个就打开 Terminal 启动对应服务，最后打开 `http://127.0.0.1:5173/`。
  - `.gitignore` — 忽略 `tmp-home/`，避免临时空库自检目录污染工作树。
  - `frontend-new/src/views/system/SystemSettings.vue` — 系统设置改成固定工作区布局：二级左栏固定在工作区内，右侧内容独立滚动；切换 tab 时重置滚动；宽表保持内部横向滚动，减少切换抖动和背景色不一致。
  - `backend/src/utils/permissions.js` — 新增 `canAccessProjectRecord / isUserLinkedToProject`，把工程可见性抽成通用权限函数，基于 `role_permissions.data_scope` 判断。
  - `backend/src/routes/projects.js` — 工程列表、详情、编辑、推进、日志改用通用工程可见性；`projects` 数据范围为 `all` 才看全部，否则只看本人创建/负责/施工参与项目。
  - `backend/src/routes/files.js` — 工程附件复用同一套工程可见性，避免“看不到工程但能通过文件中心看到附件”的规则不一致。
- 验证：
  - `bash -n scripts/start-local.command`
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/projects.js`
  - `node --check backend/src/routes/files.js`
  - `node --check backend/src/utils/permissions.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 本地后端已重启到 `3001`，`/health` 正常。
- 注意事项：
  - 本次没有上传服务器。
  - 财务流水、员工档案、AI 工具结果还没有完整接入 `data_scope`，这是下一批小工程。
  - `scripts/start-local.command` 是本机开发启动辅助，不用于服务器部署。

### 2026-06-02 Codex 权限/隔离地基加固

- 任务：按“员工直接试用一天会暴露大量 bug”的担忧，先补最容易引发越权、误授权和不可追溯的底层能力，不做大范围重构。
- 已完成：
  - `backend/src/index.js` — `role_permissions` 增加 `data_scope`；启动时确保 `users / accounts / transactions / products / employees / chat_history` 基础表，以及 `private_workspaces / resource_access_grants / access_audit_logs` 表和索引存在；默认种子 `fuyulnk / 123456` 超级管理员；默认角色权限补数据范围：管理员类 `all`，财务/仓库/工程按业务模块和项目相关区分，普通员工默认 `self / project_related`。
  - `backend/src/utils/permissions.js` — 新增 `getModulePermission / getDataScope / canAccessPrivateResource / grantPrivateResourceAccess / logAccessAudit`，为后续“总监私有工作区”和员工隔离提供复用入口。
  - `backend/src/routes/roles.js` — 角色权限更新支持 `data_scope`；旧前端或旧请求未传 `data_scope` 时保留原值，避免误重置成全部数据。
  - `backend/src/routes/files.js` — 统一附件支持 `private_workspace` 归属；文件中心查询能搜索私有工作区名称；附件上传、下载、删除写入 `access_audit_logs`。
  - `frontend-new/src/views/system/RolePermissions.vue` — 角色权限页新增“数据范围”选择，超级管理员可直接查看/调整每个岗位、每个模块的数据范围。
  - `frontend-new/src/views/files/FileCenter.vue` — 文件中心识别“私有工作区”附件类型和关联对象。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/files.js`
  - `node --check backend/src/routes/roles.js`
  - `node --check backend/src/utils/permissions.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告，主 JS 约 1.21MB / gzip 约 379KB）
  - 使用临时 `HOME=/Users/fuyulnk./Projects/jianshang-system/tmp-home` 和空库启动后端，`/health` 正常，`fuyulnk / 123456` 登录成功；临时服务已停止。
- 注意事项：
  - 本次没有上传服务器。
  - 这是权限/隔离地基，不是完整终局：多数业务路由仍需要逐步使用 `getDataScope()` 做真实数据过滤，尤其 AI 工具、工程列表、财务流水、员工档案。
  - `private_workspaces` 目前只有表和权限工具，尚未做总监工作区页面、导入器和主动授权界面。
  - 后续建议补一个超级管理员可看的“访问日志/API统计”入口，把 `access_audit_logs` 和 AI 审计统一筛选展示。

### 2026-06-01 Codex 统一文件中心第一版 + AI 审计页

- 任务：按“明天来看结果”的节奏，先补真实使用前会卡住的文件上传/下载底座，并给超级管理员补 AI 审计入口。
- 已完成：
  - `backend/src/index.js` — 新增 `attachments` 统一附件表和索引；注册 `fileRoutes`；文件仍放 `backend/data/`，配合现有部署排除规则保护线上文件。
  - `backend/src/routes/files.js` — 新增统一附件接口：`GET /api/files`、`POST /api/files/upload`、`GET /api/files/:id/download`、`DELETE /api/files/:id`；文件不走 public，下载必须鉴权；第一版沿用 base64 JSON 上传，单文件限制 10MB。
  - `frontend-new/src/components/AttachmentPanel.vue` — 新增可复用附件面板，支持选择文件、拖拽加入待上传、确认上传、下载、删除。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 工程详情页接入“工程附件”。
  - `frontend-new/src/views/transactions/TransactionList.vue` — 每条交易流水增加“附件”入口，可上传/下载凭证附件。
  - `backend/src/routes/settings.js` — 新增 `/api/settings/ai-audit`，超级管理员/管理员可筛选查看 AI 审计记录；继续保留知识库重建入口。
  - `frontend-new/src/views/system/SystemSettings.vue` — 系统设置新增“AI 审计”tab，展示 24 小时请求数、工具调用、失败/风险、输出 tokens 和审计明细。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/files.js`
  - `node --check backend/src/routes/settings.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 本地 `PORT=3042 npm start` 后，用 `boss / 123456` 登录；实测工程附件上传、列表、软删除成功；`GET /api/settings/ai-audit` 返回成功。临时后端已停止。
- 注意事项：
  - 这次没有上传服务器。
  - 当前附件上传仍是 10MB base64 第一版；后续如果要支持月底大表、高清图片、合同扫描件，应升级为 multipart/分片上传。
  - `chat_files` 还没有并入 `attachments`，后续可以做一次迁移/兼容层，把群聊文件、工程附件、财务凭证统一到同一套文件中心。
  - 附件删除当前是软删除，实体文件暂不立即删除；后续可加定时清理已软删文件。

### 2026-06-02 Codex 文件中心入口和凭证上传体验修正

- 任务：按用户现场反馈，修正“工程附件位置太靠下、统一文件中心找不到、新建流水不能直接带附件、AI 审计命名不直观”。
- 已完成：
  - `backend/src/routes/files.js` — 新增 `GET /api/files/recent`，按当前用户权限返回最近附件，支持归属类型和关键词筛选。
  - `frontend-new/src/views/files/FileCenter.vue` — 新增“文件中心”页面，展示最近附件、归属对象、上传人、时间、大小，并支持打开关联对象、下载、删除。
  - `frontend-new/src/router/index.js`、`frontend-new/src/layouts/MainLayout.vue` — 左侧菜单新增“文件中心”入口，工程/财务/仓库/管理员等有相关模块权限的用户可见。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 工程附件从页面下方挪到当前工作单下方、阶段详情上方，减少编辑工程资料和上传附件之间的滚动距离。
  - `frontend-new/src/views/transactions/TransactionList.vue` — 新增交易弹窗增加“凭证附件”待上传区；保存流水成功后自动把待上传凭证挂到该流水。
  - `frontend-new/src/views/system/SystemSettings.vue` — “AI 审计”文案改为“API统计”。
- 验证：
  - `node --check backend/src/routes/files.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 本地后端已重启到 `PORT=3001`，`curl http://127.0.0.1:3001/health` 正常。
  - 2026-06-02 已部署服务器：上线前备份 `/root/jianshang-system-backup-20260602-103831.tgz`；rsync 排除 `.env / .env.* / data/ / public/avatars/ / node_modules`；`pm2 restart jianshang-web` 成功；线上 `/health`、`/`、`/assets/index-D5KSirzK.js`、`/jianshang-logo.jpeg` 返回正常；`/api/files/recent` 未登录返回 401，说明新路由已生效。
- 注意事项：
  - 文件中心当前是“最近附件”视图，后续可加文件预览、批量下载、按项目/客户/月份归档。

### 2026-06-02 Codex 控制台交易统计动态窗口修正

- 任务：修复控制台“今日交易”误把历史测试流水总数显示成今日交易的问题。
- 已完成：
  - `frontend-new/src/views/Dashboard.vue` — 控制台交易卡片改为动态窗口：当天有交易显示“今日交易”；当天没有但昨天有则显示“昨日交易”；否则显示“近7日交易”；近7日都没有则显示“近7日无交易”。
- 验证：
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 2026-06-02 已随文件中心体验修正一起部署服务器，备份同上：`/root/jianshang-system-backup-20260602-103831.tgz`。
- 注意事项：
  - 控制台交易统计仍依赖 `transactions.created_at`；如果后续给流水增加“业务发生日期”，控制台应优先按业务日期统计。

### 2026-05-31 Codex 群聊文件上传/拖拽上传

- 任务：给群聊补文件上传、拖拽上传和下载能力。
- 已完成：
  - `backend/src/index.js` — `messages` 表补 `message_type / file_id`；新增 `chat_files` 表；后端 `bodyLimit` 调到 20MB，配合 8MB 文件 base64 上传。
  - `backend/src/routes/chat.js` — 新增 `POST /api/conversations/:id/files`，群成员才能上传；文件保存到 `backend/data/chat_uploads/`，不走 public；新增 `GET /api/chat/files/:id/download`，会话成员才能下载；消息列表返回文件元信息。
  - `frontend-new/src/views/chat/ChatIndex.vue` — 群聊输入区新增“文件”按钮；消息区支持拖拽上传；文件消息显示为文件卡片，下载通过鉴权接口拿 blob。
- 2026-05-31 追加修正：
  - 文件按钮/拖拽现在只是加入“待发送”队列，不会立刻发出；待发送文件悬浮显示在输入框上方，可继续输入文字、继续添加多个文件，也可移除单个文件，最后点“发送”才真正上传。
  - 图片消息在聊天区内直接预览，仍保留下载原图按钮；普通文件继续显示文件卡片。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/chat.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 本地 `PORT=3036 npm start` 后，登录、上传 `codex-upload-test.txt` 到总群、再通过 `/api/chat/files/:id/download` 下载，返回 `hello world`；测试消息和文件已从本地库/本地上传目录清理。
- 注意事项：
  - 这是群聊文件的第一版，采用 base64 JSON 上传，没有新增 npm 依赖；单文件限制 8MB。
  - 后续统一文件中心时，应把 `chat_files` 和工程/财务/仓库附件合并或抽象到统一 `attachments` 表，支持更大的 multipart/分片上传、预览、附件归档和审计。
  - `backend/data/` 必须继续排除在 rsync 之外，避免线上聊天文件被部署删除。

### 2026-05-31 Codex 财务导出与分析上线

- 任务：补财务下载能力，并参考现有飞书 Base 调整导出表格式。
- 已完成：
  - `backend/src/routes/transactions.js` — 新增 `/api/transactions/export`，默认导出 Excel 可打开的格式化 `.xls`；表头参考飞书 `收支明细表`，包含 `日期 / 账户 / 金额 / 分类 / 凭证 / 对方 / 事由 / 收支类型 / 录入人 / 备注 / 状态 / 账户类型`；`format=csv` 保留纯 CSV。
  - `backend/src/routes/finance.js` — 新增 `/api/finance/analysis`，输出本月净现金流、环比、支出排行、高额支出、疑似重复流水、负余额账户和系统提醒。
  - `frontend-new/src/views/transactions/TransactionList.vue` — 增加“导出当前筛选”。
  - `frontend-new/src/views/finance/FinanceOverview.vue` — 增加“下载流水”和实时财务分析卡片。
  - `HANDOFF.md` — 记录文件中心、财务月报、飞书 Base 字段参考和后续 `借款核销 / 报销审批 / 资金总览` 方向。
- 验证：
  - `node --check backend/src/routes/transactions.js`
  - `node --check backend/src/routes/finance.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 已部署正式服务器：先创建 `/root/jianshang-system-backup-20260531-151837.tgz`，再 rsync；同步时排除 `.env / .env.* / data/ / public/avatars/ / node_modules`；`pm2 restart jianshang-web` 成功。
  - `curl http://8.135.8.37/health` 返回正常；`/jianshang-logo.jpeg` 返回 200；线上 `fuyulnk` 仍为 `super_admin`。
- 注意事项：
  - 当前 `.xls` 是 Excel 兼容 HTML，不是真正原生多 Sheet `.xlsx`；适合先解决财务下载查看，专业月报后续再做原生 `.xlsx`。
  - `凭证` 列目前为占位，必须等统一文件中心和附件表完成后才能接真实凭证图片/附件下载。

### 2026-05-30 Codex 夜间透支小修：聊天、仓库录入、外观和基础角色

- 任务：按用户临下班前集中反馈，先补一批明显影响试用观感的“怪/假/卡”点。
- 已完成：
  - `backend/src/index.js` — 启动时确保 `roles / role_permissions / conversations / conversation_participants / messages` 基础表存在；新增 `engineering`（工程部）角色；为工程部默认开启工程订单相关权限；补齐新增角色的 AI 工具默认权限行。
  - `backend/src/routes/chat.js` — 关闭新建私聊逻辑；会话列表自动创建并维护 `财务群 / 仓库群 / 工程群 / 总群`，按角色自动加入成员；自建群聊不再要求选择成员。
  - `frontend-new/src/views/chat/ChatIndex.vue` — 新建对话弹窗改为“添加群聊”，移除私聊/选择成员。
  - `frontend-new/src/views/products/ProductList.vue` — 新增产品支持产品名称历史下拉；分类支持预设 + 历史分类 + 自由输入；单位改为可选择/可自定义，预设 `kg/g/ml/L/桶/罐/支/把/套/份/个/颗/箱/卷/米/平方`。
  - `frontend-new/src/layouts/MainLayout.vue`、`frontend-new/src/views/Login.vue` — 使用用户提供的简尚 logo；主题默认按时间自动切换，`18:00` 后进入夜间主题，手动点击主题按钮后转为手动模式。
  - `frontend-new/src/components/AiPetWidget.vue` — AI 浮窗缩放手柄移到左上角，拖拽逻辑改为从左上放大/缩小。
  - `frontend-new/src/views/system/SystemSettings.vue` — 头像上传前增加缩放、左右、上下裁剪；保存时前端生成裁剪后的正方形 PNG 再上传；新增“个性化设置”tab，可改当前浏览器的主色、文字色、背景色，不会影响全公司；知识库页改得更诚实，能触发后端索引接口，找不到索引脚本时返回明确提示。
  - `backend/src/routes/settings.js` — 新增 `/api/settings/knowledge-base/reindex`，如果服务器存在 OpenClaw 知识库索引脚本则后台触发，否则返回“未找到索引脚本”。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/chat.js`
  - `node --check backend/src/routes/settings.js`
  - `node --check backend/src/routes/projects.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 2026-05-31 已部署正式服务器；`pm2 restart jianshang-web` 成功；`curl http://8.135.8.37/health` 返回正常。
  - 线上已确认 `engineering|工程部` 存在；`conversations` 表已补 `created_by`；已直接创建 `财务群 / 仓库群 / 工程群 / 总群`，并加入现有超级管理员。
- 注意事项：
  - 2026-05-31 部署时第一次 rsync 仍使用了 `--delete` 且未排除 `public/avatars/`，导致线上旧头像 `avatar_1_d788f3e9.png` 被删；备份中没有该文件，已把 `fuyulnk.avatar_url` 切换到仍存在的 `/avatars/avatar_1_d4474a0d.png`，避免破图。
  - 后续部署命令必须同时排除 `.env` 和 `public/avatars/`：`--exclude .env --exclude public/avatars/`，不要让构建同步清掉用户上传头像。
  - 个性化设置目前是浏览器本地 `localStorage`，符合“不影响全局”的要求；后续如果要跨设备同步，再做 `user_preferences` 表。
  - 默认群当前按用户访问会话列表时自动维护；新注册用户进入聊天页后会被加入对应默认群。
  - 知识库“重新索引”取决于服务器是否真的存在索引脚本；后续建议做成可视化文档库，显示索引目录、最后索引时间、失败日志。

### 2026-05-30 Codex 工程订单流程试运行修补

- 任务：按用户完整走流程后反馈，修复工程订单“结算金额看不清、必须维修才能完结、编辑/推进割裂、施工组和材料节点缺预留”的问题。
- 已完成：
  - `backend/src/routes/projects.js` — 主工程流程改为 `材料回库 -> 项目完结`，售后改为项目完结后的独立报修分支；结算金额作为完结必填；施工成员也纳入项目可见、编辑和施工阶段推进权限；项目列表按施工成员过滤；可分配人员返回 `availability_status / busy_project_name / busy_until`。
  - `backend/src/index.js`、`backend/src/migrate_projects.js` — `projects` 表补 `crew_member_user_ids / crew_status / material_out_status / material_out_note / material_return_status / material_return_note`，为后续仓库出库/回库联动和员工出工状态做字段预留。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 详情页新增“当前工作单”，每个状态只展示当前要填的表单和下一步按钮；原来的“编辑项目 + 状态推进”割裂体验收敛为一步操作；结算金额改成大输入框 + 大号金额预览；已完结项目显示“发起售后单”，明确售后不再阻塞主工程完结；阶段详情补施工成员、人员状态、材料出库/回库状态；暗色模式阶段表格不再露白。
  - `frontend-new/src/views/projects/ProjectList.vue` — 阶段统计改为“项目完结 / 售后服务”，避免售后混在主工程完结里。
- 验证：
  - `node --check backend/src/routes/projects.js`
  - `node --check backend/src/index.js`
  - `node --check backend/src/migrate_projects.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 本地临时库接口自检：创建工程、安排临时施工员、施工员在列表可见项目、施工员更新人员状态并推进施工阶段、材料回库、填写 `71234` 结算金额、无需售后直接完结；随后删除测试项目和临时施工员。
  - Chrome 视觉自检：工程详情页当前工作单、结算金额大输入、项目完结后的售后入口、暗色阶段表格均正常。
  - 已部署正式服务器；部署命令已排除 `.env`；`pm2 restart jianshang-web` 成功，`curl http://8.135.8.37/health` 返回正常。
- 注意事项：
  - 材料出库/回库当前只是状态和备注字段，尚未真正生成仓库单；后续接仓库系统时应以项目状态触发/关联出库单、回库单和成本核算。
  - `crew_status` 现在是项目内人员状态，不是完整排班系统；后续要做员工日历/占用时间、班组长、成员角色和预计释放日期。
  - 临时自检发现：如果用全新的空数据库直接 `npm start`，`backend/src/index.js` 仍会因为核心表未初始化而失败；现有线上/本地已有库不受影响，但后续应整理“启动即建全量基础表”或明确先跑初始化脚本。

### 2026-05-30 Codex 工程订单保存与施工地址结构化

- 任务：修复线上“新建项目点保存没反应”，并把施工地址改成省/市 + 详细地址的结构化录入。
- 原因：
  - 线上 `projects` 表是旧结构，缺 `created_by` 字段，导致 `POST /api/projects` 报 `table projects has no column named created_by`。
  - 前端创建失败时没有明确错误提示，用户看到的是按钮点了没反应。
- 已完成：
  - `backend/src/index.js` — 启动时确保 `projects / project_logs` 表存在；补齐 `created_by / address_province / address_city / address_detail` 迁移；旧地址回填到 `address_detail`；旧项目默认归到 `fuyulnk` 用户名下。
  - `backend/src/routes/projects.js` — 新建/编辑项目支持独立保存省、市、详细地址，并继续兼容旧 `address` 字段；操作日志写入失败不再阻断项目保存。
  - `backend/src/migrate_projects.js` — 项目表结构同步新增地址拆分字段和 `created_by` 迁移。
  - `frontend-new/src/utils/chinaRegions.js` — 新增省/市预设数据和地址拼接工具。
  - `frontend-new/src/views/projects/ProjectList.vue` — 新建项目弹窗改为“省/市选择 + 详细地址”；保存失败会显示具体错误。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 编辑项目地址同样改为结构化录入，详情页展示拼接后的完整地址。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/projects.js`
  - `node --check backend/src/migrate_projects.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 本地用临时数据库启动 `PORT=3020`，登录 `boss / 123456` 调 `POST /api/projects` 创建项目成功，并确认地址字段保存为 `广东省 / 深圳市 / 南山区测试小区1栋101`；随后已删除测试项目。
  - 已部署正式服务器并重启 `pm2 restart jianshang-web`；`curl http://8.135.8.37/health` 返回正常；线上 `projects` 表已确认存在 `created_by / address_province / address_city / address_detail`。
- 注意事项：
  - 本次第一次按旧命令 rsync 时把本地 `.env` 也同步到了服务器，导致后端临时监听 `3001`，nginx `/health` 出现 502；已把服务器 `.env` 的端口恢复为 `PORT=3000` 并重启，当前正常。
  - 后续正式部署命令必须加 `--exclude .env`，不要再覆盖服务器环境配置。
  - 当前只做到省/市 + 详细地址；如果以后要更像外卖地址，可继续加区/街道、小区联想、常用地址簿。

### 2026-05-29 Codex 员工档案绑定与历史接口权限收紧

- 任务：继续推进员工身份隔离，让系统账号可以绑定 `employees` 员工档案，并收紧历史模块“登录即可访问”的接口风险。
- 已完成：
  - `backend/src/utils/permissions.js` — 新增通用模块权限判断，复用 `roles / role_permissions` 的 `can_view / can_create / can_edit / can_delete`。
  - `backend/src/routes/accounts.js`、`transactions.js`、`products.js`、`employees.js` — 账户、交易流水、产品库存、员工档案接口改为后端强制校验模块权限，不再只靠前端菜单隐藏。
  - `backend/src/routes/employees.js` — 员工列表返回绑定的系统账号；已绑定账号的员工档案禁止直接删除，要求先解绑。
  - `backend/src/routes/users.js` — 用户列表返回员工档案信息；新增 `PUT /api/users/:id/employee`，超级管理员可绑定/解绑员工档案；绑定变化会递增 `role_version`，让旧 token 失效并要求重新登录。
  - `backend/src/index.js`、`backend/src/db/init.js`、`backend/src/db/seed.js` — 补齐 `employees.employee_code` 新库字段、唯一索引和旧员工档案编号回填。
  - `frontend-new/src/views/system/SystemSettings.vue` — 用户管理表新增“员工档案”列和绑定/解绑弹窗；操作列固定在右侧，窄一些的桌面窗口也能看见按钮。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/users.js`
  - `node --check backend/src/routes/accounts.js`
  - `node --check backend/src/routes/transactions.js`
  - `node --check backend/src/routes/products.js`
  - `node --check backend/src/routes/employees.js`
  - `node --check backend/src/utils/permissions.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 用 `/private/tmp/jianshang-codex-home/fuyulnk/jianshang.db` 临时库启动后端 `PORT=3012` 做接口验证：普通员工绑定员工档案后旧 token 调 `/api/me` 返回 401；重新登录后有 `employee_id`；普通员工访问 `/api/accounts`、`/api/transactions`、`/api/employees` 为 403，访问 `/api/products` 为 200。
  - 用 Chrome 视觉检查 `localhost:5173/main/system/settings`：用户管理能看到“员工档案”列、右侧固定操作列和绑定弹窗。
- 注意事项：
  - 本次没有修改真实本地数据库；接口验证使用的是复制到 `/private/tmp` 的临时库。
  - 旧本地后端如果已在 `3001` 运行，需要重启后才会加载这些后端权限改动。
  - 后续可以继续做“个人权限申请/审批”和 AI 审计后台筛选页。

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

### P0：文件上传/下载与财务月底汇总能力

- 当前系统只有头像上传，业务模块还没有统一文件上传/下载；财务、工程、仓库后续都会卡在这里，不能只做某个页面的临时附件。
- 已先补最小可用的财务下载：
  - `GET /api/transactions/export`：按交易流水当前筛选导出 Excel 可打开的格式化 `.xls`，包含标题、导出时间、筛选条件、总收入、总支出、净额和明细表；如需纯数据可传 `format=csv`。
  - `GET /api/finance/analysis`：先用确定性 SQL 做实时分析，输出本月净现金流、环比、本月支出排行、高额支出、疑似重复流水、负余额账户和系统提醒。
  - 前端 `交易流水` 增加“导出当前筛选”，`财务总览` 增加“下载流水”和“实时财务分析”卡片。
- 下一步建议做统一文件中心，而不是每个模块各写一套：
  - 新增 `attachments` 表：`id / entity_type / entity_id / original_name / stored_name / mime_type / size / checksum / uploaded_by / created_at / deleted_at`。
  - 文件存储放在 `backend/data/uploads/`，不要放 `public/`；下载必须走鉴权接口，避免知道路径就能访问。
  - 接口建议：`POST /api/files/upload`、`GET /api/files?entity_type=&entity_id=`、`GET /api/files/:id/download`、`DELETE /api/files/:id`。
  - 权限复用业务模块权限：工程附件看 `projects` 权限，财务附件看 `transactions/finance` 权限，仓库附件看 `products` 权限。
  - 前端做一个可复用 `AttachmentPanel`，先挂到工程订单、交易流水、产品/仓库三类核心对象上。
- 财务专业分析建议分三阶段：
  - 第一阶段：SQL/统计规则实时分析，先保证准确、可解释、可导出。
  - 第二阶段：月度汇总包，导出 CSV/XLSX，包含账户余额、流水明细、分类汇总、项目结算/未结算。
  - 第三阶段：AI 财务分析只读这些确定性结果并生成解释、风险点和月报草稿，不让 AI 直接凭感觉算账。
- 表格格式注意：
  - 当前 `.xls` 是 Excel 兼容 HTML 格式，不需要新增后端依赖，适合先解决“财务能下载、能看、能筛”的问题。
  - 2026-05-31 已参考飞书 Base `ULuCbAAHKaGp4psEZn9crt4vn4a` 的 `收支明细表`：可见字段顺序是 `日期 / 账户 / 金额 / 分类 / 凭证图片 / 对方 / 事由 / 收支类型 / 录入人 / 备注 / 状态 / 父记录 / 创建时间`；当前导出已按这个思路调整，`凭证` 先占位，等文件中心完成后接真实附件。
  - 飞书 Base 还有 `借款核销表 / 资金总览表 / 报销明细表`，说明系统后续不能只做交易流水，还要拆出借款核销、报销审批和账户资金总览。
  - 真正专业月报建议后续升级为原生 `.xlsx` 多 Sheet：`月度摘要 / 账户明细 / 分类汇总 / 项目结算 / 异常检查`，并加入冻结窗格、筛选、公式和图表。
- 注意部署：
  - `backend/data/` 已被 rsync 排除，后续上传文件应天然保留在线上，不会被部署删掉。
  - 之后如新增上传依赖（例如 multipart 解析），部署步骤需要跑 `npm install --prefix backend`。

### 2026-05-29 下班前 AI 板块补足清单

本节是 Codex 对当前 AI 板块的代码扫读结论，供 2026-05-30 接着做。当前判断：AI 权限、用户隔离、审计、限流已经有第一层底座，但距离“让员工放心随便问、让 AI 可靠代办”还差几个硬边界。

#### P0：先补 AI 写入类工具的后端硬确认

- 当前 `create_transaction / create_account` 已是 AI 工具，权限上可以按角色开关；但“创建前必须确认”主要写在 system prompt 里，后端没有强制确认表。
- 下一步建议新增 `ai_action_confirmations`：
  - AI 第一次识别到写入意图时，只创建 `pending` 记录并返回待确认摘要。
  - 用户明确确认后，前端带 `confirmation_id` 再执行真实写入。
  - 金额、删除、结算、项目跨阶段推进、客户确认等高风险动作必须走这条链路。
- 不要把二次确认只交给模型判断；模型可以提示，后端必须兜底。

#### P0：AI 工具结果继续复用业务权限和数据范围

- `get_projects` 已按 `created_by / manager_user_id / assignee_user_id` 对普通员工过滤，这是对的。
- 但 `get_accounts / get_transactions / get_products / get_employees / get_system_stats` 目前主要依赖 `ai_role_tools` 判断“能不能调用”，工具内部没有统一复用 `role_permissions` 和业务接口的数据范围。
- 下一步建议把 AI 工具执行器拆薄：
  - 工具权限决定“能不能调用这个工具”。
  - 模块权限决定“这个人能不能看账户/流水/库存/员工”。
  - 数据范围决定“能看全部、部门、自己负责、还是只看摘要”。
- 财务、仓管、工程、普通员工的 AI 输出字段也要分级；例如仓管可能能看工程材料相关信息，但不一定要看客户电话、总金额、结算金额。

#### P0：把 AI 审计后台做出来

- `ai_audit_logs` 表已经有了，聊天和工具调用也在写入，但目前没有给超级管理员看的筛选页。
- 下一步建议在系统设置加一个“AI 审计”tab：
  - 按用户、员工、角色、工具名、读/写、成功/失败、时间筛选。
  - 默认只展示摘要，不展示完整敏感参数。
  - 写入类工具、失败请求、越权尝试单独高亮。
- 审计不是为了复杂，是为了以后真的给员工用时能回答两个问题：谁问了什么、AI 有没有动过业务数据。

#### P1：修正聊天会话续写体验

- `AiPetWidget.vue` 和旧 `AiChat.vue` 都会加载最近聊天历史，但加载后没有恢复对应 `session_id`；用户看起来是在接着上一段聊，后端实际可能新建会话。
- 下一步建议 `/api/chat/history` 返回会话列表时带 `session_id / title / updated_at`，前端打开最近会话时同步设置 `sessionId`。
- 同时加“新会话”按钮，避免所有问题都混在最后一个会话里。

#### P1：让 AI 回复变成真正流式

- 当前 `/api/chat` 使用 SSE 返回，但后端是先等 DeepSeek 完整返回，再一次性写出 `finalContent`，所以体验上不是真正逐字/分段流式。
- 下一步可先不动工具调用链，优先给普通问答做真实 stream；工具调用场景可以继续先完整执行，再流式总结。
- 这样能明显改善用户体感，尤其 AI 浮窗作为常驻助手时，等待感会少很多。

#### P1：AI 浮窗升级为“工作面板”

- 当前浮窗已经支持拖动、隐藏、缩放、还原尺寸，拖动/缩放误选文字的问题也做了第一轮处理。
- 下一阶段建议补：
  - 会话列表 / 新会话。
  - 停靠模式：右侧贴边、底部小条、桌宠本体三种形态。
  - 当前上下文入口：最近工程、当前页面、当前客户/工单。
  - 明确的任务状态：查询中、等待确认、已执行、失败。
- 视觉上继续保留桌宠入口，但聊天面板应更像“工作区”，而不是一个置顶小网页。

#### P1：知识库服务产品化

- 当前代码把 `127.0.0.1:18790` 当知识库搜索服务，OpenClaw 网关不是这个端口。
- 现在知识库更像本机脚本服务，后续需要：
  - 明确知识库文档目录和索引刷新入口。
  - 后台显示健康状态、索引时间、文档数量。
  - 线上用 PM2 或 systemd 常驻，而不是后端启动时顺手 spawn。
  - AI 回答引用知识库时给出来源摘要，避免员工分不清是系统数据、制度知识，还是模型推断。

#### P2：AI 成本和限流后台可配置

- 目前限流默认值写在代码里，且只按聊天次数做第一层控制。
- 后续建议加系统设置：
  - 按角色配置每分钟/每天次数。
  - 按角色配置单次最大输出 tokens。
  - 批量录入类工具使用 `batch_id`，不要把一次财务批量录入机械地拆成很多次限制。
  - 审计页展示模型、耗时、token 消耗，方便后续调成本。

#### P2：清理旧 AI 组件入口

- `frontend-new/src/components/AiChat.vue` 仍保留旧悬浮气泡实现，当前主入口应是 `AiPetWidget.vue`。
- 后续确认没有页面引用旧组件后，可以删除或归档，避免 Claude/Codex 后面误改旧入口。

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
