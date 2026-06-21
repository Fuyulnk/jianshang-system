# 2026-06-18 数据库框架与接口整理 V1 对接

## 本次目标

按“预留可换库，不直接迁 PostgreSQL”的方向，继续使用现有 SQLite，先把数据库域、业务字典、迁移记录、事实服务、模块接口和 AI 读取口分层整理好。

本轮不清库、不重建库、不做模板管理前端页面，也不把 Excel 文件完整塞进数据库。

## 已完成

### 1. 数据库域与业务字典

新增：

- `backend/src/domain/businessDictionaries.js`
- `backend/src/domain/dataCatalog.js`

内容：

- 6 个核心数据域：账号员工、材料库存、项目工单、项目单据、财务流水、文件附件。
- 项目状态字典、旧状态别名、阶段标签、下一步说明。
- 项目单据类型字典，包含：门店交底单、首勘/首次工勘表、二勘/复尺表、项目结算收款单、施工班组交底单、材料出库/回库单、验收、工费、成本、财务结算/归档凭证。
- 材料单位和财务分类基础字典。
- 部门职位字典：工程部/监理、财务部/财务、仓库/仓管、样板开发/样板开发；自注册入口继续只暴露这些普通岗位，不暴露老板/总监/管理层。
- AI 工具类型字典：L1 查询、L2 草稿、L3 确认写入、L4 管理、L5 白名单命令；同步记录 `tool_read/tool_draft/tool_write/tool_admin/tool_cli` 动作类型和 low/medium/high 风险等级。
- 表清单、接口清单、字段归属清单、业务字典清单。

意义：

- UI、接口、AI、SOP 后续可以共用同一套状态和单据口径。
- “门店交底”和“班组交底”继续区分：门店交底是项目来源和客户需求，班组交底是复尺/收款后、出库前的执行交底。

### 2. 迁移记录底座

新增：

- `backend/src/db/schemaVersions.js`

修改：

- `backend/src/index.js`

实现：

- 新增 `schema_versions` 表。
- 启动时记录框架基线：`20260618_database_framework_v1`。
- 保留旧库兼容的 `CREATE TABLE IF NOT EXISTS` 和 `ALTER TABLE try/catch`，不在 V1 强行大搬迁。
- 固定模板相关表（`document_templates`、`document_template_mappings`、`document_exports`）已从 `index.js` 迁到 `backend/src/db/documentTemplates.js` 统一创建。

说明：

- V1 只是建立迁移记录入口。
- V2 再逐步把 2026-06-18 之后新增结构移动到正式迁移模块，减少散落在 `index.js` 的补字段逻辑。

### 3. 只读事实服务层

新增：

- `backend/src/services/businessFacts.js`
- `backend/src/services/projectDocumentChain.js`

实现的事实服务：

- `inventoryFacts`：材料名称、规格、单位、库存、测试材料、低库存状态、`display_name`、`sku_label`、搜索字段。
- `projectFacts`：项目状态、阶段、下一步、负责人字段和项目权限过滤。
- `projectDocumentFacts`：项目资料链 10 类节点，返回缺失/已上传/已有/已确认、多版本数量、最新版本、附件和结构化表格数据。
- `buildProjectDeliveryChain`：给现有项目详情页使用的资料链展示服务，保留旧前端字段形状：`nodes / metrics / finance / table_data / document_version_count`。
- `financeFacts`：项目收入、成本、毛利、尾款和异常提醒。
- `transactionFacts`：交易流水关键词、类型、时间范围查询。
- `employeeFacts`：员工档案、岗位、绑定账号查询。
- `accountFacts`、`todayFinanceSummaryFacts`、`systemStatsFacts`。

权限：

- 服务层读取默认走模块权限。
- 项目和项目单据额外走 `canAccessProjectRecord`。
- AI、页面路由复用同一套事实服务，避免同一数据多套 SQL 口径。

### 4. 模块接口口径最小统一

修改：

- `backend/src/routes/products.js`
- `backend/src/routes/employees.js`
- `backend/src/routes/transactions.js`
- `backend/src/routes/projects.js`

实现：

- `/api/products` 改走 `inventoryFacts`，支持 `query`、`limit`，返回 `meta`。
- `/api/employees` 改走 `employeeFacts`，支持 `query`、`status`、`limit`，返回 `meta`。
- `/api/transactions` 增加 `query/keyword` 关键词过滤。
- `/api/projects` 兼容 `query`，增加 `limit`，返回 `meta`。

返回口径：

- 新接口和改造接口继续尽量保持 `success / data / message / meta`。
- 这不是最终全系统统一完成，只是先覆盖高频读取口和 AI 共用口。

### 5. AI 读取口改造

修改：

- `backend/src/routes/ai.js`
- `backend/src/ai/toolRegistry.js`

实现：

- AI 工具不再直接在 `ai.js` 里拼库存、项目、财务 SQL，改调用事实服务。
- 已接入工具：
  - `get_products`
  - `get_projects`
  - `get_project_documents`
  - `get_project_profit_summary`
  - `get_transactions`
  - `get_employees`
  - `get_accounts`
  - `get_today_summary`
  - `get_system_stats`
