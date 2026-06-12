# 2026-06-10 Claude：现场图片交互增强 + 附件去重

## 任务
Codex 额度用完，用户要求增强 PPT 和勘察图片的交互体验。

## 改动

### 1. 图片拖拽排序
`frontend-new/src/components/projects/ProjectDocumentSummary.vue`
- 新增 `dragIndex` state、`onImageDragStart` / `onImageDragOver` / `onImageDrop` 事件
- 现场图片网格和 PPT 预览区都支持 HTML5 拖拽重排
- 拖拽时有视觉反馈（半透明 + 虚线框）
- 排序会更新 `activeData.survey.images`，保存单据后持久化

### 2. 悬浮交互 + 删除
- 图片 hover 时右上角出现操作按钮
- 现场图片区：`el-popover` 弹窗，支持切换缩略图尺寸（小/中/大）和删除
- PPT 预览区：hover 出现删除按钮，点击即删
- 删完自动更新，图片数为 0 时释放 ObjectURL

### 3. 缩略图尺寸切换
- 现场图片区标题栏新增下拉选择器（小图 100px / 中图 150px / 大图 220px）
- 动态改变 `grid-template-columns` 的 `minmax` 值

### 4. 追加上传不覆盖
`frontend-new/src/components/projects/ProjectDocumentSummary.vue`
- 新增 `sessionImageData` ref，累积存储本次编辑会话上传的所有图片 base64 数据
- 每次上传追加到累积数组，API 调用时发送全部图片
- 关闭弹窗时清空累积数据

### 5. PPT 可视化自适应 + 滚动
`frontend-new/src/components/projects/ProjectDocumentSummary.vue`
- `.ppt-preview` 加 `overflow: auto; max-height: 580px`，横竖滚动条
- `.ppt-slide` 去掉固定 `aspect-ratio` 和 `max-height`，随内容撑开
- `.ppt-slide-body` 从 `height: calc(100% - 46px)` 改为 `min-height: 260px`
- 图片 `.ppt-photo-img` 加 `max-height: 220px`，防止溢出
- 单张图片时自动 `grid-column: 1 / -1` 居中，`object-fit: contain`

### 6. 点击图片放大预览
- 新增 `previewImageUrl` / `previewImageVisible` state
- 点击 PPT 图片弹出预览弹窗
- `align-center` 居中，最大 82vw × 78vh，`object-fit: contain`

### 7. 后端附件去重
`backend/src/routes/project-imports.js`
- `buildDeliveryNode` 中附件过滤加 `Set` 去重，`linkedIds` 和正则匹配不会重复
- 防止同一个附件因为既在关联 ID 里又匹配文件名而出现两次

### 8. 前端附件去重 + 过滤
`frontend-new/src/components/projects/ProjectDocumentSummary.vue`
- 新增 `uniqAttachments` computed，按 `file.id` 去重
- 同时排除已作为现场图片展示的附件（`surveyImages().attachment_id`），避免"关联附件"和"现场图片"区域重复显示

## 验证
- `node --check backend/src/routes/project-imports.js` ✅
- `npm run build`（frontend-new/）✅，仅既有 Vite chunk 警告
- 构建产物已同步 `dist/` → `backend/public/` ✅
- 本轮未上传服务器

## 注意事项
- PPT 视图改为滚动模式后，无图片时显示 4 个占位框保持布局稳定
- `sessionImageData` 在 dialog 关闭时清空，不影响下次编辑
- 如果后续有更多图片操作（旋转、标注等），建议在 `surveyImages()` 的基础上扩展
