# 2026-06-27 当前大目标对接：入账登记表 / AI / 群聊 / 文件中心 / 设置稳定性

## 背景

本轮是连续大目标，不是单点修复。用户已明确指出：目标推进过程中对接记录没有及时跟上。后续任何 agent 接手前，必须先读本文件和 `ALIGNMENT.md`，不要只根据代码 diff 猜测完成范围。

当前目标尚未完成；本文件是阶段性对接，不代表可以提交或上传。

## 当前目标范围

### 入账登记表

- 单元格样式：单格水平对齐、垂直对齐、填充颜色。
- 合并单元格：点到合并区域任意格时，样式必须写到主单元格，不能写到被覆盖格。
- 公式同步：至少支持 `SUM(range)`、四则运算、百分比、单元格引用；依赖格变化后显示值要跟随重算。
- 仍要保持：原 Excel 日期更易读、原格式导出、合并/拆开、备注、搜索、冻结、全屏填表等已有能力。

### UI / 稳定性

- 财务应收应付表继续确认可用性。
- 夜间主题必须可读，不能像盖灰纱。
- 非管理员、财务账号、Windows 浏览器不能因为主题或缓存状态白屏。

### AI

- AI 同步新业务接口。
- AI 可以调用内部工具，但写入类必须确认。
- AI 不得绕过权限，不得主动扩展到无关项目或无关财务数据。

### 群聊

- 群设置、邀请/移除成员、清空消息。
- 群昵称隔离、免打扰、置顶。
- 群头像、群名称编辑。
- 最近输入时间不能显示成 `00:00`。
- 财务群确认逻辑要能在群内闭环。

### 文件中心

- 权限隔离。
- 按项目 / 单据归档查看。
- 按日期、金额、人员搜索凭证或单据。

### 设置

- 手机绑定 / 换绑。
- AI 分身面板气泡、背景设置。
- 删除或隐藏无效知识库入口，避免员工误以为可用。

## 本阶段已完成的代码改动

### 入账登记表公式引擎可测试化

新增：

- `frontend-new/src/utils/financeLedgerFormula.js`
- `frontend-new/scripts/check-finance-ledger-formula.mjs`

能力：

- `computeFormulaValueMap(cells)`：根据当前单元格数据计算公式显示值。
- `evaluateFormula(formula, evaluateCell)`：支持 `SUM(range)`、单元格引用、四则运算、百分比。
- `formatLedgerDisplayText(value)`：统一日期和公式结果显示。
- `parseFormulaNumber(value)`：支持逗号数字、百分比、普通数字。

已验证：

- `SUM(B1:C1)`。
- `B1+C1*2`。
- 百分比计算。
- 修改依赖值后公式显示值变化。
- `SUM(B1:C2)`。
- `1/6/25` 等日期显示为 `2025/1/6`。

### 入账登记表合并格样式目标可测试化

新增：

- `frontend-new/src/utils/financeLedgerGrid.js`
- `frontend-new/scripts/check-finance-ledger-grid.mjs`

能力：

- `buildMergeOwnerMap(merges)`：建立合并区域覆盖格到主格的映射。
- `resolveLedgerCellTarget(row, col, mergeOwnerMap)`：点到合并覆盖格时，样式保存到左上角主格。
- `parseLedgerCellStyle(value)`：统一解析单元格样式，异常样式回退默认值。

意义：

- 修复“合并单元格里点不同位置，样式可能写到错误格子”的隐患。
- 给后续单格行高、列宽、对齐、颜色扩展留下可测试基础。

2026-06-27 追加加固：

- 页面读取单元格样式时也统一走合并主格解析，不只是在保存样式时解析主格。
- 新增 `resolveLedgerCellStyle(row, col, mergeOwnerMap, styleMap)`，确保合并覆盖格读取到主格的水平/垂直对齐和底色。
- `check-finance-ledger-grid.mjs` 已覆盖：`B2:C4` 合并后，读取 `C3` 样式会返回 `B2` 主格样式；非合并格仍返回默认样式。

### 前端页面接入

修改：

- `frontend-new/src/views/finance/FinanceLedger.vue`

已做：

- 公式显示逻辑从页面内联函数移到 `financeLedgerFormula.js`。
- 合并格目标解析从页面内联逻辑移到 `financeLedgerGrid.js`。
- `cellStyleMap`、`activeCellStyle`、`applySelectedCellStyle` 改为复用工具函数。
- 保留原页面交互，不额外重构 UI。

### AI 口径补漏

修改：

- `backend/src/routes/ai.js`
- `backend/src/services/businessFacts.js`

已做：

- `financeArapFacts` 过滤 `COALESCE(f.is_deleted, 0) = 0`，避免 AI 查询应收应付时返回页面里已经删除的事项。
- AI system prompt 不再声称“系统会自动搜索公司文档知识库”；当前口径改为：没有启用稳定公司文档知识库，只能依据系统工具、当前对话和用户提供资料回答。

注意：

- 这只是口径修正，不代表知识库功能已完成或已删除干净。
- 后端仍存在 `knowledge-base` 相关旧路由和设置状态接口，是否彻底移除需要单独评估影响面。

### 设置页手机号入口补漏

修改：

- `frontend-new/src/views/ProfilePage.vue`
- `frontend-new/src/views/system/SystemSettings.vue`

已做：