- 工具 schema 补 `query`、`limit`、`status/type` 等参数。
- AI 工具审计补 `durationMs`，失败工具调用会记录 `status=failed` 和错误摘要。
- 角色默认工具列表补 `get_project_documents`。
- `executeTool` 增加内部命名导出，便于本地脚本直接验证工具读取口；不新增公网接口，不改变聊天 API 行为。

意义：

- 简尚 AI 更接近“受控业务 Agent”：通过内部工具读数据库事实，而不是靠提示词背数据。
- 普通员工问无关项目时仍受权限过滤影响。

### 6. 固定表格模板导出底座

新增：

- `backend/src/domain/documentTemplateConfig.js`
- `backend/src/db/documentTemplates.js`
- `backend/src/services/documentTemplateService.js`

修改：

- `backend/src/index.js`
- `backend/src/routes/finance.js`
- `backend/src/routes/project-imports.js`

实现：

- 新增系统内置模板配置，不做模板管理页面。
- 先固定两张表：
  - `project_payment_request`：项目结算收款单。
  - `finance_ledger`：入账登记表。
- 启动时根据模板文件存在状态写入：
  - `document_templates`
  - `document_template_mappings`
- 导出时优先使用原始导入附件；没有原附件时回退到系统固定模板。
- `document_exports` 记录 `template_id`。

本地模板文件：

- `backend/data/document-templates/project_payment_request_v1.xlsx`
- `backend/data/document-templates/finance_ledger_v1.xlsx`

重要部署注意：

- `backend/data/` 被 `.gitignore` 忽略，模板文件不会随 Git 提交。
- 后续部署必须单独同步或在服务器受控目录放置模板文件。
- 线上同步仍然不能 `--delete backend/data/`，否则会误删数据库、上传文件、模板文件。

## 已验证

语法检查通过：

- `node --check backend/src/domain/businessDictionaries.js`
- `node --check backend/src/domain/dataCatalog.js`
- `node --check backend/src/utils/orgOptions.js`
- `node --check backend/src/domain/documentTemplateConfig.js`
- `node --check backend/src/db/schemaVersions.js`
- `node --check backend/src/db/documentTemplates.js`
- `node --check backend/src/services/businessFacts.js`
- `node --check backend/src/services/projectDocumentChain.js`
- `node --check backend/src/services/documentTemplateService.js`
- `node --check backend/src/routes/ai.js`
- `node --check backend/src/ai/toolRegistry.js`
- `node --check backend/src/index.js`
- `node --check backend/src/routes/products.js`
- `node --check backend/src/routes/employees.js`
- `node --check backend/src/routes/transactions.js`
- `node --check backend/src/routes/projects.js`
- `node --check backend/src/routes/finance.js`
- `node --check backend/src/routes/project-imports.js`

冒烟验证：

- 真实 SQLite 只读事实服务可读：库存、项目、财务、员工、项目单据。
- 真实 SQLite 资料链展示服务可读：项目 #4 返回 9 个节点，并保留 `metrics / finance / table_data / document_version_count` 等前端字段。
- 临时端口 3107 启动当前后端代码后，`GET /api/projects/4/delivery-chain` 返回 200，9 个节点，保留 `metrics / finance`。
- 空库模板种子冒烟通过：2 个模板、22 条映射。
- 临时空 HOME 启动当前后端通过：`/health` 返回 ok，默认 `fuyulnk/123456` 登录成功且角色为 `super_admin`。
- 内存库模板模块冒烟通过：`ensureSystemDocumentTemplates` 可独立创建 2 个模板、22 条映射和 `document_exports` 表。
- 本地真实库写入过非业务种子：`schema_versions`、`document_templates`、`document_template_mappings`。
- 未改动项目、库存、流水等业务数据行。
- 多角色事实服务权限抽查：
  - `super_admin/admin`：库存、项目、项目单据、财务、员工可读。
  - `finance`：库存、项目、项目单据、财务可读，员工档案不可读。
  - `warehouse`：库存、项目、项目单据可读，财务和员工档案不可读。
  - `employee`：库存、项目可读；无关项目单据、财务和员工档案不可读。
- 本地 HTTP 多角色只读抽查：
  - `fuyulnk/super_admin`：产品、项目、资料链、财务、员工接口均 200。
  - `caiwu/finance`：产品、项目、资料链、财务 200，员工接口 403。
  - `cangku/warehouse`：产品、项目、资料链 200，财务/员工 403。
  - `yuangong/employee`：产品、项目 200，财务/员工 403；访问无关项目 #4 资料链返回 404/无权限。
