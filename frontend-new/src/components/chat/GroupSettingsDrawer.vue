<script setup>
import { computed, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Delete, Plus, Refresh, UserFilled } from '@element-plus/icons-vue'
import UserAvatar from '../UserAvatar.vue'
import { getAuthToken } from '../../utils/authSession'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  conversationId: { type: [Number, String], default: null },
  conversationName: { type: String, default: '' }
})

const emit = defineEmits(['update:modelValue', 'changed', 'cleared'])

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value)
})

const loading = ref(false)
const inviting = ref(false)
const clearing = ref(false)
const members = ref([])
const users = ref([])
const selectedUserIds = ref([])
const canManage = ref(false)

const memberIdSet = computed(() => new Set(members.value.map(member => Number(member.id))))
const inviteOptions = computed(() => users.value.filter(user => !memberIdSet.value.has(Number(user.id))))
const memberCountLabel = computed(() => `${members.value.length} 人`)

watch(
  () => [props.modelValue, props.conversationId],
  ([open, convId]) => {
    if (open && convId) loadSettings()
  }
)

function token() {
  return getAuthToken()
}

async function loadSettings() {
  if (!props.conversationId) return
  loading.value = true
  try {
    const [memberRes, userRes] = await Promise.all([
      fetch(`/api/conversations/${props.conversationId}/members`, {
        headers: { Authorization: `Bearer ${token()}` }
      }),
      fetch('/api/users/chat', {
        headers: { Authorization: `Bearer ${token()}` }
      })
    ])
    const memberJson = await memberRes.json()
    const userJson = await userRes.json()
    if (!memberJson.success) throw new Error(memberJson.message || '群成员加载失败')
    members.value = memberJson.data?.members || []
    canManage.value = !!memberJson.data?.conversation?.can_manage
    if (userJson.success) users.value = userJson.data || []
    selectedUserIds.value = selectedUserIds.value.filter(id => !memberIdSet.value.has(Number(id)))
    emit('changed', { member_count: members.value.length })
  } catch (error) {
    ElMessage.error(error.message || '群设置加载失败')
  } finally {
    loading.value = false
  }
}

async function inviteMembers() {
  if (!selectedUserIds.value.length) {
    ElMessage.warning('请选择要邀请的成员')
    return
  }
  inviting.value = true
  try {
    const res = await fetch(`/api/conversations/${props.conversationId}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ user_ids: selectedUserIds.value })
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '邀请失败')
    ElMessage.success(json.message || '已邀请成员')
    selectedUserIds.value = []
    await loadSettings()
  } catch (error) {
    ElMessage.error(error.message || '邀请失败')
  } finally {
    inviting.value = false
  }
}

async function removeMember(member) {
  try {
    await ElMessageBox.confirm(`确定将「${memberDisplayName(member)}」移出群聊？`, '移除成员', {
      type: 'warning',
      confirmButtonText: '移除',
      cancelButtonText: '取消'
    })
    const res = await fetch(`/api/conversations/${props.conversationId}/members/${member.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '移除失败')
    ElMessage.success('已移除成员')
    await loadSettings()
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error.message || '移除失败')
  }
}

