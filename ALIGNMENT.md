# 简尚系统开发对接

这个文件用于 Codex、Claude、Hermes 交替协作时保持上下文一致。每次接手前先读本文件和 `CLAUDE.md`，结束后补充本次对接记录。

## 协作约定

- 每次只让一个 Agent 工作，避免并发改同一批文件。
- 开始前先运行 `git status --short`，确认当前未提交改动。
- 只修改本次任务相关文件，不做无关重构。
- 不要回滚、删除、覆盖自己不确定来源的改动。
- 当前有效前端是 `frontend-new/`，不要改旧前端 `frontend/`。
- 后端使用 ESM、Fastify、better-sqlite3；数据库操作遵循现有同步 API 风格。
- 敏感操作和增删改接口需要按项目权限规则处理。
- 结束时记录：任务、修改文件、验证方式、遗留问题。

## 对接文件结构规则

- `ALIGNMENT.md` 只记录跨 Agent 需要知道的事实：阶段目标、改动范围、验证结果、部署状态、遗留风险、下一步建议。
- 新记录统一写到 `## 对接记录` 下方，按时间倒序追加；今天的记录放最上面，旧记录不要插到文件顶部。
- 每条记录建议使用固定结构：任务、修改文件、验证、注意事项、下一步。不要只写“已完成”。
- 同一天同一阶段如果有 Codex、Claude、Hermes 多轮协作，允许拆多条，但标题要写清角色和动作，例如“Codex 开发”“Claude 部署”“Hermes 终审”。
- 线上部署、数据库迁移、权限/安全修复必须单独写清楚；本地演示数据也必须注明“本地测试库，不代表线上”。
- 历史快照、旧 Git 状态、废弃说明放到附录或标注为历史，不能写成“当前状态”。
- 如果产生路线图、SOP、阶段总结、老板版汇报等独立文件，必须在 `## 关键文件索引` 补入口。
- 不要把长篇代码、完整日志、终端噪声贴进本文件；只保留可交接结论和必要命令。

## 当前项目要点

- 前端：`frontend-new/`
- 后端：`backend/`
- 后端入口：`backend/src/index.js`
- 后端路由：`backend/src/routes/`
- 前端路由：`frontend-new/src/router/index.js`
- 布局入口：`frontend-new/src/layouts/MainLayout.vue`
- 项目规范：`CLAUDE.md`

## 关键文件索引

- `handoff/简尚系统路线图V1.md`：内部开发路线图。Codex、Claude、Hermes 后续接手前必须先读，用来判断任务是否属于主线、短中长期目标、暂停功能、风险和验收标准。
- `handoff/简尚系统路线图V1-老板版.txt`：给老板/管理层看的汇报版路线图，语气更偏工期、难点和阶段成果说明；不要把它当开发规范直接照做。
- `handoff/门店交接到施工承接流程V1.md`：业务主线 SOP，描述门店/渠道交接到简尚施工承接、仓库、财务、归档的流程基准。
- `handoff/animation-tasks.md`：历史遗留的动画任务记录，目前不是主线，除非用户明确要求再处理。
- `CLAUDE.md`：项目协作规则和 Claude 侧约定。
- `ALIGNMENT.md`：当前交接流水和阶段记录。每轮较大开发结束后要追加记录。

## 前端包体积提醒

- 当前 `npm run build` 会出现 Vite chunk size 警告，主 JS 包约 1.1MB（gzip 后约 360KB）。
- 这不是当前功能错误，系统可以正常运行；但后续会做成 App，过大的首屏包会影响冷启动、JS 解析时间、内存占用和更新体积。
- 后续新增页面时优先使用路由懒加载，不要继续把重页面全部静态 import 到首屏包。
- 建议近期整理 `frontend-new/src/router/index.js`：
  - 登录页和主系统分开加载。
  - `SystemSettings.vue`、`FinanceOverview.vue`、`ProjectDetail.vue`、`EmployeeDashboard.vue` 等非首屏页面改成 `() => import(...)`。
  - 系统设置里的 AI 权限、用户管理等大块功能后续可拆成子组件并按 tab 延迟加载。
- 现阶段不用为了这个警告做激进优化；功能稳定后安排一次“前端加载结构整理”即可。

## 2026-06-05 下午 Codex：项目工单分支和完工样本校正

- 背景：财务看系统后指出“完工成本核算表”和“财务结算/归档”展示内容几乎一样，不符合实际；同时用户确认项目工单需要拆出“项目供货单”分支。
- 本轮定位：
  - 施工项目工单：走门店交接、工勘、交底、出入库、施工、验收、工费、成本、财务归档。
  - 项目供货单：单独分支，流程为“销售下单 → 财务确认收款 → 仓库订材料 → 材料到位发货 → 完结”，不进入施工资料链。
- 修改重点：
  - `frontend-new/src/router/index.js`：`/main/projects` 改为项目工单分支首页；施工列表移动到 `/main/projects/construction`；新增 `/main/projects/supply`。
  - `frontend-new/src/views/projects/ProjectWorkOrderHome.vue`：新增分支选择页。
  - `frontend-new/src/views/projects/ProjectSupplyList.vue`：新增项目供货单 V1 骨架页，先展示流程和样板，不假装已完成真实入库。
  - `frontend-new/src/components/projects/ProjectDocumentSummary.vue`：成本核算和财务归档弹窗拆开；成本表展示费用/利润，财务归档展示收款、尾款、凭证说明、归档状态。
  - `frontend-new/src/views/projects/ProjectList.vue`、`ProjectDetail.vue`：已归档项目不再因为门店单号等建议项显示“待完善”；详情返回改到施工工单列表。
- 本地样本：
  - 已将本地测试项目 `#4 何总 项目工单` 补成已归档演示状态：工勘、交底、材料、验收、工费、成本、财务归档单据均为 `confirmed`。
  - 这是本地测试库演示数据，不代表线上已改。
