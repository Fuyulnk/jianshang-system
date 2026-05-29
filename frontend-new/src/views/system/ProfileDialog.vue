<template>
  <el-dialog v-model="visible" title="个人设置" width="480px" @open="resetForm">
    <div class="profile-section">
      <div class="section-title">头像</div>
      <div class="avatar-section">
        <div class="avatar-preview">
          <UserAvatar :username="form.username" :avatar-url="previewUrl || form.avatar_url" :size="72" />
          <div class="avatar-upload-tip">点击上传</div>
        </div>
        <div class="avatar-input-wrap">
          <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" style="display:none" @change="onFileSelect" />
          <el-button @click="$refs.fileInput.click()" :disabled="uploading">选择图片</el-button>
          <span v-if="fileName" class="file-name">{{ fileName }}</span>
          <el-button v-if="previewUrl" type="primary" :loading="uploading" @click="uploadAvatar">{{ uploading ? '上传中...' : '保存头像' }}</el-button>
          <div class="avatar-hint">支持 PNG、JPG、WebP，建议 200x200 以上</div>
        </div>
      </div>
    </div>

    <el-divider />

    <div class="profile-section">
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
      </el-form>
    </div>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="savingPwd" @click="changePassword">修改密码</el-button>
    </template>
  </el-dialog>
</template>

<script setup>
import { ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import UserAvatar from '../../components/UserAvatar.vue'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  user: { type: Object, default: () => ({ username: '', avatar_url: '' }) },
})

const emit = defineEmits(['update:modelValue', 'updated'])

const visible = ref(props.modelValue)
const uploading = ref(false)
const savingPwd = ref(false)
const fileInput = ref(null)
const fileName = ref('')
const previewUrl = ref('')
const fileData = ref(null)

const form = ref({ username: '', avatar_url: '' })
const pwdForm = ref({ old_password: '', new_password: '', confirm_password: '' })

watch(() => props.modelValue, (v) => { visible.value = v })
watch(visible, (v) => { emit('update:modelValue', v) })

function resetForm() {
  form.value = { username: props.user.username || '', avatar_url: props.user.avatar_url || '' }
  pwdForm.value = { old_password: '', new_password: '', confirm_password: '' }
  previewUrl.value = ''
  fileName.value = ''
  fileData.value = null
}

function token() { return localStorage.getItem('token') }

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
  // 重置 input 以允许重复选择同一文件
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
      form.value.avatar_url = json.avatar_url
      previewUrl.value = ''
      fileData.value = null
      fileName.value = ''
      ElMessage.success('头像已更新')
      emit('updated')
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
</script>

<style scoped>
.profile-section {
  padding: 0 4px;
}
.section-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 16px;
}
.avatar-section {
  display: flex;
  align-items: flex-start;
  gap: 20px;
}
.avatar-input-wrap {
  flex: 1;
}
.avatar-hint {
  font-size: 12px;
  color: var(--text-tertiary);
  margin-top: 6px;
}
.password-form {
  margin-top: -8px;
}
</style>
