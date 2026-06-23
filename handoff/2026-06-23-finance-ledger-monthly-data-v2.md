# 2026-06-23 财务月份数据与入账登记表 V2 对接

## 本次完成

- 修正飞书交易流水导入口径：
  - 手工新增流水仍要求金额为正数。
  - 飞书导入允许“收入冲正 / 支出冲正”的 signed amount。
  - 正数支出不再跳过，会作为支出冲正参与账户余额和月度支出计算。
- 新增可重复执行脚本：
  - `backend/scripts/rebuild-finance-data.mjs`
  - 用法：`node backend/scripts/rebuild-finance-data.mjs --db <jianshang.db> --workbook <4月.xlsx> --workbook <5月.xlsx> --user-id 1`
  - 作用：重建指定工作簿月份的交易流水，导入资金总览快照，并把账户当前余额锁到最新月末余额。
- 本地已导入 4 月/5 月财务数据：
  - 4 月流水：297 条；收入 1,024,845.45；支出 1,006,185.28；月末余额 64,008.12。
  - 5 月流水：272 条；收入 700,166.92；支出 687,388.60；月末余额 76,786.44。
  - 4 月/5 月资金总览公式差异均为 0。
- 入账登记表优化：
  - 前端详情增加缓存，避免点击/切换反复刷新。
  - 增加全屏填表、放大、缩小、删除、原格式导出。
  - 强化横向滚动、边框、光标颜色、选区颜色。
  - 日期显示为 `YYYY年MM月DD日`。
  - 后端新增 `DELETE /api/finance/ledger/workbooks/:id` 删除导入记录和保存的源文件。

## 源文件

- 4 月完整表：`/Users/fuyulnk./Downloads/简尚财务管理系统.xlsx`
- 5 月完整表：`/Users/fuyulnk./Downloads/简尚财务管理系统 5月-2.xlsx`

## 验证

- `node --check backend/src/routes/accounts.js`
- `node --check backend/src/routes/transactions.js`
- `node --check backend/src/routes/finance.js`
- `node --check backend/src/services/financeCommands.js`
- `node --check backend/scripts/rebuild-finance-data.mjs`
- `npm --prefix frontend-new run build`
- 临时库重建验证：
  - `snap|2026-04|12|45347.95|1024845.45|1006185.28|64008.12`
  - `snap|2026-05|12|64008.12|700166.92|687388.6|76786.44`
  - `tx|2026-04|297|1024845.45|1006185.28`
  - `tx|2026-05|272|700166.92|687388.6`

## 注意

- 交易流水里的 signed amount 只给飞书导入/重建脚本使用；普通员工手工录入不允许负数金额。
- 账户页资金总览优先显示 `account_monthly_snapshots` 快照，这是和飞书资金总览保持一致的事实源。
- 若后续要导入 6 月，也应先确认完整工作簿包含 `收支明细表` 和 `资金总览表`，再用同一脚本或页面导入。