- 验证：
  - `node --check backend/src/routes/project-imports.js && node --check backend/src/routes/projects.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 直查本地库确认项目 #4：`status=archived`，7 类项目单据均 `confirmed`。
- 后续：
  - 项目供货单现在只是 V1 骨架，后续应补后端表、权限、收款联动、库存/采购联动和附件/日志。
  - 财务归档需要继续接交易流水/账户收款记录，不能只靠项目单据 JSON。

## 历史 Git 状态快照（仅解释早期工作树为什么脏）

记录时间：2026-05-18。此段不是当前工作树状态；当前状态请以运行 `git status --short` 的结果为准。

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

## 对接记录

### 2026-06-05 Claude 部署 项目供货单V1 + 工单分支重构 + 权限修复

- 任务：项目供货单 V1、工单分支首页（施工/供货）、permissions.js data_scope 修复、products.js 404 校验，由 Claude 部署上线。
- 修改文件：24 文件，+4008/-377，5 新文件。
- 验证：
  - `node --check backend/src/index.js`
  - `npm run build`（frontend-new/，成功；Vite chunk 警告）
  - rsync 前端 dist + 后端 src → PM2 restart
  - `/health` 返回正常
  - 注意：PM2 重启后端口因环境变量残留在 3001，已 `PORT=3000 pm2 restart --update-env` 修复
- 注意事项：
  - 供货单 V1 只做流程和日志，不自动扣库存。
  - 已推 GitHub：`52c15ec` → `main`

### 2026-06-05 Codex 修复 Hermes 终审 P1

- 任务：修复 Hermes 对“项目工单表格体验、供货单 V1 和完工闭环”终审发现的 3 个 P1，并补对接文件结构规则。
- 修改文件：
  - `backend/src/utils/permissions.js` — `super_admin` 仍固定全权限；`admin` 优先读取数据库中的 `role_permissions.data_scope`，缺配置时才回退 all，避免 data_scope 配了 self 仍被硬编码绕过。
  - `backend/src/routes/supply-orders.js` — 供货单列表/详情按 `getDataScope(db, user, 'projects')` 判断是否看全部；金额、单价、数量统一限制为非负并设置上限 `100000000`；数量保留 3 位小数，金额保留 2 位小数。
  - `backend/src/routes/products.js` — PUT 校验产品名不能为空；PUT/DELETE 根据 `changes === 0` 返回 404，避免不存在 ID 返回 success。
  - `frontend-new/src/components/projects/ProjectDocumentSummary.vue` — 产品价格记忆加载失败不再空 catch，改为 `console.warn`。
  - `ALIGNMENT.md` — 新增“对接文件结构规则”。
- 验证：
  - `node --check backend/src/utils/permissions.js`
  - `node --check backend/src/routes/supply-orders.js`
  - `node --check backend/src/routes/products.js`
  - `npm run build`（在 `frontend-new/`，成功；仍有 Vite 大 chunk 警告）
- 注意事项：
  - 本轮未上传服务器。
  - Hermes 的 P2“状态推进角色硬编码”暂未展开，建议下一轮把供货单五步动作做成角色权限项或流程权限表，避免现在为了修 P1 把权限体系拉太大。

### 2026-06-04 Claude 施工交底单导入预览+Hermes修复 上线

- 任务：Codex 完成施工交底单 P1 修复+材料出库表预览骨架，Hermes 修复代码后 Claude 部署上线。
- 已完成：前端构建 -> rsync -> PM2 重启，已备份，已推送 GitHub。
- 验证：/health 正常，pm2 list online。
- 注意事项：无。


### 2026-06-04 Codex 施工交底单 P1 修复 + 材料出库表预览骨架

- 任务：用户希望多个流程一起推进；本轮先收敛施工交底单导入预览的初审 P1，再小步打开材料出库表字段映射预览，不做自动扣库存。
- 修改文件：
  - `backend/src/utils/projectDocumentImport.js` — 施工交底单 `briefing_date` 标记为推断字段；新增材料出库表解析，按材料/辅材/工具分段读取材料名、单位、出库数、回库数、单价、金额、备注。
  - `backend/src/routes/project-imports.js` — 新增 `POST /api/projects/:id/document-imports/material-out/parse`；施工交底单写入改为工程/管理员类角色才可写；推断交底日期必须带 `confirmed_inferred_fields` 才允许写入；写 `address_detail` 时同步重算 `address`；项目日志补充文件名和风险提示。
  - `frontend-new/src/components/projects/ProjectDocumentImportPanel.vue` — 导入面板改成多表预览，可切换施工交底单/材料出库表；施工交底单可勾选写入，材料出库表只预览不扣库存；推断字段默认不勾选。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 向导入面板传入写入权限，避免无权限员工看到可写入按钮。
- 已完成：
  - 修复 P1：`briefing_date` 不再默认勾选，后端未显式确认时返回 `400`，不会写库。
  - 修复 P1：导入写入 `address_detail` 时同步更新 `address` 汇总字段，避免列表和详情地址不一致。
  - 补 P2：前端有写入权限态；后端写入限制为 `super_admin/admin/engineering` 并继续校验项目可见范围。
  - 补 P2 一部分：写入日志记录文件名、风险提示和实际变更字段；尚未保存原始文件为附件。
  - 新增材料出库表预览：真实样本 `栖棠映山4栋1802材料出库表.xlsx` 可识别 30 条明细，类别为材料/辅材/工具。
- 验证：
  - `node --check backend/src/routes/project-imports.js`
  - `node --check backend/src/utils/projectDocumentImport.js`
  - 真实样本解析脚本：施工交底单返回推断字段 `briefing_date.inferred=true`；材料出库表返回 30 条明细。
  - 本地接口验证：未确认推断交底日期写入返回 `400`，项目 2 数据未变化。
  - 本地接口验证：材料出库表解析接口返回 `200`、30 条明细、只读预览。
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite 大 chunk 警告）
  - Chrome 打开 `http://127.0.0.1:5173/main/projects/2` 顶部加载正常；本轮尝试滚动到中部面板时 Chrome 滚动容器未响应快捷键，未完成深度截图复核。
- 给 Claude 初审：
  - 重点看 `briefing_date` 推断确认链是否足够硬，是否还能通过 API 绕过。
  - 重点看 `address_detail -> address` 同步是否和 `projects.js` 的地址逻辑一致。
  - 重点看材料出库表解析金额是否应叫“明细金额合计”，不要误导成最终出库成本。
- 给 Hermes 审计：
  - 查新 `material-out/parse` 是否有鉴权、项目 data_scope、文件大小/异常表格风险。
  - 查施工交底单 apply 是否存在员工越权写关键客户/地址字段。
  - 查导入面板无权限态是否只影响前端显示，后端是否仍硬拒绝。
- 注意事项：
  - 本轮未上传服务器。
  - 材料出库表只做预览，不创建出库申请、不扣库存、不推进项目状态。
  - 原始导入文件仍未自动保存为项目附件；后续要和文件中心打通，才能满足“上传新版本看到时间和上传人”的路线图验收。

### 2026-06-04 Claude 施工交底单导入预览 上线

- 任务：Codex 完成总监表格字段映射 V2 第二阶段（施工交底单导入预览），Claude 部署上线。
- 已完成：
  - 前端构建 -> rsync -> PM2 重启。
  - 部署前备份完成。
  - 验证：/health 正常，pm2 list online。
  - 本地固化：git commit + git push。
- 注意事项：无。


