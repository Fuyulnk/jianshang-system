<template>
  <div class="workorder-home">
    <div class="home-header">
      <div>
        <h2>项目工单</h2>
        <p>先选择业务类型。施工项目和项目供货是两条流程，财务、仓库和工程看到的重点不同。</p>
      </div>
    </div>

    <div class="branch-grid">
      <article class="branch-card construction" @click="router.push('/main/projects/construction')">
        <div class="branch-kicker">施工承接</div>
        <h3>施工项目工单</h3>
        <p>门店/渠道签单后，由简尚承接勘察、交底、出入库、施工、验收、核算和归档。</p>
        <div class="branch-flow">
          <span>交底</span>
          <span>工勘</span>
          <span>出库</span>
          <span>施工</span>
          <span>核算</span>
          <span>归档</span>
        </div>
        <el-button type="primary">进入施工项目</el-button>
      </article>

      <article class="branch-card supply" @click="router.push('/main/projects/supply')">
        <div class="branch-kicker">供货发货</div>
        <h3>项目供货单</h3>
        <p>只做材料供货和发货闭环，不进入施工交付资料链。财务先确认收款，仓库再订料和发货。</p>
        <div class="branch-flow">
          <span>销售下单</span>
          <span>财务收款</span>
          <span>仓库订料</span>
          <span>到位发货</span>
          <span>完结</span>
        </div>
        <el-button class="supply-entry-button">进入项目供货</el-button>
      </article>
    </div>
  </div>
</template>

<script setup>
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<style scoped>
.workorder-home {
  display: grid;
  gap: 18px;
}

.home-header h2 {
  margin: 0 0 6px;
  font-size: 24px;
}

.home-header p {
  margin: 0;
  color: var(--text-secondary);
}

.branch-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.branch-card {
  display: flex;
  flex-direction: column;
  min-height: 280px;
  padding: 22px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  box-shadow: var(--shadow-sm);
  cursor: pointer;
  transition: transform 0.18s ease, box-shadow 0.18s ease, border-color 0.18s ease;
}

.branch-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.branch-card.construction:hover {
  border-color: color-mix(in srgb, var(--color-primary) 36%, var(--border-light));
}

.branch-card.supply:hover {
  border-color: color-mix(in srgb, #10b981 36%, var(--border-light));
}

.branch-kicker {
  width: fit-content;
  padding: 4px 8px;
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--color-primary) 10%, var(--bg-page));
  color: var(--color-primary);
  font-size: 12px;
  font-weight: 800;
}

.branch-card.supply .branch-kicker {
  background: color-mix(in srgb, #10b981 12%, var(--bg-page));
  color: #059669;
}

.branch-card h3 {
  margin: 16px 0 8px;
  font-size: 22px;
}

.branch-card p {
  min-height: 52px;
  margin: 0;
  color: var(--text-secondary);
}

.branch-flow {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 22px 0;
}

.branch-flow span {
  padding: 6px 9px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-xs);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 700;
}

.branch-card .el-button {
  width: fit-content;
  margin-top: auto;
}

.supply-entry-button {
  border: none !important;
  background: #10b981 !important;
  color: #fff !important;
}

.supply-entry-button:hover {
  background: #059669 !important;
  box-shadow: 0 4px 14px rgba(16, 185, 129, 0.28) !important;
  transform: translateY(-1px);
}

@media (max-width: 860px) {
  .branch-grid {
    grid-template-columns: 1fr;
  }
}
</style>