async function clearMessages() {
  try {
    await ElMessageBox.confirm('确定清空这个群的全部聊天记录和聊天附件？此操作不会影响业务单据。', '清空群消息', {
      type: 'warning',
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      confirmButtonClass: 'el-button--danger'
    })
    clearing.value = true
    const res = await fetch(`/api/conversations/${props.conversationId}/messages`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (!json.success) throw new Error(json.message || '清空失败')
    ElMessage.success(json.message || '已清空群消息')
    emit('cleared')
  } catch (error) {
    if (error !== 'cancel') ElMessage.error(error.message || '清空失败')
  } finally {
    clearing.value = false
  }
}

function memberDisplayName(member) {
  return member.real_name || member.username || '未命名成员'
}

function memberMeta(member) {
  return [member.department, member.position || member.role_label].filter(Boolean).join(' / ') || '未填写岗位'
}
</script>

<template>
  <el-drawer v-model="visible" size="380px" :with-header="false" class="group-settings-drawer">
    <div class="group-settings">
      <div class="settings-head">
        <div>
          <div class="settings-title">{{ conversationName || '群聊设置' }}</div>
          <div class="settings-subtitle">{{ memberCountLabel }}</div>
        </div>
        <el-button :icon="Refresh" circle text :loading="loading" title="刷新" @click="loadSettings" />
      </div>

      <el-alert
        v-if="!canManage"
        title="当前账号只能查看群成员，邀请、移除和清空消息需要管理员或群创建人操作。"
        type="info"
        :closable="false"
        show-icon
      />

      <section class="settings-section">
        <div class="section-title">邀请成员</div>
        <div class="invite-row">
          <el-select
            v-model="selectedUserIds"
            multiple
            filterable
            collapse-tags
            collapse-tags-tooltip
            :disabled="!canManage || loading"
            placeholder="选择员工账号"
          >
            <el-option
              v-for="user in inviteOptions"
              :key="user.id"
              :label="`${user.real_name || user.username}｜${user.department || user.role_label || '未填岗位'}`"
              :value="user.id"
            />
          </el-select>
          <el-button type="primary" :icon="Plus" :disabled="!canManage" :loading="inviting" @click="inviteMembers">邀请</el-button>
        </div>
      </section>

      <section class="settings-section">
        <div class="section-title">群成员</div>
        <div v-loading="loading" class="member-list">
          <div v-for="member in members" :key="member.id" class="member-item">
            <UserAvatar :username="memberDisplayName(member)" :avatar-url="member.avatar_url || ''" :size="34" />
            <div class="member-info">
              <div class="member-name">{{ memberDisplayName(member) }}</div>
              <div class="member-meta">{{ memberMeta(member) }}</div>
            </div>
            <el-button
              v-if="canManage"
              :icon="Delete"
              circle
              text
              type="danger"
              title="移除成员"
              @click="removeMember(member)"
            />
          </div>
          <el-empty v-if="!loading && !members.length" description="暂无群成员" :image-size="80" />
        </div>
      </section>

      <section class="settings-section danger-section">
        <div>
          <div class="section-title">清空消息</div>
          <div class="danger-desc">清空后会删除本群聊天记录和聊天附件，不影响项目、财务、仓库等业务数据。</div>
        </div>
        <el-button type="danger" plain :disabled="!canManage" :loading="clearing" @click="clearMessages">清空群消息</el-button>
      </section>
    </div>
  </el-drawer>
</template>

<style scoped>
.group-settings {
  display: flex;
  flex-direction: column;
  gap: 18px;
  height: 100%;
  padding: 22px;
  background: var(--bg-card);
}

.settings-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.settings-title {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
}

.settings-subtitle {
  margin-top: 4px;
  font-size: 13px;
  color: var(--text-tertiary);
}

.settings-section {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.section-title {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-primary);
}

.invite-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.member-list {
  min-height: 120px;
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--border-light);
  border-radius: 12px;
  background: color-mix(in srgb, var(--bg-card) 90%, var(--bg-page));
}

.member-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-light);
}

.member-item:last-child {
  border-bottom: 0;
}

.member-info {
  min-width: 0;
  flex: 1;
}

.member-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
}

.member-meta {
  margin-top: 2px;
  font-size: 12px;
  color: var(--text-tertiary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.danger-section {
  margin-top: auto;
  padding: 14px;
  border: 1px solid rgba(239, 68, 68, 0.22);
  border-radius: 12px;
  background: rgba(239, 68, 68, 0.06);
}

.danger-desc {
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--text-tertiary);
}

@media (max-width: 640px) {
  :deep(.el-drawer) {
    width: 92vw !important;
  }

  .group-settings {
    padding: 18px;
  }

  .invite-row {
    grid-template-columns: 1fr;
  }
}
</style>
