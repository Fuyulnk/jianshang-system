<template>
  <Transition name="onboarding">
    <div v-if="visible" class="onboarding-overlay">
      <div class="onboarding-card">
        <!-- 步骤指示器 -->
          <el-steps :active="step" align-center finish-status="success" class="steps-bar">
            <el-step title="欢迎" />
            <el-step title="个人信息" />
            <el-step title="AI 偏好" />
            <el-step title="完成" />
          </el-steps>

        <div class="step-body">
          <Transition name="step" mode="out-in">
            <!-- Step 0: 欢迎 -->
            <div v-if="step === 0" key="welcome" class="step-content welcome-step">
              <div class="welcome-icon">
                <span class="welcome-emoji">👋</span>
              </div>
              <h2>欢迎加入简尚系统</h2>
              <p class="welcome-desc">先确认你的岗位和今日入口，后面只需要补个人资料和 AI 偏好</p>
              <div class="guide-panel">
                <div class="guide-role">
                  <span>当前岗位</span>
                  <strong>{{ roleGuide.label }}</strong>
                </div>
                <div class="guide-cards">
                  <div v-for="item in roleGuide.entries" :key="item.title" class="guide-card">
                    <strong>{{ item.title }}</strong>
                    <span>{{ item.desc }}</span>
                  </div>
                </div>
              </div>
              <el-button type="primary" size="large" @click="step = 1" class="welcome-btn">开始配置</el-button>
            </div>

            <!-- Step 1: 个人信息 -->
            <div v-else-if="step === 1" key="info" class="step-content">
              <h3>填写个人信息</h3>
              <p class="step-desc">方便同事认识你</p>
              <div class="info-form">
                <el-form label-width="80px">
                  <el-form-item label="真实姓名">
                    <el-input v-model="profile.name" placeholder="你的名字" maxlength="20" />
                  </el-form-item>
                  <el-form-item label="手机号">
                    <el-input v-model="profile.phone" placeholder="选填" maxlength="11" />
                  </el-form-item>
                  <el-form-item label="部门职位">
                    <div class="locked-profile-field">
                      {{ profile.department || '未填写' }} / {{ profile.position || '未填写' }}
                    </div>
                  </el-form-item>
                </el-form>
              </div>
            </div>

            <!-- Step 2: AI 偏好 -->
            <div v-else-if="step === 2" key="ai" class="step-content">
              <h3>AI 偏好设置</h3>
              <p class="step-desc">岗位和业务权限将由超级管理员分配</p>
              <div class="ai-prefs">
                <div class="pref-item">
                  <div class="pref-info">
                    <span class="pref-label">AI 桌宠</span>
                    <span class="pref-desc">在界面右下角显示可拖拽的 AI 助手</span>
                  </div>
                  <el-switch v-model="prefs.pet_enabled" />
                </div>
                <div class="pref-item">
                  <div class="pref-info">
                    <span class="pref-label">自动查数据</span>
                    <span class="pref-desc">AI 可主动查询系统中的数据回答问题</span>
                  </div>
                  <el-switch v-model="prefs.auto_query" />
                </div>
                <div class="pref-item">
                  <div class="pref-info">
                    <span class="pref-label">AI 名称</span>
                    <span class="pref-desc">你的 AI 助手的称呼</span>
                  </div>
                  <el-input v-model="prefs.ai_name" placeholder="简尚小助手" style="width: 200px" />
                </div>
              </div>
            </div>

            <!-- Step 3: 完成 -->
            <div v-else key="done" class="step-content done-step">
              <div class="done-icon">✅</div>
              <h2>配置完成！</h2>
              <p class="step-desc">你的账号已配置好，可以开始使用简尚系统了</p>
              <div class="done-summary">
                <div class="summary-item">
                  <span class="summary-label">岗位</span>
                  <span class="summary-value">{{ roleGuide.label }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">今日入口</span>
                  <span class="summary-value">{{ roleGuide.primaryEntry }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">姓名</span>
                  <span class="summary-value">{{ profile.name || '未填写' }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">部门职位</span>
                  <span class="summary-value">{{ profile.department || '未填写' }} / {{ profile.position || '未填写' }}</span>
                </div>
                <div class="summary-item">
                  <span class="summary-label">AI 桌宠</span>
                  <span class="summary-value">{{ prefs.pet_enabled ? '已启用' : '已关闭' }}</span>
                </div>
              </div>
            </div>
          </Transition>
        </div>

        <!-- 底部按钮 -->
        <div class="step-footer">
          <el-button v-if="step > 0 && step < 3" text @click="step--">上一步</el-button>
          <div style="flex:1" />
          <el-button v-if="step > 0 && step < 2" type="primary" @click="step++">下一步</el-button>
          <el-button v-if="step === 2" type="primary" @click="finish">完成配置</el-button>
          <el-button v-if="step === 3" type="primary" @click="done">开始使用</el-button>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script setup>
import { getAuthToken } from '../utils/authSession'
import { computed, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'

const props = defineProps({
  visible: { type: Boolean, default: false },
  user: { type: Object, default: () => ({}) }
})
const emit = defineEmits(['done'])

const step = ref(0)
const profile = ref({ name: '', phone: '', department: '', position: '' })
const prefs = ref({ pet_enabled: true, auto_query: true, ai_name: '简尚小助手' })
const roleGuides = {
  super_admin: {
    label: '超级管理员',
    primaryEntry: '控制台 / 系统设置',
    entries: [
      { title: '先看待分配账号', desc: '新员工注册后，在系统设置的用户管理里绑定档案、分配角色并激活。' },
      { title: '再看卡住事项', desc: '管理视角重点处理缺资料、超期、库存和财务结算异常。' }
    ]
  },
  admin: {
    label: '管理员',
    primaryEntry: '控制台 / 系统设置',
    entries: [
      { title: '处理账号和资料', desc: '协助分配人员、检查员工档案和项目资料完整性。' },
      { title: '跟进异常工单', desc: '优先看管理待办，处理卡住的项目。' }
    ]
  },
  engineering: {
    label: '工程/监理',
    primaryEntry: '工作台 / 项目工单',
    entries: [
      { title: '先看工程待办', desc: '首勘、复尺、交底、施工中和收尾验收都从工作台进入。' },
      { title: '资料先补齐', desc: '现场图片、日期、记录缺失时，系统会阻止推进到下一步。' }
    ]
  },
  warehouse: {
    label: '仓库',
    primaryEntry: '工作台 / 产品库存',
    entries: [
      { title: '先看待出库和待回库', desc: '按项目材料单确认出库，回库时记录实际用量和差异原因。' },
      { title: '库存按规格看', desc: '同名材料要看规格，比如霞光沙 1L 和霞光沙 5L 是两条库存。' }
    ]
  },
  finance: {
    label: '财务',
    primaryEntry: '工作台 / 财务总览',
    entries: [
      { title: '先看财务池待办', desc: '待工费、待成本、待财务结算，两位财务都能看到。' },
      { title: '金额必须确认', desc: 'AI 可以生成草稿，真正写入流水或结算必须人工确认。' }
    ]
  },
  employee: {
    label: '员工',
    primaryEntry: '工作台',
    entries: [
      { title: '先看工作台', desc: '系统会按你的岗位显示相关待办，不需要到处找入口。' },
      { title: '遇到缺权限找管理员', desc: '账号、岗位和可见项目由管理员统一分配。' }
    ]
  }
}
const roleGuide = computed(() => roleGuides[props.user?.role] || {
  label: props.user?.role_label || props.user?.role || '员工',
  primaryEntry: '工作台',
  entries: roleGuides.employee.entries
})

watch(
  () => props.user,
  (user) => {
    profile.value = {
      name: user?.real_name || '',
      phone: user?.phone || '',
      department: user?.department || '',
      position: user?.position || ''
    }
    prefs.value = {
      pet_enabled: user?.ai_pet_enabled !== 0,
      auto_query: user?.ai_auto_query !== 0,
      ai_name: user?.ai_name || '简尚小助手'
    }
  },
  { immediate: true }
)

function token() { return getAuthToken() }

async function finish() {
  try {
    const body = { profile: profile.value, prefs: prefs.value }
    const res = await fetch('/api/profile/onboarding', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify(body)
    })
    const json = await res.json()
    if (!json.success) {
      ElMessage.error(json.message || '保存配置失败')
      return
    }
    step.value = 3
  } catch {
    ElMessage.error('保存配置失败')
  }
}

function done() {
  const aiName = prefs.value.ai_name || '简尚小助手'
  const hidden = !prefs.value.pet_enabled
  localStorage.setItem('ai-pet-hidden', hidden ? 'true' : 'false')
  localStorage.setItem('ai-name', aiName)
  window.dispatchEvent(new CustomEvent('ai-pet-settings', { detail: { hidden, aiName } }))
  emit('done')
}
</script>

<style scoped>
.onboarding-overlay {
  position: fixed;
  inset: 0;
  z-index: 100000;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
}
.onboarding-card {
  width: 520px;
  max-height: 90vh;
  background: var(--bg-card);
  border-radius: var(--radius-xl);
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.35);
  padding: 40px 36px 24px;
  display: flex;
  flex-direction: column;
}
.steps-bar { margin-bottom: 32px; }
.step-body { flex: 1; min-height: 260px; }
.step-content { text-align: center; }

.welcome-step { padding: 20px 0; }
.welcome-icon { margin-bottom: 20px; }
.welcome-emoji { font-size: 64px; line-height: 1; }
.welcome-step h2 { font-size: 24px; font-weight: 700; color: var(--text-primary); margin: 0 0 8px; }
.welcome-desc { font-size: 15px; color: var(--text-tertiary); margin: 0 0 28px; }
.welcome-btn { min-width: 160px; height: 44px; font-size: 15px; }

.guide-panel {
  max-width: 430px;
  margin: 0 auto 26px;
  padding: 16px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: var(--bg-page);
  text-align: left;
}

.guide-role {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  margin-bottom: 12px;
}

.guide-role span {
  font-size: 12px;
  color: var(--text-tertiary);
}

.guide-role strong {
  padding: 4px 10px;
  border-radius: 999px;
  background: var(--color-primary-bg);
  color: var(--color-primary);
  font-size: 13px;
}

.guide-cards {
  display: grid;
  gap: 10px;
}

.guide-card {
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--bg-card);
  border: 1px solid var(--border-light);
}

.guide-card strong {
  display: block;
  margin-bottom: 4px;
  color: var(--text-primary);
  font-size: 14px;
}

.guide-card span {
  display: block;
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.6;
}

.step-content h3 { font-size: 18px; font-weight: 600; color: var(--text-primary); margin: 0 0 4px; }
.step-desc { font-size: 14px; color: var(--text-tertiary); margin: 0 0 24px; }

.info-form {
  max-width: 380px;
  margin: 0 auto;
  text-align: left;
}

.locked-profile-field {
  width: 100%;
  min-height: 36px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  border-radius: 6px;
  color: var(--text-secondary);
  background: var(--bg-page);
  border: 1px solid var(--border-color);
}

.role-cards {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  max-width: 440px;
  margin: 0 auto;
}
.role-card {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px;
  border: 2px solid var(--border-light);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
  text-align: left;
}
.role-card:hover {
  border-color: var(--color-primary);
  background: rgba(79, 109, 245, 0.03);
}
.role-card.active {
  border-color: var(--color-primary);
  background: var(--color-primary-bg);
}
.role-icon {
  font-size: 28px;
  line-height: 1;
}
.role-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.role-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}
.role-brief {
  font-size: 12px;
  color: var(--text-tertiary);
}
.role-check {
  position: absolute;
  top: 8px;
  right: 8px;
  color: var(--color-primary);
  font-size: 18px;
}
.role-capabilities {
  max-width: 440px;
  margin: 20px auto 0;
  padding: 16px;
  background: var(--bg-page);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
  text-align: left;
  animation: fade-in 0.2s ease;
}
.cap-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}
.cap-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.8;
}

