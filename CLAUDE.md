# 简尚系统开发规范

接手本项目必须先读根目录 `AGENTS.md`。`AGENTS.md` 是多 AI 协作与安全开发硬规则，优先级高于本文件里的普通说明。

## 技术栈
- 前端：Vue 3 (Composition API) + Vite + Element Plus + Vue Router + Socket.io Client
- 后端：Node.js + Fastify (ESM) + better-sqlite3 + Socket.io + JWT
- 数据库：SQLite (`backend/data/jianshang.db`)
- 部署：阿里云 8.135.8.37:3000，PM2 管理

## 项目结构
- `frontend-new/` — 当前前端（不是 `frontend/`，那个已废弃）
- `backend/` — 后端入口 `src/index.js`，路由在 `src/routes/`
- 前端视图在 `src/views/`，按模块分目录

## 代码约定
- 后端 `type: "module"`，用 ESM import/export
- better-sqlite3 是同步 API，不用 await
- 路由文件遵循 Fastify plugin 模式
- 敏感操作（增删改）必须走 `requireAdmin()` 中间件
- UI 组件优先用 Element Plus，不要另装 UI 库
- 不做过度抽象，三个相似行不改写成抽象

## 当前状态
- AI 聊天（DeepSeek API）已集成，群聊 @AI 可用
- AI 工具权限已实现（角色矩阵预设 + 用户例外覆盖）
- AI 权限管理已并入系统设置
- 用户管理已并入系统设置
- 新用户入职向导已完成（欢迎→个人信息→选择岗位→AI偏好→完成）
- 设置页已整合个人资料（头像上传、修改密码）、AI 权限、用户管理
- 登录页支持注册账号
- 财务总览和员工工作台已接入
- 工程订单已补第一阶段试运行底座：负责人/施工负责人分配、后端权限校验、按分配过滤员工项目、流程顺序推进和关键必填校验
- 页面动画已优化（路由过渡、骨架屏）
- 员工页面可用，仓库/绩效模块待开发
- CI/CD 无，测试套件无，自动部署无

## 关键业务逻辑
- 用户注册后 `onboarding_done = 0`，登录弹出入职向导
- 老用户通过 `app_config` 迁移标记一次性打上 `onboarding_done = 1`
- 入职向导可选业务岗位：finance / warehouse / employee；不能自选 admin 或 super_admin
- 管理员角色只能由超管在系统设置 → 用户管理中分配
- 财务总览仅允许 super_admin / admin / finance 访问
- 工程订单后端必须强制校验权限；不要只靠前端隐藏按钮。普通员工只能看/处理自己创建、负责或施工负责的项目。
- 工程订单状态推进必须按既定流程顺序，不允许任意跳状态；关键节点需先补齐对应记录字段。
- AI 工具权限：先取角色预设 → 检查用户覆盖 → 取并集
- 数据库实际路径：`~/fuyulnk/jianshang.db`（非 `backend/data/`）

## 禁止
- 不要用 npm，用 pnpm（如果装了）或保持 npm
- 不要改 `frontend/` 旧前端
- 不要引入新依赖除非必要
- 不要改数据库结构手动验证，用 better-sqlite3 脚本
