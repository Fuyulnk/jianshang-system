<template>
  <div class="project-detail" v-loading="loading">
    <template v-if="project">
      <!-- 顶部导航 -->
      <div class="detail-header">
        <el-button @click="$router.push('/main/projects')">← 返回列表</el-button>
        <div class="header-info">
          <h2>{{ project.name }}</h2>
          <span class="header-meta">业主：{{ project.customer }} | 电话：{{ project.phone || '无' }} | 来源：{{ project.source || '未填写' }} | 状态：{{ project.status_label }}</span>
          <div class="assignment-line">
            <el-tag size="small" type="info">负责人：{{ displayUser(project.manager_real_name, project.manager_username) }}</el-tag>
            <el-tag size="small" type="success">施工负责人：{{ displayUser(project.assignee_real_name, project.assignee_username) }}</el-tag>
          </div>
        </div>
        <el-button type="primary" @click="showEdit = true" v-if="canEditProject">
          {{ canManageProject ? '编辑工单' : '更新施工记录' }}
        </el-button>
      </div>

      <!-- 阶段进度 -->
      <div class="phase-steps">
        <div v-for="(p, i) in phases" :key="i"
          :class="['phase-step', { active: project.phase >= p.phase, current: project.phase === p.phase }]">
          <div class="step-dot">{{ p.phase }}</div>
          <div class="step-label">{{ p.label }}</div>
        </div>
      </div>

      <div class="workorder-summary">
        <el-card class="summary-card handover-summary" shadow="never">
          <template #header>
            <div class="summary-header">
              <span>门店交接资料</span>
              <el-tag v-if="requiredMissingFields.length" type="danger" size="small">缺核心 {{ requiredMissingFields.length }} 项</el-tag>
              <el-tag v-else-if="suggestedMissingFields.length" type="warning" size="small">待完善 {{ suggestedMissingFields.length }} 项</el-tag>
              <el-tag v-else type="success" size="small">资料齐</el-tag>
            </div>
          </template>
          <div class="handover-grid">
            <div class="summary-item">
              <span>来源门店/渠道</span>
              <strong>{{ project.source || '未填写' }}</strong>
            </div>
            <div class="summary-item">
              <span>门店接单人</span>
              <strong>{{ project.order_taker || '未填写' }}</strong>
            </div>
            <div class="summary-item">
              <span>接单日期</span>
              <strong>{{ project.order_date || '未填写' }}</strong>
            </div>
            <div class="summary-item">
              <span>门店单号/合同号</span>
              <strong>{{ project.external_order_no || '未填写' }}</strong>
            </div>
            <div class="summary-item wide">
              <span>施工地址</span>
              <strong>{{ formattedAddress || '未填写' }}</strong>
            </div>
            <div class="summary-item wide">
              <span>交接备注</span>
              <strong>{{ project.handover_note || '未填写' }}</strong>
            </div>
          </div>
          <div v-if="requiredMissingFields.length" class="missing-line danger">
            必须补齐：{{ requiredMissingFields.join('、') }}
          </div>
          <div v-if="suggestedMissingFields.length" class="missing-line">
            建议完善：{{ suggestedMissingFields.join('、') }}
          </div>
        </el-card>

        <el-card class="summary-card execution-summary" shadow="never">
          <template #header>
            <div class="summary-header">
              <span>施工承接状态</span>
              <el-tag :type="project.status === 'closed' ? 'success' : 'primary'" size="small">{{ project.status_label }}</el-tag>
            </div>
          </template>
          <div class="execution-list">
            <div>
              <span>项目负责人</span>
              <strong>{{ displayUser(project.manager_real_name, project.manager_username) }}</strong>
            </div>
            <div>
              <span>施工负责人</span>
              <strong>{{ displayUser(project.assignee_real_name, project.assignee_username) }}</strong>
            </div>
            <div>
              <span>班组长</span>
              <strong>{{ project.team_leader || '未安排' }}</strong>
            </div>
            <div>
              <span>预计完工</span>
              <strong>{{ project.expected_end_date || '未填写' }}</strong>
            </div>
          </div>
        </el-card>
      </div>

      <!-- 当前阶段工作单 -->
      <el-card class="work-card" shadow="never">
        <template #header>
          <div class="work-header">
            <div>
              <div class="work-kicker">当前工作单</div>
              <h3>{{ currentTask.title }}</h3>
              <p>{{ currentTask.desc }}</p>
            </div>
            <el-tag :type="project.status === 'closed' ? 'success' : 'primary'">{{ project.status_label }}</el-tag>
          </div>
        </template>

        <el-form :model="editForm" label-position="top" class="work-form">
          <template v-if="project.status === 'info_confirmed'">
            <el-row :gutter="16">
              <el-col :span="8"><el-form-item label="工勘日期"><el-input v-model="editForm.survey_date" placeholder="2026-01-01" /></el-form-item></el-col>
              <el-col :span="16"><el-form-item label="工勘记录"><el-input v-model="editForm.survey_report" placeholder="现场面积、基层情况、特殊工艺等" /></el-form-item></el-col>
            </el-row>
          </template>

          <template v-else-if="project.status === 'survey_done'">
            <el-form-item label="开工条件备注"><el-input v-model="editForm.condition_note" type="textarea" :rows="2" placeholder="现场是否具备进场条件、水电/保护/基层等情况" /></el-form-item>
          </template>

          <template v-else-if="project.status === 'condition_met'">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="班组长"><el-input v-model="editForm.team_leader" placeholder="班组长姓名" /></el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="施工负责人">
                  <el-select v-model="editForm.assignee_user_id" clearable filterable style="width:100%" placeholder="选择施工负责人">
                    <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="预计完工"><el-input v-model="editForm.expected_end_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="施工成员">
              <el-select v-model="editForm.crew_member_user_ids" multiple clearable filterable style="width:100%" placeholder="选择参与施工的员工">
                <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id">
                  <span>{{ userOptionLabel(u) }}</span>
                  <span class="option-status" :class="{ busy: u.availability_status === 'busy' }">
                    {{ u.availability_status === 'busy' ? `占用：${u.busy_project_name}` : '可安排' }}
                  </span>
                </el-option>
              </el-select>
            </el-form-item>
          </template>

          <template v-else-if="project.status === 'team_assigned'">
            <el-form-item label="开工交底日期"><el-input v-model="editForm.briefing_date" placeholder="2026-01-01" /></el-form-item>
          </template>

          <template v-else-if="project.status === 'briefing_done'">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="材料出库状态">
                  <el-select v-model="editForm.material_out_status" style="width:100%">
                    <el-option label="待出库" value="pending" />
                    <el-option label="已申请" value="requested" />
                    <el-option label="已出库" value="done" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="16">
                <el-form-item label="出库备注"><el-input v-model="editForm.material_out_note" placeholder="后续将联动仓库出库单，当前先记录说明" /></el-form-item>
              </el-col>
            </el-row>
          </template>

          <template v-else-if="project.status === 'material_out'">
            <el-row :gutter="16">
              <el-col :span="8"><el-form-item label="开工日期"><el-input v-model="editForm.start_date" placeholder="2026-01-01" /></el-form-item></el-col>
              <el-col :span="8">
                <el-form-item label="人员状态">
                  <el-select v-model="editForm.crew_status" style="width:100%">
                    <el-option label="待进场" value="pending" />
                    <el-option label="已进场" value="onsite" />
                    <el-option label="施工中" value="working" />
                    <el-option label="已撤场" value="released" />
                    <el-option label="暂停" value="paused" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8"><el-form-item label="预计完工"><el-input v-model="editForm.expected_end_date" placeholder="2026-01-01" /></el-form-item></el-col>
            </el-row>
          </template>

          <template v-else-if="project.status === 'in_progress'">
            <el-form-item label="施工记录"><el-input v-model="editForm.construction_note" type="textarea" :rows="2" placeholder="施工进度、现场问题、需协调事项" /></el-form-item>
          </template>

          <template v-else-if="project.status === 'inspection_done'">
            <el-row :gutter="16">
              <el-col :span="12"><el-form-item label="完工日期"><el-input v-model="editForm.end_date" placeholder="2026-01-01" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="验收日期"><el-input v-model="editForm.acceptance_date" placeholder="2026-01-01" /></el-form-item></el-col>
            </el-row>
          </template>

          <template v-else-if="project.status === 'completed'">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="材料回库状态">
                  <el-select v-model="editForm.material_return_status" style="width:100%">
                    <el-option label="待回库" value="pending" />
                    <el-option label="已申请" value="requested" />
                    <el-option label="已回库" value="done" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="16">
                <el-form-item label="回库备注"><el-input v-model="editForm.material_return_note" placeholder="后续将联动仓库回库单，当前先记录余料/损耗说明" /></el-form-item>
              </el-col>
            </el-row>
          </template>

          <template v-else-if="project.status === 'material_returned'">
            <el-form-item label="结算金额">
              <div class="money-editor">
                <el-input v-model="editForm.settlement_amount" type="number" placeholder="请输入最终结算金额">
                  <template #append>元</template>
                </el-input>
                <div class="money-preview">{{ formatCurrency(editForm.settlement_amount) }}</div>
              </div>
            </el-form-item>
          </template>

          <template v-else-if="project.status === 'closed' || project.status === 'settled'">
            <div class="closed-state">
              <el-icon><Select /></el-icon>
              <div>
                <strong>工单已完结</strong>
                <span>如后续客户报修，可单独发起售后，不影响主工程完结。</span>
              </div>
            </div>
          </template>

          <template v-else-if="project.status.startsWith('repair_')">
            <el-form-item label="售后处理备注"><el-input v-model="editForm.construction_note" type="textarea" :rows="2" placeholder="维修安排、现场处理结果" /></el-form-item>
          </template>
        </el-form>

        <div v-if="project.status === 'info_confirmed' && requiredMissingFields.length" class="task-blocker">
          <strong>当前不能推进：</strong>
          <span>请先补齐 {{ requiredMissingFields.join('、') }}。</span>
        </div>

        <div class="work-actions">
          <el-button v-if="currentTask.next && canRunCurrentTask" type="primary" size="large" :loading="saving" @click="saveAndAdvance(currentTask.next)">
            {{ currentTask.action }}
          </el-button>
          <el-button v-if="(project.status === 'closed' || project.status === 'settled') && canStartRepair" type="warning" plain @click="advanceStatus('repair_requested')">
            发起售后单
          </el-button>
          <el-button plain @click="showEdit = true" v-if="canEditProject">编辑完整资料</el-button>
        </div>
      </el-card>

      <AttachmentPanel
        class="project-attachments"
        entity-type="project"
        :entity-id="project.id"
        title="工单附件"
      />

      <!-- 阶段详情 -->
      <div class="phase-panels">
        <!-- 阶段1: 项目前期 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Document /></el-icon> 门店交接</span>
              <el-tag size="small" :type="project.phase >= 1 ? 'success' : 'info'">{{ project.phase >= 1 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="来源门店/渠道">{{ project.source || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="门店接单人">{{ project.order_taker || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="接单日期">{{ project.order_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="门店单号/合同号">{{ project.external_order_no || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="施工地址">{{ formattedAddress || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="交接备注" :span="2">{{ project.handover_note || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="工勘报告">{{ project.survey_report || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="工勘日期">{{ project.survey_date || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段2: 准备阶段 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Tools /></el-icon> 准备阶段</span>
              <el-tag size="small" :type="project.phase >= 2 ? 'success' : 'info'">{{ project.phase >= 2 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="开工条件备注">{{ project.condition_note || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="班组长">{{ project.team_leader || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="施工成员" :span="2">
              <span v-if="crewMembers.length" class="crew-tags">
                <el-tag v-for="member in crewMembers" :key="member.id" size="small">{{ displayUser(member.real_name, member.username) }}</el-tag>
              </span>
              <span v-else>未安排</span>
            </el-descriptions-item>
            <el-descriptions-item label="开工交底日期">{{ project.briefing_date || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段3: 施工过程 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><House /></el-icon> 施工过程</span>
              <el-tag size="small" :type="project.phase >= 3 ? 'success' : 'info'">{{ project.phase >= 3 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="开工日期">{{ project.start_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="预计完工">{{ project.expected_end_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="人员状态">{{ crewStatusLabel(project.crew_status) }}</el-descriptions-item>
            <el-descriptions-item label="材料出库">{{ materialStatusLabel(project.material_out_status) }}</el-descriptions-item>
            <el-descriptions-item label="施工备注" :span="2">{{ project.construction_note || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段4: 完工验收 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Select /></el-icon> 完工验收</span>
              <el-tag size="small" :type="project.phase >= 4 ? 'success' : 'info'">{{ project.phase >= 4 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="完工日期">{{ project.end_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="验收日期">{{ project.acceptance_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="合同金额">{{ project.total_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="定金">{{ project.deposit_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="结算金额">{{ project.settlement_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="材料回库">{{ materialStatusLabel(project.material_return_status) }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 售后服务 -->
        <el-card class="phase-card" v-if="project.phase >= 6">
          <template #header>
            <div class="card-header">
              <span><el-icon><Service /></el-icon> 售后服务</span>
              <el-tag size="small" type="warning">进行中</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="售后状态">{{ project.status_label }}</el-descriptions-item>
            <el-descriptions-item label="处理备注">{{ project.construction_note || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </div>

      <!-- 操作日志 -->
      <el-card class="log-card">
        <template #header><span><el-icon><Edit /></el-icon> 操作日志</span></template>
        <div v-if="project.logs?.length" class="log-list">
          <div v-for="log in project.logs" :key="log.id" class="log-item">
            <el-tag size="small">{{ log.action }}</el-tag>
            <span class="log-operator">{{ log.operator }}</span>
            <span class="log-content">{{ log.content }}</span>
            <span class="log-time">{{ formatTime(log.created_at) }}</span>
          </div>
        </div>
        <el-empty description="暂无日志" v-else style="padding:20px" />
      </el-card>
    </template>

    <!-- 编辑弹窗 -->
    <el-dialog v-model="showEdit" title="编辑项目工单" width="760px">
      <el-form :model="editForm" label-width="100px">
        <el-tabs>
          <el-tab-pane v-if="canManageProject" label="基本信息">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="工单名称"><el-input v-model="editForm.name" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="业主/客户"><el-input v-model="editForm.customer" /></el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="联系电话"><el-input v-model="editForm.phone" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="来源门店/渠道">
                  <el-select v-model="editForm.source" filterable allow-create default-first-option placeholder="选择或输入来源" style="width:100%">
                    <el-option label="门店" value="门店" /><el-option label="微信交接" value="微信交接" />
                    <el-option label="电话交接" value="电话交接" /><el-option label="直接客户" value="直接客户" />
                    <el-option label="其他渠道" value="其他渠道" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="门店接单人"><el-input v-model="editForm.order_taker" /></el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="接单日期"><el-input v-model="editForm.order_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="门店单号"><el-input v-model="editForm.external_order_no" placeholder="合同号/门店单号" /></el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="交接备注"><el-input v-model="editForm.handover_note" type="textarea" :rows="2" /></el-form-item>
            <el-form-item label="施工地址">
              <div class="address-fields">
                <el-cascader
                  v-model="editForm.addressRegion"
                  :options="chinaRegionOptions"
                  :props="addressCascaderProps"
                  clearable
                  filterable
                  placeholder="省 / 市"
                />
                <el-input v-model="editForm.address_detail" placeholder="小区、楼栋、门牌号等详细地址" />
              </div>
            </el-form-item>
            <el-row :gutter="16" v-if="canManageProject">
              <el-col :span="12">
                <el-form-item label="项目负责人">
                  <el-select v-model="editForm.manager_user_id" placeholder="选择负责人" clearable filterable style="width:100%">
                    <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="施工负责人">
                  <el-select v-model="editForm.assignee_user_id" placeholder="选择施工负责人" clearable filterable style="width:100%">
                    <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
          </el-tab-pane>
          <el-tab-pane v-if="canManageProject" label="前期准备">
            <el-form-item label="工勘报告"><el-input v-model="editForm.survey_report" type="textarea" :rows="2" /></el-form-item>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="工勘日期"><el-input v-model="editForm.survey_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="开工条件备注"><el-input v-model="editForm.condition_note" /></el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="班组长"><el-input v-model="editForm.team_leader" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="交底日期"><el-input v-model="editForm.briefing_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="施工成员">
              <el-select v-model="editForm.crew_member_user_ids" multiple clearable filterable style="width:100%" placeholder="选择参与施工的员工">
                <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
              </el-select>
            </el-form-item>
          </el-tab-pane>
          <el-tab-pane label="施工与结算">
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="开工日期"><el-input v-model="editForm.start_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="预计完工"><el-input v-model="editForm.expected_end_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="施工备注"><el-input v-model="editForm.construction_note" type="textarea" :rows="2" /></el-form-item>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="材料出库"><el-select v-model="editForm.material_out_status" style="width:100%"><el-option label="待出库" value="pending" /><el-option label="已申请" value="requested" /><el-option label="已出库" value="done" /></el-select></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="材料回库"><el-select v-model="editForm.material_return_status" style="width:100%"><el-option label="待回库" value="pending" /><el-option label="已申请" value="requested" /><el-option label="已回库" value="done" /></el-select></el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="完工日期"><el-input v-model="editForm.end_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="验收日期"><el-input v-model="editForm.acceptance_date" placeholder="2026-01-01" /></el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16" v-if="canManageProject">
              <el-col :span="8"><el-form-item label="合同金额"><el-input v-model="editForm.total_amount" type="number"><template #append>元</template></el-input></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="定金"><el-input v-model="editForm.deposit_amount" type="number"><template #append>元</template></el-input></el-form-item></el-col>
              <el-col :span="24"><el-form-item label="结算金额"><div class="money-editor compact"><el-input v-model="editForm.settlement_amount" type="number"><template #append>元</template></el-input><div class="money-preview">{{ formatCurrency(editForm.settlement_amount) }}</div></div></el-form-item></el-col>
            </el-row>
          </el-tab-pane>
        </el-tabs>
      </el-form>
      <template #footer>
        <el-button @click="showEdit = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="handleSave">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Document, Tools, House, Select, Edit, Service } from '@element-plus/icons-vue'
import AttachmentPanel from '../../components/AttachmentPanel.vue'
import {
  addressCascaderProps,
  buildAddressPayload,
  chinaRegionOptions,
  formatProjectAddress,
  getAddressDetail,
  getAddressRegion
} from '../../utils/chinaRegions'

const route = useRoute()
const project = ref(null)
const loading = ref(true)
const showEdit = ref(false)
const saving = ref(false)
const editForm = ref({})
const assignees = ref([])

const phases = [
  { phase: 1, label: '接收工单' },
  { phase: 2, label: '施工准备' },
  { phase: 3, label: '施工执行' },
  { phase: 4, label: '交付结算' },
  { phase: 5, label: '完结归档' },
]

// 当前用户角色
const userRole = (() => {
  try {
    const t = localStorage.getItem('token')
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})()
const userId = (() => {
  try {
    const t = localStorage.getItem('token')
    return JSON.parse(atob(t.split('.')[1])).userId || 0
  } catch { return 0 }
})()
const canManageProject = computed(() => ['super_admin', 'admin', 'engineering'].includes(userRole))
const isAssignedEmployee = computed(() => {
  if (!project.value) return false
  return project.value.assignee_user_id === userId
    || parseCrewMemberIds(project.value.crew_member_user_ids).includes(userId)
})
const canEditProject = computed(() => canManageProject.value || (userRole === 'employee' && isAssignedEmployee.value))
const formattedAddress = computed(() => formatProjectAddress(project.value || {}))
const requiredMissingFields = computed(() => {
  if (!project.value) return []
  const checks = [
    ['source', '来源门店/渠道'],
    ['order_taker', '门店接单人'],
    ['phone', '业主电话'],
    ['address_detail', '详细地址']
  ]
  return checks.filter(([field]) => !String(project.value[field] || '').trim()).map(([, label]) => label)
})
const suggestedMissingFields = computed(() => {
  if (!project.value) return []
  const checks = [
    ['order_date', '接单日期'],
    ['external_order_no', '门店单号'],
    ['handover_note', '交接备注']
  ]
  return checks.filter(([field]) => !String(project.value[field] || '').trim()).map(([, label]) => label)
})
const crewMembers = computed(() => {
  const ids = parseCrewMemberIds(project.value?.crew_member_user_ids)
  return ids.map(id => assignees.value.find(user => user.id === id)).filter(Boolean)
})

const TASK_FALLBACK = {
  title: '查看工程状态',
  desc: '当前阶段暂无需要填写的工作项。',
  action: '',
  next: '',
  roles: []
}

const TASKS = {
  info_confirmed: {
    title: '核对门店资料并完成工勘',
    desc: '先补齐来源、接单人、业主电话和地址，再填写工勘记录或工勘日期。',
    action: '资料齐全，标记工勘完成',
    next: 'survey_done',
    roles: ['super_admin', 'admin', 'engineering']
  },
  survey_done: {
    title: '确认开工条件',
    desc: '记录现场保护、水电、基层和进场条件，确认后进入施工准备。',
    action: '确认条件，进入排班',
    next: 'condition_met',
    roles: ['super_admin', 'admin', 'finance']
  },
  condition_met: {
    title: '安排施工组',
    desc: '安排班组长、施工负责人和施工成员，系统会提示人员是否已被其他工单占用。',
    action: '保存班组，进入交底',
    next: 'team_assigned',
    roles: ['super_admin', 'admin', 'engineering']
  },
  team_assigned: {
    title: '完成开工交底',
    desc: '填写交底日期，确认班组已知道施工范围、工艺和现场注意事项。',
    action: '交底完成，转仓库出库',
    next: 'briefing_done',
    roles: ['super_admin', 'admin', 'engineering']
  },
  briefing_done: {
    title: '仓库确认材料出库',
    desc: '当前先记录材料出库状态，下一步会独立做出库单联动库存。',
    action: '确认出库，等待进场',
    next: 'material_out',
    roles: ['super_admin', 'admin', 'warehouse']
  },
  material_out: {
    title: '确认进场开工',
    desc: '填写开工日期并更新人员进场状态，施工成员会被视为占用。',
    action: '确认进场，开始施工',
    next: 'in_progress',
    roles: ['super_admin', 'admin', 'engineering', 'employee'],
    assignedOnly: true
  },
  in_progress: {
    title: '记录施工过程',
    desc: '记录施工进度、现场问题或协调事项，完成后进入检查。',
    action: '施工记录完成，进入验收',
    next: 'inspection_done',
    roles: ['super_admin', 'admin', 'engineering', 'employee'],
    assignedOnly: true
  },
  inspection_done: {
    title: '完工验收',
    desc: '填写完工和验收日期，确认现场已具备交付条件。',
    action: '验收完成，转材料回库',
    next: 'completed',
    roles: ['super_admin', 'admin', 'engineering']
  },
  completed: {
    title: '确认材料回库',
    desc: '当前先记录材料回库状态，后续会联动仓库回库单和项目成本。',
    action: '确认回库，转财务结算',
    next: 'material_returned',
    roles: ['super_admin', 'admin', 'warehouse']
  },
  material_returned: {
    title: '财务结算',
    desc: '填写最终结算金额后，可以直接完结项目；没有售后也能正常闭环。',
    action: '结算完成，完结工单',
    next: 'closed',
    roles: ['super_admin', 'admin', 'finance']
  },
  settled: {
    title: '确认工单完结',
    desc: '旧工单的已结算状态可以补确认后完结。',
    action: '确认工单完结',
    next: 'closed',
    roles: ['super_admin', 'admin', 'finance']
  },
  closed: {
    title: '工单已完结',
    desc: '主工程流程已经结束。后续客户报修时再单独发起售后。',
    action: '',
    next: '',
    roles: []
  },
  repair_requested: {
    title: '安排售后维修',
    desc: '售后是独立事件，不影响主工程完结。',
    action: '安排维修',
    next: 'repair_assigned',
    roles: ['super_admin', 'admin', 'engineering']
  },
  repair_assigned: {
    title: '完成售后维修',
    desc: '记录维修处理结果并关闭售后。',
    action: '维修完成',
    next: 'repair_done',
    roles: ['super_admin', 'admin', 'engineering']
  },
  repair_done: {
    title: '售后已完成',
    desc: '该售后事件已经处理完成。',
    action: '',
    next: '',
    roles: []
  }
}

const currentTask = computed(() => TASKS[project.value?.status] || TASK_FALLBACK)
const canRunCurrentTask = computed(() => {
  const roles = currentTask.value.roles || []
  if (!currentTask.value.next || !roles.length) return false
  if (userRole === 'super_admin') return true
  if (!roles.includes(userRole)) return false
  if (currentTask.value.assignedOnly && ['employee', 'engineering'].includes(userRole)) return isAssignedEmployee.value
  return true
})
const canStartRepair = computed(() => ['super_admin', 'admin', 'engineering'].includes(userRole))

function token() { return localStorage.getItem('token') }
function formatTime(t) { return t ? new Date(t).toLocaleString('zh-CN') : '' }
function displayUser(realName, username) { return realName || username || '未分配' }
function userOptionLabel(user) {
  const name = user.real_name || user.username
  const role = user.role_label || user.role
  return `${name}${role ? `（${role}）` : ''}`
}

async function fetchDetail() {
  loading.value = true
  try {
    const res = await fetch(`/api/projects/${route.params.id}`, {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) {
      project.value = json.data
      editForm.value = {
        ...json.data,
        addressRegion: getAddressRegion(json.data),
        address_detail: getAddressDetail(json.data),
        crew_member_user_ids: parseCrewMemberIds(json.data.crew_member_user_ids),
        crew_status: json.data.crew_status || 'pending',
        material_out_status: json.data.material_out_status || 'pending',
        material_return_status: json.data.material_return_status || 'pending'
      }
    }
  } finally { loading.value = false }
}

async function fetchAssignees() {
  try {
    const res = await fetch('/api/projects/assignees', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) assignees.value = json.data
  } catch {}
}

async function advanceStatus(statusKey, throwOnError = false) {
  const res = await fetch(`/api/projects/${route.params.id}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ status: statusKey })
  })
  const json = await res.json()
  if (json.success) {
    ElMessage.success('状态已更新')
    await fetchDetail()
    return true
  } else {
    const message = json.message || '状态更新失败'
    if (throwOnError) throw new Error(message)
    ElMessage.warning(message)
    return false
  }
}

async function saveAndAdvance(statusKey) {
  saving.value = true
  try {
    await saveProjectFields()
    await advanceStatus(statusKey, true)
  } catch (err) {
    ElMessage.error(err.message || '操作失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

async function handleSave() {
  saving.value = true
  try {
    await saveProjectFields()
    ElMessage.success('保存成功')
    showEdit.value = false
    fetchDetail()
  } catch (err) {
    ElMessage.error(err.message || '保存失败，请稍后重试')
  } finally { saving.value = false }
}

async function saveProjectFields() {
  const body = { ...buildAddressPayload(editForm.value) }
  const fields = ['name', 'customer', 'phone', 'address', 'address_province', 'address_city', 'address_detail', 'source',
    'order_taker', 'order_date', 'external_order_no', 'handover_note',
    'survey_report', 'survey_date',
    'team_leader', 'crew_member_user_ids', 'crew_status', 'briefing_date', 'condition_note',
    'material_out_status', 'material_out_note', 'material_return_status', 'material_return_note',
    'start_date', 'expected_end_date', 'construction_note',
    'end_date', 'acceptance_date', 'total_amount', 'deposit_amount', 'settlement_amount',
    'manager_user_id', 'assignee_user_id']
  for (const f of fields) {
    if (editForm.value[f] !== undefined) {
      body[f] = typeof editForm.value[f] === 'string' ? editForm.value[f].trim() : editForm.value[f]
    }
  }
  Object.assign(body, buildAddressPayload(editForm.value))
  body.total_amount = parseFloat(body.total_amount) || 0
  body.deposit_amount = parseFloat(body.deposit_amount) || 0
  body.settlement_amount = parseFloat(body.settlement_amount) || 0
  body.manager_user_id = body.manager_user_id || 0
  body.assignee_user_id = body.assignee_user_id || 0
  body.crew_member_user_ids = Array.isArray(body.crew_member_user_ids) ? body.crew_member_user_ids : []

  const res = await fetch(`/api/projects/${route.params.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify(body)
  })
  const json = await readJson(res)
  if (!res.ok || !json.success) {
    throw new Error(json.message || '保存失败，请检查权限或服务器日志')
  }
}

async function readJson(res) {
  const text = await res.text()
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    return { success: false, message: text.slice(0, 120) || '服务器返回异常' }
  }
}

function parseCrewMemberIds(value) {
  if (Array.isArray(value)) return value.map(Number).filter(Boolean)
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed.map(Number).filter(Boolean) : []
  } catch {
    return []
  }
}

function crewStatusLabel(value) {
  return {
    pending: '待进场',
    onsite: '已进场',
    working: '施工中',
    released: '已撤场',
    paused: '暂停'
  }[value] || '待进场'
}

function materialStatusLabel(value) {
  return {
    pending: '待处理',
    requested: '已申请',
    done: '已完成'
  }[value] || '待处理'
}

function formatCurrency(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return '￥0.00'
  return `￥${n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

onMounted(() => {
  fetchDetail()
  fetchAssignees()
})
</script>

<style scoped>
.project-detail { padding: 0; }
.detail-header {
  display: flex; align-items: center; gap: 16px; margin-bottom: 20px;
  background: var(--bg-card); padding: 16px 20px; border-radius: var(--radius-lg);
  box-shadow: var(--shadow-sm);
}
.header-info { flex: 1; }
.header-info h2 { margin: 0; font-size: 18px; color: var(--text-primary); }
.header-meta { font-size: 13px; color: var(--text-tertiary); }
.assignment-line { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.phase-steps {
  display: flex; gap: 0; margin-bottom: 20px;
  background: var(--bg-card); border-radius: var(--radius-lg);
  padding: 20px 24px; box-shadow: var(--shadow-sm);
}
.phase-step {
  flex: 1; text-align: center; position: relative;
}
.phase-step:not(:last-child)::after {
  content: ''; position: absolute; top: 16px; left: 60%; right: -40%;
  height: 2px; background: var(--border-light);
}
.phase-step.active:not(:last-child)::after { background: var(--color-primary); }
.step-dot {
  width: 32px; height: 32px; line-height: 32px; border-radius: 50%;
  background: #f0f0f0; color: var(--text-tertiary); font-weight: bold; margin: 0 auto 8px;
  font-size: 13px;
}
.phase-step.active .step-dot { background: var(--color-primary); color: #fff; }
.phase-step.current .step-dot { box-shadow: 0 0 0 4px rgba(79,109,245,0.25); }
.step-label { font-size: 13px; color: var(--text-tertiary); }
.phase-step.active .step-label { color: var(--color-primary); font-weight: 500; }
.workorder-summary {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 16px;
  margin-bottom: 20px;
}
.summary-card {
  border: 1px solid var(--border-light);
}
.summary-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-weight: 700;
}
.handover-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
.summary-item,
.execution-list > div {
  min-width: 0;
  padding: 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 86%, var(--bg-page));
}
.summary-item.wide {
  grid-column: span 2;
}
.summary-item span,
.execution-list span {
  display: block;
  margin-bottom: 5px;
  color: var(--text-secondary);
  font-size: 12px;
}
.summary-item strong,
.execution-list strong {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary);
  font-size: 14px;
}
.missing-line {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #f59e0b 12%, var(--bg-card));
  color: #b45309;
  font-size: 13px;
}
.missing-line.danger {
  background: color-mix(in srgb, #ef4444 12%, var(--bg-card));
  color: #b91c1c;
}
.execution-list {
  display: grid;
  gap: 10px;
}
.work-card {
  margin-bottom: 20px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 28%, var(--border-light));
}
.work-header {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.work-kicker {
  font-size: 12px;
  color: var(--color-primary);
  font-weight: 700;
  margin-bottom: 4px;
}
.work-header h3 {
  margin: 0 0 4px;
  font-size: 18px;
  color: var(--text-primary);
}
.work-header p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}
.work-form {
  max-width: 960px;
}
.work-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding-top: 6px;
}
.task-blocker {
  margin: 4px 0 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #ef4444 10%, var(--bg-card));
  color: #b91c1c;
  font-size: 13px;
}
.task-blocker strong {
  margin-right: 4px;
}
.option-status {
  float: right;
  color: var(--text-tertiary);
  font-size: 12px;
}
.option-status.busy {
  color: var(--color-warning);
}
.crew-tags {
  display: inline-flex;
  gap: 6px;
  flex-wrap: wrap;
}
.closed-state {
  display: flex;
  align-items: center;
  gap: 12px;
  color: var(--text-secondary);
  padding: 8px 0 12px;
}
.closed-state .el-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-success) 14%, transparent);
  color: var(--color-success);
}
.closed-state strong,
.closed-state span {
  display: block;
}
.closed-state span {
  margin-top: 2px;
  font-size: 13px;
  color: var(--text-tertiary);
}
.money-editor {
  display: grid;
  grid-template-columns: minmax(260px, 420px) minmax(180px, 1fr);
  gap: 12px;
  align-items: center;
  width: 100%;
}
.money-editor :deep(.el-input__inner) {
  height: 46px;
  font-size: 20px;
  font-weight: 700;
}
.money-preview {
  min-height: 46px;
  display: flex;
  align-items: center;
  padding: 0 16px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--color-success) 10%, var(--bg-page));
  color: var(--color-success);
  font-size: 22px;
  font-weight: 800;
}
.money-editor.compact {
  grid-template-columns: minmax(240px, 1fr) minmax(180px, 240px);
}
.phase-panels { display: flex; flex-direction: column; gap: 16px; margin-bottom: 20px; }
.project-attachments { margin-bottom: 20px; }
.card-header { display: flex; justify-content: space-between; align-items: center; }
.phase-card,
.log-card {
  background: var(--bg-card);
}
.phase-card :deep(.el-descriptions__body),
.phase-card :deep(.el-descriptions__cell) {
  background: color-mix(in srgb, var(--bg-card) 92%, var(--bg-page));
  color: var(--text-secondary);
}
.phase-card :deep(.el-descriptions__label) {
  background: color-mix(in srgb, var(--bg-page) 82%, var(--bg-card));
  color: var(--text-tertiary);
}
.phase-card :deep(.el-descriptions__content) {
  color: var(--text-primary);
}
.log-item { display: flex; align-items: center; gap: 12px; padding: 10px 0; border-bottom: 1px solid var(--border-light); font-size: 13px; }
.log-item:last-child { border-bottom: none; }
.log-operator { color: var(--color-primary); font-weight: 500; }
.log-content { color: var(--text-primary); flex: 1; }
.log-time { color: var(--text-placeholder); font-size: 12px; }
.address-fields {
  display: grid;
  grid-template-columns: 190px minmax(0, 1fr);
  gap: 10px;
  width: 100%;
}
.address-fields :deep(.el-cascader) {
  width: 100%;
}
@media (max-width: 720px) {
  .workorder-summary {
    grid-template-columns: 1fr;
  }
  .handover-grid {
    grid-template-columns: 1fr;
  }
  .summary-item.wide {
    grid-column: auto;
  }
  .address-fields {
    grid-template-columns: 1fr;
  }
  .money-editor,
  .money-editor.compact {
    grid-template-columns: 1fr;
  }
  .work-header {
    flex-direction: column;
  }
}
</style>
