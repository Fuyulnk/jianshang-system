# 2026-06-18 原表格格式导出 V1 对接

## 本次目标

把“导出必须以真实业务表格为原型”落成系统底座。系统不再把 Excel 导出理解成重新拼一张数据表，而是优先以原始 xlsx/模板文件为底稿，写回系统字段后导出。

## 已完成

### 1. XLSX 原格式补丁器

新增：

- `backend/src/utils/xlsxTemplateExport.js`

能力：

- 读取原始 `.xlsx` 文件包。
- 只改指定单元格。
- 其他工作簿结构、样式、边框、列宽、行高、合并单元格、打印设置、图片等保持原文件内容。
- 支持按工作表名/索引和单元格地址写入。
- 支持按表格里的标签查找单元格，并写入标签右侧单元格。

说明：

- 这是“系统负责填表，模板负责格式”的底层机制。
- 第一阶段只支持 `.xlsx`，旧 `.xls` 需要另存为 `.xlsx` 后再导入。

### 2. 模板库数据表预留

在 `backend/src/index.js` 新增：

- `document_templates`
- `document_template_mappings`
- `document_exports`

同时为 `finance_ledger_workbooks` 增加：

- `source_file_path`

用途：

- 后续每类单据都可以登记标准模板版本。
- 字段映射可以从“系统字段 -> Excel 单元格”独立维护。
- 导出行为留日志，能追溯谁导出、哪个项目、哪类单据。

### 3. 入账登记表原格式导出

修改：

- `backend/src/routes/finance.js`
- `frontend-new/src/views/finance/FinanceLedger.vue`

实现：

- 导入入账登记表时保存原始 Excel 文件副本到后端受控目录 `backend/data/finance-ledgers/`。
- 新增接口：`GET /api/finance/ledger/workbooks/:id/export`
- 前端新增“导出原格式”按钮。
- 导出时从原始文件副本出发，把系统里保存的单元格值写回原表。

权限：

- 仍然走财务权限：`super_admin / admin / finance`。
- 原文件不放 public，导出必须走鉴权接口。

### 4. 项目资料链原格式导出

修改：

- `backend/src/routes/project-imports.js`
- `frontend-new/src/components/projects/ProjectDocumentSummary.vue`

实现：

- 新增接口：`GET /api/projects/:id/delivery-chain/:type/export`
- 项目资料链中，有 `.xlsx` 原始附件的节点显示“导出原格式”按钮。
- 当前重点支持 `project_payment_request` 项目结算收款单。
- 导出时根据原表中的标签，如客户姓名、电话、地址、合同金额、90%进场款、10%尾款等，写入标签右侧单元格。

限制：

- 如果该节点没有原始 `.xlsx` 附件，会提示先上传原表格或配置模板。
- 旧 `.xls` 暂不做原格式写回，需要先另存为 `.xlsx`。

## 已验证

- `node --check backend/src/utils/xlsxTemplateExport.js`
- `node --check backend/src/routes/finance.js`
- `node --check backend/src/routes/project-imports.js`
- `node --check backend/src/index.js`
- `npm --prefix frontend-new run build`

真实 xlsx 冒烟：

- `A2025年入账登记表.xlsx`：补丁写入后可读回。
- `项目结算收款单（墙固）-丽雅苑5栋16A刘总20260524QYF.xlsx`：补丁写入后可读回。

## 未完成 / 注意事项

- 第一阶段没有把系统新增/编辑的网页备注写回 Excel 原生批注。原文件里已有批注会因为未改相关 XML 而保留；但系统新加的备注仍只在系统数据库里。
- 还没做模板库管理界面。
- 还没做字段映射编辑界面。
- 还没给门店交底单、工勘表、复尺表、出库单、回库单、工费表、成本表、财务结算凭证逐张配置正式模板映射。
- 本轮未提交，未上传服务器。

## 下一步建议

1. 用财务账号重新导入一份 `.xlsx` 入账登记表，测试“导出原格式”。
2. 用项目结算收款单原件导入并保存到项目资料链，测试“导出原格式”。
3. 做模板库 V1 页面：上传模板、选择单据类型、填写字段映射。
4. 再补 Excel 原生批注写回，优先处理入账登记表的右键备注。