### 2026-06-04 Codex 总监表格字段映射 V2 第二阶段起步：施工交底单导入预览

- 任务：按路线图 4.2 继续推进“真实表格字段映射 + 人工确认导入”，先选总监工作树里最关键的 `施工交底单` 做第一张真实表，不直接做全自动核算。
- 修改文件：
  - `backend/src/utils/projectDocumentImport.js` — 新增施工交底单解析工具，按固定模板和关键词读取基础信息、班组长、施工面积、复尺/进入方式、施工项目明细。
  - `backend/src/routes/project-imports.js` — 新增 `POST /api/projects/:id/document-imports/briefing/parse` 和 `POST /api/projects/:id/document-imports/briefing/apply`；解析只预览，写入必须人工确认并按项目权限校验。
  - `frontend-new/src/components/projects/ProjectDocumentImportPanel.vue` — 新增项目详情内的“施工交底单导入预览”面板，支持上传 xls/xlsx/csv、字段预览、勾选写入、施工明细预览。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 在“项目单据链 V2”后挂载导入预览面板，写入后刷新当前工单。
- 已完成：
  - 可从真实样本 `施工交底单 - YSH20251116 - 朱总栖棠映山.xls` 识别 8 个项目字段：来源门店/渠道、门店接单人、接单日期、业主/客户、业主电话、详细地址、班组长、交底日期。
  - 可识别施工项目明细：空间、纹理/产品、工艺、颜色、预收面积、实际面积、备注。
  - 发现并提示两个真实风险：客户电话为空时不自动用销售电话代替；文件名日期 `2025-11-16` 与表内日期 `2026-11-16` 不一致时要求人工确认。
  - 写入接口只允许白名单字段，并同时校验项目模块权限和 `data_scope` 项目可见范围；写入后记录 `project_logs`。
- 验证：
  - `node --check backend/src/routes/project-imports.js`
  - `node --check backend/src/utils/projectDocumentImport.js`
  - 本地真实样本解析脚本：返回 8 个字段、1 条施工明细、2 条风险提示。
  - 未登录请求解析接口返回 `401`。
  - 鉴权后请求 `POST /api/projects/2/document-imports/briefing/parse` 返回 `200`，且没有写入项目数据。
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite 大 chunk 警告）
  - Chrome 本地视觉检查：`http://127.0.0.1:5173/main/projects/2` 中新面板位于单据链后、当前工作单前，未发现明显遮挡或跳位。
- 注意事项：
  - 本轮未上传服务器。
  - 本轮没有测试“确认写入”按钮的真实写库动作，避免污染项目 2；后续可用临时项目做端到端写入测试。
  - 施工交底单里的“接单时间”和文件名日期可能不一致，后续需要让总监确认到底以哪个为准。
  - 明细本轮只做预览，不自动写入成本、仓库、工费或财务；下一步建议继续做材料出库表或完工成本核算表的字段映射。

### 2026-06-04 Codex 总监表格字段映射 V2 第一刀

- 任务：在项目工单状态机 V2 已上线的基础上，先把总监真实工作树里的核心表格拆成项目详情页可读的“单据链检查清单”，让员工能看到每个阶段缺哪张表、缺哪些关键字段、下一步该补什么。
- 修改文件：
  - `frontend-new/src/components/projects/ProjectDocumentSummary.vue`
- 已完成：
  - 将原“项目单据链汇总”升级为“项目单据链 V2 / 总监表格字段映射”。
  - 按总监真实完工文件链路拆出 7 类检查项：现场勘察表、基层二次勘察/复尺表、施工交底单、材料出库/回库表、施工班组工费结算单、完工成本核算表、财务结算/对账凭证。
  - 每类检查项显示：总监文件名、系统关键字段、附件命中、字段命中、完整/部分具备/待补状态、下一步补资料动作。
  - 修正之前过于宽松的判断：工费和成本必须有对应附件配合关键字段；财务不能只因为填了合同金额/定金就被当成闭环，必须提示补最终结算和财务凭证。
  - 保持当前轮次只做识别和缺项提示，不做自动成本核算、不改后端、不改状态机。
- 验证：
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite 大 chunk 警告）
  - Chrome 本地视觉检查：打开 `http://127.0.0.1:5173/main/projects/2`，检查顶部摘要、7 张单据卡、财务提示、当前工作单衔接，未发现遮挡和明显跳位。
- 注意事项：
  - 本轮未上传服务器。
  - 当前只是“字段映射和缺项提示第一刀”，真实 Excel/PPT 解析入库、成本/工费/财务结构化计算仍在后续阶段。
  - 后续建议继续做“总监表格字段映射 V2 第二阶段”：把真实表格字段逐项映射到系统字段，并设计导入后的人工确认页，避免自动导入污染项目数据。

### 2026-06-04 Claude 状态机 V2 上线 + P2 修复

- 任务：Codex 完成项目工单状态机 V2 第一阶段（总监流程 14 步），Hermes 审计 PASS，Claude 修复 P2 静默错误并部署上线。
- 已完成：
  - 前端构建 -> rsync -> PM2 重启。
  - 部署前备份完成。
  - 验证：/health 正常，pm2 list online。
  - P2 修复：fetchDetail() catch 空 -> 错误提示。
  - 本地固化：git commit + git push。
- 注意事项：无。


### 2026-06-04 Claude 状态机 V2 上线 + P2 修复

- 任务：Codex 完成项目工单状态机 V2 第一阶段（总监流程 14 步），Hermes 审计 PASS，Claude 修复 P2 静默错误并部署上线。
- 已完成：
  - 前端构建 → rsync → PM2 重启。
  - 部署前备份：。
  - 验证： 正常， online。
  - P2 修复：fetchDetail() catch 空 → 错误提示。
  - 本地固化：git commit + git push。
- 注意事项：无。


### 2026-06-03 Claude 出库联动 + 勘察表 + P1 修复 上线

- 任务：Codex 完成 V1 阶段测试修复、Hermes P1 修复、勘察表关联工单、项目阶段文案对齐，Claude 部署上线。
- 已完成：
  - 前端构建 → rsync → PM2 重启。
  - 部署前备份：`/root/jianshang-system-backup-20260603-204000.tgz`。
  - 验证：`/health` 正常，`pm2 list` online。
  - 本地固化：`git commit + git push`。
- 包含的改动：
  - 出库库存原子扣减 `AND stock >= ?` + 事务回滚。
  - 勘察表生成器可关联项目工单。
  - 阶段文案对齐总监表格线。
  - `project_related` 角色能看到自己项目的出库申请。
- 注意事项：无。

### 2026-06-03 Codex V1 阶段测试 + Hermes P1 修复 + 勘察表关联工单

