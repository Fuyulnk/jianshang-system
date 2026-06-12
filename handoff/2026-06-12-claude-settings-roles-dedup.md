# 2026-06-12 Claude：系统设置权限修正 + 角色徽章 + 文件中心去重

## 改动清单

### 1. 角色徽章
`frontend-new/src/layouts/MainLayout.vue`
- **超级管理员** — 金色渐变底 + 呼吸光晕动画 + 👑 皇冠跳动
- **管理员** — 紫色渐变底 + ⭐
- **财务** — 金色底 + 🪙 金币呼吸旋转
- 其他角色保持原样

### 2. 系统设置权限修正
`frontend-new/src/views/system/SystemSettings.vue`
- `filteredNav` 计算属性：非管理员只看到「个人资料 / 个性化 / 关于」三项
- `onMounted` 仅 admin 才拉取 AI 权限/用户管理等接口，避免 403 弹窗

`frontend-new/src/layouts/MainLayout.vue`
- 系统设置菜单移出 `v-if="isAdmin"`，所有角色可见
- 头部点击头像/用户名跳转到系统设置页

### 3. 员工管理删除按钮限权
`frontend-new/src/views/employees/EmployeeList.vue`
- 删除按钮加 `v-if="canManage"`（仅 super_admin / admin 可见）

### 4. 财务权限数据库修正
- 线上 DB 中 finance 角色对 employees 模块 `can_view=1`（应=0），已修正为 0
- 非管理员不再看到员工管理菜单

### 5. 文件中心去重
`backend/src/routes/files.js`
- 查询接口 `/api/files/recent` 按 `entity_type + entity_id + original_name` 去重
- 上传接口 `/api/files/upload` 同归属同名文件直接覆盖旧记录，不新增
- 已物理删除 14 条重复附件（项目 5 测试数据）

### 6. 线上修复
- `caiwu` 账号 `employee_id=0`，已通过 `from-user` 接口补绑员工档案（JS-LN777628）
- 前端构建已同步服务器

## 验证
- `node --check backend/src/routes/files.js` ✅
- `npm run build`（frontend-new/）✅
- 线上 `/health` OK，前端已同步

## 未做
- 角色徽章效果仅头部显示，其他页面（如员工列表、用户管理）的角色标签未统一美化
- 文件中心去重仅在接口层，未建数据库唯一索引（留了弹性）
