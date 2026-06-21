# 2026-06-17 项目收款单 / 出库导入 / 入账登记表闭环对接

## 本次目标

本轮不是做新方向，而是补真实流程发现的断点：

- 复尺后、出库前新增“项目结算收款单”节点。
- 财务根据工勘/复尺结果制作收款单，交总监打印签字，门店收取进场前 90% 后才能班组交底和出库。
- 二勘/复尺支持明确跳过，并留下原因、人员、时间。
- 材料出库支持导入草稿，导入后先检查匹配，不直接扣库存。
- 财务工作台新增“入账登记表”导入、单元格编辑和备注功能。
- 登录页和主布局做缩放/Windows 高度自适应处理。

## 已完成改动

### 1. 项目流程状态机

新增状态：

- `pre_entry_payment_pending`：待财务处理项目结算收款单。
- `payment_received`：进场款已收，待班组交底。

流程调整为：

`门店交底 -> 首次工勘 -> 复尺/跳过复尺 -> 项目结算收款单 -> 进场款已收 -> 班组交底 -> 材料出库 -> 进场施工 -> 验收 -> 回库 -> 工费 -> 成本 -> 财务归档`

兼容旧状态：

- `condition_met -> pre_entry_payment_pending`
- `team_assigned -> payment_received`

### 2. 项目结算收款单

新增 `project_payment_request` 单据类型。

已接入：

- 单据解析：支持读取真实 `项目结算收款单.xlsx`。
- 单据链节点：项目资料链显示“项目结算收款单”。
- 确认推进：确认 90% 进场款后推进到 `payment_received`。
- 归档检查：归档前要求存在该单据。
- 项目利润粗算：优先使用收款单金额作为合同/已收款依据。

注意：

- 修正了“90%”被误识别成 90 元的问题；现在比例本身不作为金额，拿不到金额时用合同金额自动计算 90% 和 10%。

### 3. 复尺跳过

新增接口：

- `POST /api/projects/:id/delivery-chain/survey-recheck/skip`

前端新增明亮按钮：

- “无需复尺，直接进入收款单”

规则：

- 只在 `survey_done` 节点显示。
- 必须填写不少于 6 个字的跳过原因。
- 会生成一条已确认的 `survey_recheck` 记录，并写入日志。
- 项目进入 `pre_entry_payment_pending`，不会直接跳到班组交底或出库。

### 4. 项目详情前端联动

已更新：

- 当前工作台文案区分复尺、收款单、班组交底。
- `recheck_done/pre_entry_payment_pending` 打开“项目结算收款单”。
- `payment_received` 才能进入班组交底。
- 必填字段加红星：首勘人员、工勘日期、工勘记录、复尺人员/记录、施工负责人、班组交底日期、开工/完工/验收等阻断字段。
- 新增“流程回溯”只读卡片，按单据链节点展示状态、版本、上传人和附件。

### 5. 材料出库导入草稿

新增接口：

- `POST /api/projects/:id/material-requests/import-draft`

规则：

- 只有 `briefing_done` 项目能导入出库草稿。
- 导入后只生成草稿，不扣库存。
- 自动匹配库存产品；未匹配项高亮。
- 提交材料出库单前，所有材料必须选到具体库存产品规格。

前端新增：

- 材料出库单左上方“导入出库单”按钮。
- 未匹配库存产品时，显示黄色警告和行级提示。

### 6. 财务入账登记表

新增数据库表：

- `finance_ledger_workbooks`
- `finance_ledger_sheets`
- `finance_ledger_cells`
- `finance_ledger_comments`
- `finance_ledger_logs`

新增接口：

- `GET /api/finance/ledger/workbooks`
- `GET /api/finance/ledger/workbooks/:id`
- `POST /api/finance/ledger/workbooks/import`
- `PUT /api/finance/ledger/cells/:id`
- `PUT /api/finance/ledger/comments`

新增前端页面：

- `/main/finance/ledger`
- 菜单名称：入账登记表

功能：

- 导入真实 `A2025年入账登记表.xlsx`。
- 保留工作表 tab。
- 保留单元格值。
- 保留原 Excel 备注。
- 右键单元格新增/编辑备注。
- 有备注的单元格有角标，鼠标悬浮显示备注。
- 空白单元格也可以创建值记录。

注意：

- 修正了 WPS 备注被 `xlsx` 读取成乱码的问题，明显乱码会转回中文。

### 7. AI / 解析耗时

已给实际门店交底导入入口 `/api/briefing-imports/parse` 增加耗时日志：

- 文件读取
- Excel 解析 / 文本解析
- 重复检查

同时旧 `/api/project-imports/parse` 已保留本地模板优先、AI 兜底，并记录耗时分段。

### 8. 登录页 / Windows 缩放

已调整：

- 登录页 `100vh` 改为 `100dvh`。
- 登录页允许纵向滚动，避免缩放后内容被裁。
- 左侧假层使用 `clamp()` 自适应宽高，不再无限放大。
- 主布局和 App 根节点也改为 `100dvh`，减少 Windows/浏览器缩放高度误差。

## 已验证

命令验证：

- `node --check backend/src/routes/project-imports.js`
- `node --check backend/src/routes/material-requests.js`
- `node --check backend/src/routes/finance.js`
- `node --check backend/src/routes/projects.js`
- `node --check backend/src/routes/ai.js`
- `node --check backend/src/routes/employee-dashboard.js`
- `node --check backend/src/ai/toolRegistry.js`
- `node --check backend/src/utils/projectDocumentImport.js`
- `node --check backend/src/index.js`
- `npm --prefix frontend-new run build`

真实文件冒烟：

- `项目结算收款单（墙固）-丽雅苑5栋16A刘总20260524QYF.xlsx`
  - 识别为 `项目结算收款单`
  - 合同金额：2000
  - 进场前 90%：1800
  - 尾款 10%：200

- `A2025年入账登记表.xlsx`
  - 识别到 5 个工作表。
  - 识别到 Excel 单元格备注。
  - 备注乱码转码样例已验证能还原为中文。

前端验证：

- `frontend-new` 构建通过。
- Vite 仍有 chunk 大小提示，这是已有大包提示，不是本轮新增阻断。

## 未做 / 待人工复测

本轮没有上传服务器、没有提交 git。

还需要人工在浏览器里复测：

- 登录页在 Safari/Chrome、不同缩放比例、Windows 浏览器下是否还会拉伸或遮挡。
- 财务账号是否能看到“导入门店交底单”和“入账登记表”。
- 工程账号能否跳过复尺并留下原因。
- 财务账号导入项目结算收款单后，确认 90% 进场款是否推进到 `payment_received`。
- `payment_received` 后工程是否能做班组交底。
- 材料出库导入后，未匹配规格是否无法提交。
- 入账登记表右键备注、悬浮备注、编辑值是否符合财务使用习惯。

## 后续建议

优先复测顺序：

1. 用财务账号导入门店交底单创建项目。
2. 用工程账号跑工勘，分别测“需要复尺”和“跳过复尺”两条路。
3. 用财务账号导入项目结算收款单，确认 90% 款项。
4. 用工程账号做班组交底。
5. 用仓库账号导入出库单草稿，手动匹配产品规格后提交。
6. 用财务账号导入入账登记表，测试备注功能。

如果复测通过，再交 Hermes 做权限和流程审计。
