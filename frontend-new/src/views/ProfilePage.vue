<template>
  <div class="profile-page">
    <el-card class="page-card" shadow="never">
      <template #header>
        <div class="card-header">
          <div>
            <h2>个人设置</h2>
            <p class="card-desc">管理你的头像和密码</p>
          </div>
        </div>
      </template>

      <!-- 头像 -->
      <div class="section">
        <div class="section-title">头像</div>
        <div class="avatar-row">
          <UserAvatar :username="user.username" :avatar-url="previewUrl || user.avatar_url" :size="72" />
          <div class="avatar-actions">
            <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" style="display:none" @change="onFileSelect" />
            <el-button size="small" @click="fileInput?.click()" :disabled="uploading">选择图片</el-button>
            <span v-if="fileName" class="file-name">{{ fileName }}</span>
            <el-button v-if="previewUrl" size="small" type="primary" :loading="uploading" @click="uploadAvatar">{{ uploading ? '上传中...' : '保存头像' }}</el-button>
            <div class="hint">支持 PNG、JPG、WebP，建议 200×200 以上</div>
          </div>
        </div>
      </div>

      <el-divider />

      <!-- 修改密码 -->
      <div class="section">
        <div class="section-title">修改密码</div>
        <el-form label-width="90px" class="password-form">
          <el-form-item label="旧密码">
            <el-input v-model="pwdForm.old_password" type="password" show-password placeholder="输入当前密码" />
          </el-form-item>
          <el-form-item label="新密码">
            <el-input v-model="pwdForm.new_password" type="password" show-password placeholder="至少 6 位" />
          </el-form-item>
          <el-form-item label="确认新密码">
            <el-input v-model="pwdForm.confirm_password" type="password" show-password placeholder="再次输入新密码" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="savingPwd" @click="changePassword">修改密码</el-button>
          </el-form-item>
        </el-form>
      </div>
    </el-card>
  </div>
</template>

<script setup>
import { getAuthToken, clearAuthSession } from '../utils/authSession'
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import UserAvatar from '../components/UserAvatar.vue'

const router = useRouter()
const user = ref({ username: '', avatar_url: '' })
const uploading = ref(false)
const savingPwd = ref(false)
const fileInput = ref(null)
const fileName = ref('')
const previewUrl = ref('')
const fileData = ref(null)
const pwdForm = ref({ old_password: '', new_password: '', confirm_password: '' })

function token() { return getAuthToken() }

async function fetchUser() {
  try {
    const res = await fetch('/api/me', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    if (res.status === 401) {
      clearAuthSession({ clearRemembered: true })
      router.push('/')
      return
    }
    const json = await res.json()
    if (json.success) {
      user.value = json.user
    }
  } catch {
    router.push('/')
  }
}

function onFileSelect(e) {
  const file = e.target.files?.[0]
  if (!file) return
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = (ev) => {
    previewUrl.value = ev.target.result
    fileData.value = ev.target.result
  }
  reader.readAsDataURL(file)
  e.target.value = ''
}

async function uploadAvatar() {
  if (!fileData.value) { ElMessage.warning('请先选择图片'); return }
  uploading.value = true
  try {
    const res = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ image: fileData.value }),
    })
    const json = await res.json()
    if (json.success) {
      user.value.avatar_url = json.avatar_url
      previewUrl.value = ''
      fileData.value = null
      fileName.value = ''
      ElMessage.success('头像已更新')
    } else {
      ElMessage.error(json.message || '上传失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
  uploading.value = false
}

async function changePassword() {
  const { old_password, new_password, confirm_password } = pwdForm.value
  if (!old_password || !new_password || !confirm_password) {
    ElMessage.warning('请填写完整')
    return
  }
  if (new_password.length < 6) {
    ElMessage.warning('新密码至少 6 位')
    return
  }
  if (new_password !== confirm_password) {
    ElMessage.warning('两次输入的密码不一致')
    return
  }

  savingPwd.value = true
  try {
    const res = await fetch('/api/profile/password', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ old_password, new_password }),
    })
    const json = await res.json()
    if (json.success) {
      ElMessage.success('密码已修改')
      pwdForm.value = { old_password: '', new_password: '', confirm_password: '' }
    } else {
      ElMessage.error(json.message || '修改失败')
    }
  } catch {
    ElMessage.error('网络错误')
  }
  savingPwd.value = false
}

onMounted(fetchUser)
</script>

<style scoped>
.profile-page {
  max-width: 640px;
}

.page-card {
  border-radius: var(--radius-lg);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.card-desc {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-tertiary);
}

.section {
  padding: 0 4px;
}

.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.avatar-row {
  display: flex;
  align-items: flex-start;
  gap: 24px;
}

.avatar-actions {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.file-name {
  font-size: 13px;
  color: var(--text-tertiary);
}

.hint {
  width: 100%;
  font-size: 12px;
  color: var(--text-tertiary);
}

.password-form {
  max-width: 400px;
}

:deep(.el-divider) {
  margin: 24px 0;
}
</style>