- 个人设置和系统设置里的手机号按钮不再固定显示“保存手机号”。
- 已有手机号时显示“更改手机号”，没有手机号时显示“绑定手机号”。
- 复用现有 `/api/profile` 后端保存逻辑，没有新增接口。

### npm 检查脚本

修改：

- `frontend-new/package.json`

新增：

- `npm --prefix frontend-new run check:ledger-formula`
- `npm --prefix frontend-new run check:ledger-grid`
- `npm --prefix frontend-new run check:ledger`

## 已执行验证

已通过：

- `npm --prefix frontend-new run check:ledger`
- `npm --prefix frontend-new run build`
- `node --check backend/src/routes/finance.js`
- `node --check backend/src/services/businessFacts.js`
- `node --check backend/src/routes/ai.js`
- 内存 SQLite 冒烟：`financeArapFacts` 插入 1 条正常应收 + 1 条已删除应收，只返回正常应收。
- `git diff --check`
- 2026-06-27 追加验证：手机号入口和 AI 口径小改后，再次通过 `node --check backend/src/routes/ai.js`、`npm --prefix frontend-new run build`、`git diff --check`。

说明：

- `npm run build` 成功，仍有既有 Vite 大 chunk 提醒。
- 没有做真实浏览器交互验证。
- 没有做 Windows 环境验证。
- 没有上传服务器。
- 没有提交 Git。

## 当前工作树提醒

截至本文件创建时，预计未提交文件包括：

- `ALIGNMENT.md`
- `backend/src/routes/ai.js`
- `backend/src/services/businessFacts.js`
- `frontend-new/package.json`
- `frontend-new/src/views/ProfilePage.vue`
- `frontend-new/src/views/finance/FinanceLedger.vue`
- `frontend-new/src/views/system/SystemSettings.vue`
- `frontend-new/scripts/check-finance-ledger-formula.mjs`
- `frontend-new/scripts/check-finance-ledger-grid.mjs`
- `frontend-new/src/utils/financeLedgerFormula.js`
- `frontend-new/src/utils/financeLedgerGrid.js`
- `handoff/2026-06-27-active-goal-ledger-ai-chat-filecenter-v1.md`

后续接手前请重新运行：

```bash
git status --short
```

## 尚未完成 / 不要误判完成

### 入账登记表

- 真实页面里逐格设置水平/垂直对齐、背景色的完整交互还没有做完最终人工验收。
- 单行/单列手动拖拽行高列宽还没有完成最终方案。
- 公式目前是轻量显示层，不是完整 Excel 公式引擎。
- 公式是否要写回导出文件，仍需确认业务口径；当前重点是系统内显示和依赖重算。
- 数据库清理还没做。

### UI / 稳定性

- 非管理员白屏、财务账号主题缓存、Windows 浏览器表现仍需真实账号复测。
- 夜间主题可读性仍需人工视觉判断。

### AI

- 新 API 工具同步和确认链路尚未完成。
- 不要宣称 AI 已经具备完整内部 Agent 能力。
- 2026-06-27 追加修复：`financeArapFacts` 已补 `COALESCE(f.is_deleted, 0) = 0`，避免 AI 查询应收应付时返回页面里已经删除的事项。
- 2026-06-27 追加修复：AI prompt 已移除“自动搜索知识库”假口径，但旧知识库接口和设置状态入口仍未彻底清理。

### 群聊

- 群设置、成员管理、清空信息、昵称隔离、置顶免打扰等尚未完成。

### 文件中心

- 权限隔离和按项目/单据归档搜索需要继续做接口级验证。

### 设置

- 手机绑定/换绑的基础入口已补“绑定/更改手机号”文案，但未做短信验证码、换绑确认、绑定历史或安全校验增强。
- AI 面板气泡背景尚未完成。
- 隐藏无用知识库入口尚未完成；目前只修了 AI 不再假称自动读取知识库。

## 当前目标完成度粗分

- 已有可验证进展：入账登记表公式显示层、合并格样式目标、AI 应收应付删除过滤、AI 知识库口径、手机号按钮文案。
- 已有现成实现但仍需复测：群设置抽屉、财务群最近录入确认、最近输入时间避开 `00:00`、个人资料手机号保存接口。
- 仍未真正闭环：真实浏览器全流程验收、Windows/财务账号白屏复测、群聊清空/成员邀请权限细节、文件中心权限与搜索、AI 工具同步、AI 面板气泡背景、无用知识库入口清理、数据库清理。

## 下一步建议顺序

1. 先完成入账登记表 V2 剩余闭环：单格样式完整交互、合并格样式写入验证、手动拖拽行高/列宽方案。
2. 做真实页面轻量冒烟：导入 `A2025年入账登记表.xlsx`，测合并格样式、备注、公式显示、日期显示、全屏填表。
3. 处理非管理员白屏和主题缓存稳定性：财务账号、普通员工账号、Windows 浏览器优先复测。
4. 再推进群聊和文件中心：先后端权限和数据结构，再前端交互。
5. 最后同步 AI 工具和设置项。

## 协作提醒

- 不要每改一个小 UI 就全量重测；按影响面做增量验证。
- 表格视觉细节优先交给用户人眼判断，agent 只保证能打开、能点、无明显遮挡、构建通过。
- 涉及金额、权限、库存、项目状态机时，必须让 Hermes 或低成本 agent 做权限/安全复查。
- 当前未完成目标不要提交、不要上传，除非用户明确要求。