- 任务：按用户要求做 V1 阶段性完整测试，并修复 Hermes 终审提出的 3 个 P1；同时把工程部勘察表生成器从“单独导出”补成“可选择项目工单并确认关联”的闭环。
- 已完成：
  - `backend/src/routes/material-requests.js`：
    - 出库申请列表查询补齐 `projects.created_by / manager_user_id / assignee_user_id / crew_member_user_ids`，修复 `project_related` 角色看不到自己项目出库申请的问题。
    - 出库确认改成事务内条件扣减：`UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?`，库存不足时整笔事务回滚，避免并发确认导致负库存。
    - 取消出库申请后检查同项目是否还有其他待确认申请；没有则把 `projects.material_out_status` 回退为 `pending`。
  - `frontend-new/src/components/projects/SurveyReportGenerator.vue`：
    - 新增“关联项目工单”区域，可加载当前用户可见项目并选择目标工单。
    - 点击“确认关联”后，把生成的勘察 HTML 上传到项目附件，并回写 `survey_date / survey_report / condition_note`，让项目详情单据链可识别。
  - `backend/src/routes/projects.js`、`frontend-new/src/views/projects/ProjectDetail.vue`：
    - 项目阶段文案对齐总监表格线：门店交接/工勘、复尺交底/排班、出库进场/施工、验收回库/结算、完工归档。
    - 当前工作单说明改为提示可从工程部工作台关联勘察表。
- 验证：
  - `node --check backend/src/routes/material-requests.js`
  - `node --check backend/src/routes/projects.js`
  - `git diff --check`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite 大 chunk 警告）
  - 使用隔离临时库 `HOME=/private/tmp/jianshang-v1-test PORT=3065 npm start` 实测：
    - P1-1：`employee` 角色能看到自己关联项目的出库申请。
    - P1-2：库存不足的确认出库会被拒绝，库存保持不变。
    - P1-3：取消最后一个待确认出库申请后，项目 `material_out_status` 回退到 `pending`。
- 视觉/交互审查记录：
  - 本地 Vite 已启动并打开登录页，登录页视觉正常。
  - 本轮 Browser 插件和 Chrome/Safari 的脚本登录均被本机安全/剪贴板限制拦截，未能稳定进入登录后的页面做人眼全流程截图；已通过构建、源码结构、接口自测覆盖功能正确性。
  - 后续如果要做真正全页面视觉体检，建议用户手动登录本地系统后让 Codex 接管已登录窗口，或开启 Chrome “允许 Apple 事件中的 JavaScript”。
- 注意事项：
  - 本次没有上传服务器。
  - 出库申请的“限制项目阶段”仍是 P2，建议后续补：只有交底完成/待出库附近状态允许发起出库，避免员工在错误阶段申请材料。
  - 多处前端 `catch {}` 静默吞错仍是 P2，后续应逐页改成可见提示或最少 `console.warn`。

### 2026-06-03 Codex 工程部现场勘察表生成器 V1 + 单据链汇总

- 任务：根据总监真实工作树里的标准完工单据链，先把长期高频的“现场勘察 PPT”沉淀为工程部工作台工具，并在工单详情里显示单据链汇总。
- 已完成：
  - 新增 `handoff/门店交接到施工承接流程V1.md`：业务主线 SOP，明确门店/渠道交接到简尚施工承接、出库、班组、成本、财务归档的完整流程基准。
  - 新增 `frontend-new/src/components/projects/SurveyReportGenerator.vue`：现场勘察表生成器，支持填写项目/客户/勘察人/天气/进场判断，上传现场图片并人工标注区域、问题、说明。
  - 勘察表生成器支持“生成汇总”、打印/PDF、导出 HTML，草稿保存到本机 `localStorage`。
  - `frontend-new/src/views/EmployeeDashboard.vue` 接入生成器，并新增“现场勘察 SOP”卡片：先拍全局、再拍问题、标注整改、判断进场。
  - 新增 `frontend-new/src/components/projects/ProjectDocumentSummary.vue`：项目单据链汇总，按现场勘察、二次勘察/复尺、施工交底、材料出库/回库、班组工费结算、完工成本核算、财务结算识别附件和系统字段。
  - `frontend-new/src/views/projects/ProjectDetail.vue` 接入单据链汇总。
- 验证：
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite 大 chunk 警告）。
  - 本地 Vite 预览打开 `/main/employee-dashboard`，确认“现场勘察表生成器”和“现场勘察 SOP”可见，暗色主题下表单和上传区可读。
- 注意事项：
  - 本次没有上传服务器。
  - V1 不做 AI 识图、不做真正 PPTX 导出、不自动挂项目附件；先固定模板和 SOP。后续 V2 可接 AI 图片识别、PPTX 生成、自动归档到项目附件。
  - 工单详情“单据链汇总”需要项目附件已经上传到系统后才能识别真实文件名；工作树批量导入前，它更多是流程检查卡。
  - 本地工单详情视觉因后端接口连接不稳定未完整截图复核，已由构建保证组件语法通过。

### 2026-06-03 Codex 项目工单出库联动 V1

- 任务：按用户确认，先不等真实工单样本，做项目工单到仓库出库的联动骨架，让模块不再孤立。
- 已完成：
  - 后端新增 `material_requests` / `material_request_items` 表，记录项目工单出库申请、材料明细、申请人、确认人、确认时间和状态。
  - 后端新增 `/api/material-requests`、`POST /api/projects/:id/material-requests`、`PUT /api/material-requests/:id/confirm`、`PUT /api/material-requests/:id/cancel`。
  - 工程/管理员可在项目工单详情发起出库申请；仓库/管理员确认后会扣减 `products.stock`，并把工单 `material_out_status` 改为 `done`。
  - 如果工单当前处于 `briefing_done`（待出库），仓库确认出库后会自动推进到 `material_out`（待进场）。
  - 前端新增 `MaterialRequestPanel` 组件；项目详情显示“材料出库联动”，产品库存页显示“待处理出库申请”。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/material-requests.js`
  - `node --check backend/src/routes/projects.js`
  - `node --check backend/src/routes/products.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 使用临时空库 `HOME=/private/tmp/jianshang-material-test-home PORT=3061 npm start` 实测：
    - 未登录访问出库申请返回 401。
    - 超级管理员登录成功。
    - 创建产品库存 10、创建项目工单，并将测试工单置为 `briefing_done`。
    - 发起出库申请 3kg 成功。
    - 仓库确认出库成功，产品库存变为 7，项目状态变为 `material_out`，`material_out_status = done`。
  - 临时测试后端已停止，3061 端口未占用。
  - 本地后端 3001 已重启，`/health` 正常；`/api/material-requests` 未登录返回 401。知识库 18790 已有服务占用，后端尝试重复拉起知识库失败，不影响本轮出库联动。