@keyframes fade-in {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}

.ai-prefs {
  display: flex;
  flex-direction: column;
  gap: 16px;
  max-width: 420px;
  margin: 0 auto;
  text-align: left;
}
.pref-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 16px;
  background: var(--bg-page);
  border-radius: var(--radius-sm);
  border: 1px solid var(--border-light);
}
.pref-info { display: flex; flex-direction: column; gap: 2px; }
.pref-label { font-size: 14px; font-weight: 500; color: var(--text-primary); }
.pref-desc { font-size: 12px; color: var(--text-tertiary); }

.done-step { padding: 20px 0; }
.done-icon { font-size: 64px; line-height: 1; margin-bottom: 16px; }
.done-step h2 { font-size: 24px; font-weight: 700; color: var(--text-primary); margin: 0 0 8px; }
.done-summary {
  max-width: 360px; margin: 24px auto 0;
  background: var(--bg-page); border-radius: var(--radius-sm);
  border: 1px solid var(--border-light); overflow: hidden;
}
.summary-item {
  display: flex; justify-content: space-between;
  padding: 12px 16px; font-size: 14px;
}
.summary-item + .summary-item { border-top: 1px solid var(--border-light); }
.summary-label { color: var(--text-tertiary); }
.summary-value { color: var(--text-primary); font-weight: 500; }

.step-footer {
  display: flex; align-items: center;
  margin-top: 24px; padding-top: 16px;
  border-top: 1px solid var(--border-light);
}

.onboarding-enter-active { transition: all 0.3s ease; }
.onboarding-leave-active { transition: all 0.2s ease; }
.onboarding-enter-from { opacity: 0; }
.onboarding-leave-to { opacity: 0; }

.step-enter-active { animation: stepIn 0.3s ease; }
.step-leave-active { animation: stepOut 0.2s ease; }
@keyframes stepIn {
  from { opacity: 0; transform: translateX(20px); }
  to { opacity: 1; transform: translateX(0); }
}
@keyframes stepOut {
  from { opacity: 1; transform: translateX(0); }
  to { opacity: 0; transform: translateX(-20px); }
}
</style>
