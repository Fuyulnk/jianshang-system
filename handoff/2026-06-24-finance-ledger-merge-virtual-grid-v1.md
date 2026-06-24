# 2026-06-24 入账登记表合并单元格与虚拟表格 V1

## 背景

财务入账登记表已支持 Excel 导入、备注和原格式导出，但页面仍接近整表渲染，滑动和全屏填写体验偏重；同时缺少合并/拆开单元格能力，和原 Excel 使用习惯不一致。

## 本轮改动

- 新增 `finance_ledger_merges` 数据表，记录每个工作表的合并区域。
- Excel 导入时读取 `sheet['!merges']`，把原表合并区域落库。
- 入账登记表接口返回当前工作表的 `merges`。
- 新增接口：
  - `PUT /api/finance/ledger/merges`：合并选中区域。
  - `DELETE /api/finance/ledger/merges`：拆开当前单元格所在合并区域。
- 原格式导出时把数据库里的合并区域写回 xlsx；如果某个工作表合并区域被全部拆开，导出时也会清掉原 Excel 里的合并。
- 前端 `FinanceLedger.vue` 从 `<table>` 渲染改为虚拟网格：滚动条仍代表完整表格，但 DOM 只渲染当前可视区域附近的单元格。
- 前端新增：
  - 单元格点击选择。
  - Shift 点击扩展选择区域。
  - `合并单元格` / `拆开单元格` 按钮。
  - 全屏填写模式按钮区压缩修复，表格区域高度放大。

## 文件范围

- `backend/src/index.js`
- `backend/src/db/migrations/v2-schema-cleanup.js`
- `backend/src/routes/finance.js`
- `backend/src/utils/xlsxTemplateExport.js`
- `frontend-new/src/views/finance/FinanceLedger.vue`

## 验证

- `node --check backend/src/routes/finance.js`
- `node --check backend/src/utils/xlsxTemplateExport.js`
- `node --check backend/src/index.js`
- `node --check backend/src/db/migrations/v2-schema-cleanup.js`
- `npm --prefix frontend-new run build`
- 用临时 Node 脚本验证 `patchXlsxCells` 可保留、清除 xlsx 合并区域。

## 注意事项

- 本轮未提交、未上传服务器。
- 未做线上登录冒烟检查；原因是本轮是在本地代码完成，用户未要求立即部署，且当前对话重点是实现和本地验证。
- 合并区域目前采用保守规则：新合并不能和已有合并区域重叠，必须先拆开旧区域。
- 前端选择方式是 V1：点击一个格子，再 Shift 点击另一个格子形成矩形区域。

## 后续建议

- Hermes 重点审 `finance_ledger_merges` 的迁移幂等性、合并重叠判断和原格式导出。
- 若财务后续要求更像 Excel，可再补拖拽框选、键盘方向键和复制粘贴。