- 注意事项：
  - 本次没有上传服务器。
  - V1 只做出库申请和扣库存，不做复杂成本、回库单、库存流水、财务自动记账。
  - 等用户拿到真实工单和材料结构后，再扩展材料清单模板、回库/损耗、成本归集。

### 2026-06-03 Claude AI 导入助手 + 项目工单流程 上线

- 任务：Codex 完成 AI 工单导入助手 V1 + 项目工单流程校准，Claude 部署上线。
- 已完成：
  - 前端构建 → rsync → npm install → PM2 重启。
  - 部署前备份：`/root/jianshang-system-backup-20260603-114000.tgz`。
  - 验证：`/health` 正常，`pm2 list` online。
  - 本地固化：`git commit + git push`。
- 注意事项：无。

### 2026-06-03 Codex 简尚 AI 工单导入助手 V1

- 任务：按用户计划新增“AI 工单导入助手”，让员工粘贴微信/门店交接内容或上传 CSV/XLS/XLSX，由 AI/解析器拆成项目工单草稿，人工确认后批量创建项目工单。
- 已完成：
  - 后端新增 `project_import_batches` / `project_import_items` 表，记录导入批次、AI 草稿、人工确认值、字段修正 diff、缺核心字段、疑似重复工单和创建后的项目 ID。
  - 后端新增 `/api/project-imports/parse`、`/api/project-imports/:id`、`/api/project-imports/:id/confirm`，支持文本解析、CSV/XLS/XLSX 解析、去重提示、批量确认创建。
  - 新增 `xlsx` 依赖用于后端解析表格；安装时 npm audit 提示 12 个依赖漏洞（4 moderate / 8 high），本轮未做 `npm audit fix`，避免引入无关依赖变动。
  - 简尚 AI system prompt 已同步施工承接流程：门店交接、工勘、排班、交底、出库、进场、施工、验收、回库、结算、完结。
  - AI 工具新增 `parse_project_handover` 和 `create_project_workorder`，权限页可见；创建工单工具要求用户确认并检查项目创建权限。
  - 项目工单页新增“AI 导入工单”入口；弹窗支持粘贴文本/上传表格、编辑草稿、查看缺核心/可能重复、勾选后批量创建。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/ai.js`
  - `node --check backend/src/routes/project-imports.js`
  - `node --check backend/src/utils/projectImport.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 使用临时空库 `HOME=/private/tmp/jianshang-import-test-home PORT=3060 npm start` 实测：
    - 未登录访问导入解析返回 401。
    - 超级管理员登录成功。
    - 多客户微信文本可拆出 2 条草稿。
    - 批量确认可创建 2 条项目工单。
    - 再次导入相同手机号/门店单号可返回“可能重复”。
    - XLSX 表格可解析出草稿。
    - 普通员工账号无项目创建权限时导入解析返回 403。
  - 临时测试后端已停止，3060 端口未占用。
- 注意事项：
  - 本次没有上传服务器。
  - 本轮 V1 不做截图 OCR、微信自动接入、飞书自动同步。
  - 导入草稿里的“是否施工/是否备货/备货备注”目前写入导入记录，并在创建项目时追加到交接备注；未新增项目表独立字段。

### 2026-06-03 Claude 项目工单流程校准 + P1 修复 上线

- 任务：Codex 完成项目工单施工承接流程校准（状态流程文案、资料完整度硬校验、下一步动作指引），Hermes 审计发现 P1 标签不一致已修复，打包部署上线。
- 已完成：
  - 前端构建 → rsync → PM2 重启。
  - 部署前备份：`/root/jianshang-system-backup-20260603-104400.tgz`。
  - 验证：`/health` 正常，`pm2 list` online。
- 包含的改动：
  - Codex：状态流程施工承接口径、核心资料硬校验、详情页下一步动作。
  - Claude：修复前后端阶段标签不一致（Hermes P1-1/P1-2）。
- 注意事项：无。

### 2026-06-03 Claude 修复 Hermes 审计 P1 标签不一致

- 任务：Hermes 终审发现前后端阶段标签不一致（2 个 P1），上线前修复。
- 已修复：
  - `ProjectDetail.vue` — 阶段 4 标签从"交付验收"改为"交付结算"、阶段 5 从"结算完结"改为"完结归档"，对齐后端 `projects.js` 的 `phaseLabel`。
  - `ProjectList.vue` — 看板和筛选统计的 6 个阶段标签全部更新为后端口径（接收工单/施工准备/施工执行/交付结算/完结归档/售后处理）。
- 验证：`npm run build` 通过。
- 注意事项：未上传服务器，本次改动与 Codex 项目工单流程合并在下一次部署一起上线。

### 2026-06-03 Codex 项目工单施工承接流程校准

- 任务：按用户确认，先不做仓库出库联动，继续把项目工单流程真正贴合“门店/渠道签单，简尚承接施工”的业务。
- 已完成：
  - `backend/src/routes/projects.js` — 工单状态标签改为施工承接口径：待工勘、待确认开工条件、待排班组、待开工交底、待出库、待进场、施工中、待验收、待材料回库、待结算、已完结。
  - `backend/src/routes/projects.js` — 从待工勘推进到下一步时，新增核心交接资料硬校验：来源门店/渠道、门店接单人、业主电话、详细地址；仍要求工勘记录或工勘日期。
  - `frontend-new/src/views/projects/ProjectList.vue` — 阶段筛选和看板改为接收工单、施工准备、施工执行、交付结算、完结归档、售后处理；资料标签区分“缺核心”和“待完善”。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 当前工作单文案重写为施工承接下一步动作；详情页显示必须补齐项和建议完善项；缺核心资料时在当前工作单下方明确提示不能推进原因。
  - `backend/src/index.js` — 工程部默认说明同步为“项目工单、施工班组相关权限”，避免权限页继续使用旧口径。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/projects.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 使用临时空库 `HOME=/private/tmp/jianshang-workflow-test-home PORT=3057 npm start` 实测：缺核心资料推进到 `survey_done` 返回 403；补齐来源、接单人、电话、地址和工勘记录后可推进，状态标签返回“待确认开工条件”。临时后端已停止。
- 注意事项：
  - 本次没有上传服务器。
  - 下一步适合做仓库出库联动 V1：项目工单发起出库申请 → 仓库确认 → 库存扣减 → 工单材料出库状态更新。

### 2026-06-02 Claude 项目工单部署上线