- 本地 HTTP 仓库搜索：`/api/products?query=霞光沙&limit=20` 返回 `display_name / sku_label / spec / unit / stock`；当前真实库只有 `霞光沙5｜L｜38` 一条匹配数据。
- 内存库多规格搜索验证：造数 `霞光沙 1L/5L` 后，`inventoryFacts(query='霞光沙')` 返回 `霞光沙1L｜桶｜20`、`霞光沙5L｜桶｜15`，证明同名不同规格 SKU 可被搜索和显示区分。
- 字典派生验证：部门职位字典可返回工程部、财务部、仓库、样板开发；`管理层/总监` 不在自注册合法组合内；AI 工具分级包含 L1-L5，写入动作 `tool_write` 要求确认。
- 本地登录 HTTP 冒烟：已有后端 `127.0.0.1:3001` `/health` 正常；`POST /api/login` 使用 `fuyulnk/123456` 登录成功并返回 `super_admin` token；已有前端 `127.0.0.1:5173` 可返回登录页 HTML。
- AI 工具读取口直连验证：通过内部 `executeTool` 调用真实 SQLite，`get_products` 返回 `display_name/sku_label`，`get_projects` 返回 `status_label/next_step`，`get_project_documents` 返回 10 个资料链节点，`get_project_profit_summary` 返回项目利润粗算 totals；普通员工调用无关项目资料链返回“没有查看项目单据的权限”。
- AI 聊天端到端 mock 验证：使用临时 HOME 空库、临时后端端口和本地假模型服务覆盖 `AI_ENDPOINT`，完整走 `/api/ai/chat -> get_products 工具调用 -> 工具结果回填 -> SSE 回复`，返回 `查到了，霞光沙5L｜桶｜15。`；同时验证 `ai_audit_logs` 记录 `tool_read/get_products/status=ok/risk_level=low/duration_ms` 和 `chat/status=ok`。
- 未执行真实 DeepSeek 端到端调用：真实 `/api/ai/chat` 会把工具结果发送给外部模型并产生调用费用；本轮端到端用本地假模型完成，避免外发真实业务数据。
- 前端构建：`npm --prefix frontend-new run build` 通过；仅有既有 Vite 大 chunk 警告。（2026-06-21 清理/迁移后复跑通过）

## 完成度审计

已完成：

- 建立 6 个核心数据域口径。
- 建立部门职位、状态、单据、材料单位、财务分类、AI 工具类型等后端字典。
- 新增 `schema_versions` 迁移记录机制。
- 高频只读数据服务已覆盖库存、项目、项目单据、财务、流水、员工、账户、系统概况。
- `/api/projects/:id/delivery-chain` 运行路径已切到 `projectDocumentChain` 服务，项目详情页资料链不再由 GET 路由直接组装复杂 SQL。
- AI 已通过事实服务读取库存、项目、项目单据、财务、员工等事实；内部工具读取口已用真实 SQLite 验证。
- 固定模板配置已落到后端，不开放前端模板管理库。
- 项目结算收款单、入账登记表已具备系统固定模板入口。

部分完成 / 后续继续：

- `index.js` 旧建表/补字段逻辑还没有完全迁出；固定模板相关表已迁到 db 模块，其余旧表结构留到 V2 分批迁。
- 所有路由还没有全部改造成服务层；V1 只覆盖高频读取口。
- 写入类服务还没完整抽出，尤其项目单据确认、库存出入库、财务写入。
- `project-imports.js` 里的旧资料链组装函数已清理；资料链展示逻辑集中在 `projectDocumentChain` 服务。
- 权限回归做了服务层多角色抽查和本地 HTTP 多角色只读接口抽查。
- 已做本地登录 HTTP 冒烟；未做浏览器人工页面操作级冒烟。
- 已做本地假模型端到端验证；未做真实 DeepSeek 端到端调用，原因是会外发真实业务工具结果并产生模型费用。上线前如需最终模型验收，应使用脱敏测试库或专门测试项目再跑。

## 未提交 / 未上传

- 本轮未提交 Git。
- 本轮未上传服务器。
- 前端没有因为数据库 V1 做大 UI 重做。

## V2 建议

1. 把项目单据链抽成 `projectDocumentService`，统一处理单据状态、缺字段、版本、确认推进和原格式导出。
2. 把材料出库/回库写入抽成 `inventoryCommandService`，统一库存扣减、回库、损耗、库存流水日志和并发保护。
3. 把财务写入抽成 `financeCommandService`，统一交易流水、项目收款状态、尾款、项目利润粗算和审计日志。
4. 将 `index.js` 里新增结构逐步迁入版本化迁移模块，形成“可追踪、可重复、可审计”的迁移链。
5. 做接口级多角色回归脚本：普通员工、工程、仓库、财务、管理员、超级管理员分别验证项目/库存/财务/员工/附件可见范围。
6. 给 AI 补业务问答回归集：库存规格搜索、项目下一步、资料链缺项、收款状态、无权限项目拒绝。
7. 设计模板文件部署策略：本地模板文件放在 `backend/data/document-templates/`，服务器需要单独种子/同步，避免被源码部署漏掉。
8. V2 再考虑 PostgreSQL 兼容层，不急着迁库；先把服务层接口稳定下来。
