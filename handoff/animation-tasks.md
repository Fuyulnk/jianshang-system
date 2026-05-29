# 动画优化任务（Codex）

## 交易流水折叠动画
- 状态：已由 Codex 在 2026-05-28 处理，见 `frontend-new/src/views/transactions/TransactionList.vue`。
- 文件：`frontend-new/src/views/transactions/TransactionList.vue`
- 当前：每个账户是一个卡片组，点击头部展开/折叠显示该账户的交易
- 折叠动画目前只有简单的 opacity + translateY 过渡，不够流畅
- 需要：优化展开/折叠动画，让列表展开时有平滑的高度过渡效果，不要生硬闪烁

## 现有页面动画效果
- MainLayout.vue 已有路由过渡 `<transition name="page">`（opacity + translateY）
- 骨架屏已用于账户/交易/产品列表页
- 卡片 hover 微上浮 + 阴影变化

## 要求
- 使用 Element Plus 自带过渡或纯 CSS transition
- 不要引入额外动画库
- 重点是折叠面板的高度过渡动画