- 任务：Codex 完成项目工单改造（业务校准 + 工作台视觉重构），Hermes 终审通过，部署上线。
- 已完成：
  - 前端构建 → rsync 到服务器（排除 .env/data/node_modules/avatars）→ PM2 重启。
  - 部署前服务器备份：`/root/jianshang-system-backup-20260602-202800.tgz`。
  - 验证：`/health` 返回正常，`pm2 list` 显示 `jianshang-web` online。
- 注意事项：无。

### 2026-06-02 Claude 部署回滚 + 项目工单初审

- 任务：部署内部开单中心 V1 后用户发现不符实际业务（简尚无销售，门店接单简尚施工），立即回滚；随后 Codex 改为项目工单方案，Claude 做部署前初审。
- 已完成：
  - 构建前端并 rsync 推送到服务器（含 orders 模块）→ 用户确认不符合业务 → 从部署前备份回滚，服务器恢复上线状态。
  - 初审 Codex 项目工单改造（`ProjectList.vue` / `ProjectDetail.vue` / `projects` 表字段）：
    - `node --check backend/src/index.js` ✅
    - `node --check backend/src/routes/projects.js` ✅
    - `node --check frontend-new`：`npm run build` 通过，Vite chunk 警告已知
  - 初审结论：前后端语法正确，构建通过，业务方向与用户确认一致，可以部署。
- 验证：`node --check` + `npm run build`。
- 注意事项：未上传服务器。本次部署回滚教训已写入 AGENTS.md "部署红线"。

### 2026-06-02 Codex 项目工单工作台视觉重构

- 任务：用户反馈上一轮只是业务纠偏，看起来“没改啥”；本轮把项目工单页面改成更像施工承接工作台，而不是普通数据表。
- 已完成：
  - `ProjectList.vue` — 增加工单工作台头部说明和 4 个看板指标：资料待补、待工勘、待排班/备货、施工进行。
  - `ProjectList.vue` — 表格增加“门店交接”合并列、资料完整度标签、施工地址列；搜索提示改为面向工单/业主/门店/单号。
  - `ProjectList.vue` — 新建工单弹窗按“门店交接 / 施工承接 / 金额信息”分区，录入顺序更贴近真实交接流程。
  - `ProjectDetail.vue` — 顶部新增“门店交接资料”和“施工承接状态”摘要区，直接显示来源、接单人、接单日期、门店单号、地址、交接备注、负责人、班组长、预计完工。
  - `ProjectDetail.vue` — 本地阶段名称改成施工承接口径：接收工单、施工准备、施工执行、交付验收、结算完结。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/projects.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
- 注意事项：
  - 本次没有上传服务器。
  - 尝试使用 Browser 插件做本地视觉截图，但当前环境返回 `Browser is not available: browser`，未完成自动截图验收。

### 2026-06-02 Codex 业务校准：内部开单改为项目工单

- 任务：用户补充真实业务：简尚没有销售，门店/渠道签单，简尚作为施工方承接施工；因此撤回上一轮“内部开单中心”独立入口，改为在现有工程流程上做“项目工单”。
- 已完成：
  - 回收上一轮新增的独立 `orders` 后端路由、前端“内部开单”菜单、订单列表/详情/表单组件和订单附件归属逻辑。
  - `projects` 增加门店/渠道交接字段：`order_taker`、`order_date`、`external_order_no`、`handover_note`；`source` 继续作为来源门店/渠道使用。
  - 工程列表和详情文案改为“项目工单/工单详情”，新建工单表单补充来源门店/渠道、门店接单人、接单日期、门店单号/合同号、交接备注。
  - 项目搜索支持来源、接单人、门店单号；文件中心和角色权限文案同步为“项目工单/工单附件”。
  - 启动时清理误加入的 `role_permissions.module = 'orders'` 权限行，避免权限页残留错误模块。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/projects.js`
  - `node --check backend/src/routes/files.js`
  - `node --check backend/src/routes/ai.js`
  - `node --check backend/src/routes/ai-permissions.js`
  - `node --check backend/src/utils/permissions.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 使用临时空库 `HOME=/private/tmp/jianshang-project-workorder-home PORT=3056 npm start` 实测：超级管理员登录成功；新建项目工单可保存来源门店、接单人、接单日期、门店单号和交接备注；详情读取正常；按门店单号搜索命中。临时后端已停止。
- 注意事项：
  - 这条记录覆盖上一条“内部开单中心 V1”的业务方向；技术上保留了有价值的字段/日志/附件思路，但不再另起订单模块。
  - 本次没有上传服务器。

### 2026-06-02 Codex 内部开单中心 V1

- 任务：按用户确认的 V1 计划新增“内部开单中心”，作为内部业务入口；工程订单保留为施工执行层。
- 已完成：
  - 后端新增 `orders / order_logs` 表、自动订单编号 `DD-YYYYMMDD-001`、订单列表/详情/创建/编辑/状态推进/创建关联工程接口。
  - 权限新增 `orders` 模块；普通员工只能看自己创建的订单，财务/仓库/工程按业务相关查看，管理员看全部。
  - 附件中心支持 `entity_type = order`，订单附件和统一文件中心都走同一套鉴权下载/删除。
  - 前端新增“内部开单”菜单、订单列表、订单详情、创建/编辑表单、订单附件、操作日志、创建工程入口。
  - 订单确认后普通员工不能修改客户、电话、地址、金额、施工/备货标记等关键字段；管理员可改但会写日志。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/orders.js`
  - `node --check backend/src/routes/files.js`
  - `node --check backend/src/utils/permissions.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 使用临时空库 `HOME=/private/tmp/jianshang-order-test-home PORT=3055 npm start` 实测：未登录 401；超级管理员登录成功；连续创建订单编号为 `DD-20260602-001/002`；手机号搜索命中；状态推进成功；需要施工订单可创建并关联工程；普通员工确认订单后修改金额返回 403。
- 注意事项：
  - 本次没有上传服务器。
  - V1 暂未做自动扣库存、自动生成交易流水、打印、飞书/企业微信通知和仪表盘统计。
  - 临时测试后端已停止；真实本地服务如已运行，需要重启后才会创建新表和新权限行。

### 2026-06-02 Codex AI 协作与安全开发守则

- 任务：用户确认多 AI 共享工作区开发已经暴露大量安全和质量问题，需要写一份更硬的协作/安全规则，给 Codex、Claude、Hermes 后续接手前阅读。
- 已完成：
  - `AGENTS.md` — 新增《简尚系统 AI 协作与安全开发守则》，覆盖多 AI 协作、权限与数据隔离、写入/删除/金额/状态、文件上传、AI 模块、前端体验、本地验证、部署红线、交付定义和危险信号暂停规则。
  - `AGENTS.md` — 明确三类 AI 岗位定位：Codex = 主工程师/视觉与交互负责人，Claude = 执行工程师/批量修复与部署负责人，Hermes = 安全审计官/质量稽核官；Hermes 默认产出审计报告，不直接做大规模功能开发。
  - `AGENTS.md` — 增加“石头、沙子、水”协作模型：Codex 先放主结构，Claude 填补批量缝隙，Hermes 最后渗透式审计；默认顺序为 Codex 主开发 → Claude 修补收口 → Hermes 审计遗漏 → Codex 复核 → 分批修复。
  - `CLAUDE.md` — 顶部增加“必须先读 `AGENTS.md`”提示，避免 Claude 只看旧项目说明。
- 注意事项：
  - 这是硬规则文件，不是功能代码；未上传服务器。
  - 后续每次较大任务结束，应检查是否有新红线或重复事故需要补进 `AGENTS.md`。

### 2026-06-02 Hermes（阿夕）P1 Bug 修复 + 数据校验加固

- 任务：Claude 已修完 P0 安全漏洞后，Hermes 接力修复剩余 P1 逻辑 Bug 和前端体验问题。
- 已完成：
  - `backend/src/routes/transactions.js` — 交易创建增加 type/amount/account 三重校验：type 必须是 income/expense、amount 必须为正数、account_id 必须存在；删除已取消交易时不再错误调整账户余额。
  - `backend/src/routes/accounts.js` — 删除账户前检查存在性；关联交易的 account_id 置为 NULL，避免孤儿数据污染财务报表。
  - `backend/src/routes/users.js` — 删除用户前检查是否存在，不存在返回 404 而非静默 success。
  - `frontend-new/src/router/index.js` — 路由守卫 catch 块从静默吞错改为清除损坏 token 并跳转登录页，避免格式损坏的 token 绕过鉴权。
  - `frontend-new/src/components/AiChat.vue` — loadHistory 后不再将 sessionId 清空为 null，改为从历史消息中提取 session_id 保持上下文连续。
  - `frontend-new/src/views/projects/ProjectList.vue` — 进度条从 `phase/5` 改为 `Math.min(phase/6, 100)`，修复 phase 6 时溢出 120%；删除失败时给用户明确错误提示。
  - `frontend-new/src/layouts/MainLayout.vue` — 登出时同步清除 localStorage 的 user，避免其他页面读到脏数据。
  - `frontend-new/src/views/chat/ChatIndex.vue` — socket 断线重连后自动 rejoin 当前会话房间，避免错过消息。
  - `frontend-new/src/views/finance/FinanceOverview.vue` — 账户汇总行从 `account_count` 改为 `tx_count`，匹配表格列的 prop，修复汇总行空白。
- 验证：
  - `node --check backend/src/routes/transactions.js` ✅
  - `node --check backend/src/routes/accounts.js` ✅
  - `node --check backend/src/routes/users.js` ✅
  - 前端 Vue 文件均为模板内简单修改（Math.min、localStorage.removeItem、socket.emit），不涉及组件结构变更。
- 注意事项：
  - 本次未启动后端做真实接口测试，未部署服务器。
  - 修复清单来自 Hermes 全栈审查（后端 48 + 前端 33 = 81 个问题），本次修了 10 个最高优先级的 P1 问题，剩余 60+ 低优/边角问题待后续分批处理。
  - 建议下次部署时把 Claude 的 P0 安全修复 + Hermes 的 P1 数据校验一起打包上线。

### 2026-06-02 Claude Hermes 安全审计修复

- 任务：按 Hermes 审计结果修复 P0-P1 安全漏洞和逻辑 Bug，说明根因和后续方向。
- 根因分析：
  - 系统从 MVP 快速迭代而来，早期"先跑通"阶段大量使用了宽松的安全策略（CORS `*`、无鉴权接口、无校验的 socket join）。
  - 权限模型是逐层追加的：先有 `authMiddleware`，后有 `role_permissions`，再到 `data_scope`，导致早期接口和后期功能之间的安全水位不一致。
  - AI 工具执行器没有继承路由层的权限校验，走的是一套独立的工具分发逻辑，形成了权限盲区。
- 已修复（P0 安全）：
  - `knowledge-base.js` — 知识库搜索增加 `authMiddleware`，未登录不可搜索内部文档。
  - `index.js` — Socket.io `join:conversation` 增加 `conversation_participants` 校验，不能加入非参与会话。
  - `ai.js` — `create_transaction` 和 `create_account` 增加 `canAccessModule()` 校验，AI 不能绕过模块权限写入。
  - `index.js` — CORS 从 `*` 改为白名单。
  - `auth.js` — 登录限流去掉 `x-forwarded-for` 回退，注册增加每 IP 每天 10 次上限。
- 后续改进方向：
  - **统一权限入口**：所有接口包括 AI 工具都应通过同一套 `requireModuleAccess()`。
  - **定期安全审计**：大版本前跑一次 Hermes/CodeQL。
  - **测试覆盖**：P0 安全路径应有自动化测试。
  - **JWT 轮换**：config.js 密钥轮转需优化，避免重启导致旧 token 全部失效。
- 验证：`node --check` 通过 4 个修改文件。
- 注意事项：未上传服务器，仍有 70+ 低优问题待分批处理。

### 2026-06-02 Claude Git 基线推送 + CodeGraph + 记忆备份

- 任务：把长期脏工作树推送到 GitHub 新仓库，安装代码图谱工具加速后续开发，备份 AI 记忆到独立仓库。
- 已完成：
  - 创建 GitHub 仓库 `Fuyulnk/jianshang-system`（私有），推送完整代码（31 个文件，含后端路由、前端视图、配置、脚本）；gitignore 已排除 node_modules/dist/.env/*.db。
  - 安装 `@colbymchenry/codegraph` 并在项目根目录初始化索引（53 文件 / 991 节点 / 2362 关系，2.25MB SQLite）；已配置为 MCP Server，重启后可用。
  - 创建 GitHub 仓库 `Fuyulnk/wangshu-memory`（私有），备份 Claude Code 记忆文件（17 个 markdown + 知识图谱 JSONL）。
- 注意事项：
  - 简尚系统代码仓库如需转为开源，等系统完善后再改可见性。
  - CodeGraph MCP Server 在 `.mcp.json` 中配置，重启 Claude Code 后自动加载，无需手动启动。

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
  - `ALIGNMENT.md` — 记录文件中心、财务月报、飞书 Base 字段参考和后续 `借款核销 / 报销审批 / 资金总览` 方向。
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
  - 正式纳入当前业务代码、`frontend-new/`、`backend/src/`、`CLAUDE.md`、`ALIGNMENT.md` 和 `handoff/` 交接文档。
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

### 2026-06-04 Codex

- 任务：项目工单状态机 V2 第一阶段，把“粗略施工阶段”改成总监流程步骤骨架。
- 修改文件：
  - `backend/src/routes/projects.js` — 新增总监流程状态机：门店交接待核对、待现场勘察、勘察完成待复尺、复尺完成待交底、交底完成待出库、已申请出库、已出库待进场、施工中、验收完成待回库、回库完成待工费结算、工费结算完成待成本核算、成本核算完成待财务结算、财务结算完成待归档、已归档；保留售后为独立事件；旧状态通过 alias 兼容显示和继续推进。
  - `backend/src/routes/material-requests.js` — 出库申请限制为“交底完成待出库”；申请后项目进入“已申请出库”；取消后无剩余申请则回退“交底完成待出库”；仓库确认后进入“已出库待进场”。
  - `backend/src/index.js` — 新建项目默认状态改为 `handover_received`。
  - `backend/src/routes/project-imports.js` — AI 导入确认创建的项目默认进入 `handover_received`。
  - `backend/src/routes/ai.js` — 简尚 AI 的项目状态标签、阶段筛选和 system prompt 同步新流程，明确不再使用“项目前期/准备阶段/施工执行”等旧口径。
  - `frontend-new/src/views/projects/ProjectList.vue` — 列表阶段筛选、统计卡和看板改成“交接勘察/复尺出库/施工验收/回库核算/财务归档/售后处理”。
  - `frontend-new/src/views/projects/ProjectDetail.vue` — 当前工作单按新状态展示当前步骤要填的内容；缺核心字段禁用推进并提示缺什么；阶段详情补齐财务归档卡片；出库面板只在正确阶段可用。
  - `frontend-new/src/components/material/MaterialRequestPanel.vue` — 新增阶段禁用提示，项目页不能在错误阶段发起出库申请。
- 验证：
  - `node --check backend/src/routes/projects.js`
  - `node --check backend/src/routes/material-requests.js`
  - `node --check backend/src/routes/ai.js`
  - `node --check backend/src/routes/project-imports.js`
  - `npm run build`（在 `frontend-new/`，构建成功；仍有 Vite chunk size 警告）
  - 已用 Google Chrome 登录本地 `http://127.0.0.1:5173/` 验证项目列表和详情页：旧项目状态已按新口径显示为“交接/勘察-门店交接待核对”；详情页阶段条为“交接勘察/复尺出库/施工验收/回库核算/财务归档/售后处理”；当前工作单能提示缺“门店接单人”并禁用推进；出库面板在未交底阶段显示禁用原因。
- 注意事项：
  - 本次未上传服务器。
  - 旧项目不会批量改库，列表/详情会按新口径显示；项目推进后会自然写入新状态。
  - 本地验证时重启过后端 `backend npm run dev`，因为旧 3001 进程还在跑旧代码；后续看页面前也要注意前后端都加载到最新代码。
  - 出库确认仍会真实扣库存，后续做端到端测试时优先用测试物料或临时项目，避免污染真实库存。
  - 下一阶段建议进入“总监表格字段映射 V2”：把勘察 PPT、施工交底单、材料出库表、班组工费结算单、完工成本核算表、财务结算附件逐步映射到项目工单字段和附件检查清单。

### 2026-06-05 Codex

- 任务：项目工单表格体验、供货单 V1 和完工闭环修复。
- 本轮实现：
  - 新增 `frontend-new/src/components/projects/DecimalCellInput.vue`，解决数量/金额输入吞小数点的问题。
  - 新增 `frontend-new/src/components/projects/SystemSheetTable.vue`，作为系统版表格编辑器：列宽可拖拽、列宽保存到 `localStorage`、表格滚动边界收在弹窗内。
  - `ProjectDocumentSummary.vue`：交底、材料、工费、成本等弹窗改用系统表格；材料出库/回库拆成总览、出库明细、回库明细、剩余/差异；成本核算恢复费用小记；财务归档继续只放收款/尾款/凭证状态，避免和成本表长得一样。
  - 工勘/验收节点补 `PPT可视图` 和 `上传PPT` 入口；任意 PPTX 仍只作为原始附件留存，系统版 PPT 草稿先以结构化数据承载。
  - 二次勘察改回真正按需：只有上传二次勘察表、首次工勘勾选需要复勘、或备注明确“需要复勘/二次”才计入待处理，不再被普通“复尺完成”误触发。
  - 产品库存扩展 `spec / unit_price / price_unit`，为材料自动匹配单位和单价做基础。
  - 新增供货单后端 `backend/src/routes/supply-orders.js` 和表结构：销售下单 -> 财务确认收款 -> 仓库订材料 -> 材料到位发货 -> 完结。
  - `ProjectSupplyList.vue` 从静态骨架改为真实 API 页面，支持新建、编辑、列表、搜索和按流程推进；本轮不扣库存。
  - `AttachmentPanel.vue` 上传/删除后向父级 emit `updated`；`ProjectDetail.vue` 收到后刷新详情和资料链，不需要退出重进。
  - 已归档工单人员状态显示为“已完工/已撤场”；售后区增加按验收/完工日期计算的 30 天质保提示，超过后隐藏“发起售后单”按钮。
- 验证：
  - `node --check backend/src/index.js`
  - `node --check backend/src/routes/supply-orders.js`
  - `node --check backend/src/routes/project-imports.js`
  - `node --check backend/src/routes/products.js`
  - `npm run build`（在 `frontend-new/`，成功；仍有 Vite 大 chunk 警告）
- 注意事项：
  - 本轮未上传服务器。
  - 供货单 V1 只做流程和日志，不自动扣库存，库存扣减必须等真实价格/库存规则再接。
  - 材料自动匹配目前按产品名精确匹配 `products.name`，后续真实仓库数据进库后再做同义词/规格/供应商价格体系。
  - PPT 可视图是系统版草稿，不是任意 PPTX 反向解析；上传的原始 PPTX 可追溯下载。
  - 如果继续做这一线，下一步建议：让 Hermes 审 `supply-orders.js` 权限/状态机，再用测试账号实测财务、仓库、普通员工的可见性。

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
  - `ALIGNMENT.md` — 本次对接记录
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

- 任务：读取项目结构，建立协作对接文件。
- 修改文件：`ALIGNMENT.md`
- 验证：已读取 `CLAUDE.md`、主要 package 配置、后端入口、权限/用户/角色路由、前端路由和主布局。
- 注意事项：
  - `CLAUDE.md` 写数据库位置是 `backend/data/jianshang.db`，但当前代码实际使用 `~/fuyulnk/jianshang.db`。
  - `backend/node_modules/.package-lock.json` 当前也处于 modified，不建议主动纳入功能改动。
