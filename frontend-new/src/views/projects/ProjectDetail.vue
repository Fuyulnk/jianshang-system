<template>
  <div class="project-detail" v-loading="loading">
    <template v-if="project">
      <!-- 顶部导航 -->
      <div class="detail-header">
        <el-button @click="$router.push('/main/projects/construction')">← 返回施工工单</el-button>
        <div class="header-info">
          <h2>{{ project.name }}</h2>
          <span class="header-meta">业主：{{ project.customer }} | 联系方式：{{ project.phone || '无' }} | 来源：{{ project.source || '未填写' }} | 状态：{{ project.status_label }}</span>
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
        <button
          v-for="(p, i) in workflowSteps"
          :key="p.key"
          type="button"
          :class="['phase-step', { active: p.done, current: p.current, skipped: p.skipped }]"
          @click="scrollToWorkflowSection(p)"
        >
          <div class="step-dot">{{ i + 1 }}</div>
          <div class="step-label">{{ p.label }}</div>
          <small v-if="p.skipped">已跳过</small>
        </button>
      </div>

      <el-card id="current-workbench" class="current-workbench" shadow="never">
        <template #header>
          <div class="current-workbench-head">
            <div>
              <div class="work-kicker">当前步骤工作台</div>
              <h3>{{ currentWorkflowStep.label }}</h3>
              <p>{{ currentTask.desc }}</p>
            </div>
            <el-tag :type="project.status === 'archived' ? 'success' : 'primary'">{{ project.status_label }}</el-tag>
          </div>
        </template>
        <div class="current-workbench-body">
          <div class="next-action-card">
            <strong>{{ currentTask.title }}</strong>
            <span>{{ currentActionHint }}</span>
            <div v-if="currentMissingFields.length" class="task-blocker inline">
              <strong>当前不能推进：</strong>
              <span>请先补齐 {{ currentMissingFields.join('、') }}。</span>
            </div>
            <div class="work-actions compact">
              <el-button
                v-if="currentTask.next && canRunCurrentTask"
                :type="currentMissingFields.length ? 'info' : 'primary'"
                size="large"
                :plain="currentMissingFields.length > 0"
                :loading="saving"
                :disabled="currentMissingFields.length > 0"
                @click="saveAndAdvance(currentTask.next)"
              >
                {{ currentMissingFields.length ? '补齐资料后可推进' : currentTask.action }}
              </el-button>
              <el-button v-if="currentDocumentKey" plain @click="openCurrentDocument">
                打开当前单据
              </el-button>
              <el-button
                v-if="canSkipRecheck"
                type="warning"
                size="large"
                plain
                :loading="saving"
                @click="skipSurveyRecheck"
              >
                无需复尺，直接进入收款单
              </el-button>
              <el-button v-if="project.status === 'archived' && canStartRepair && !warrantyInfo.expired" type="warning" plain @click="advanceStatus('repair_requested')">
                发起售后单
              </el-button>
              <el-button plain @click="showEdit = true" v-if="canEditProject">编辑完整资料</el-button>
            </div>
          </div>
          <div class="step-context-card">
            <span>相关资料</span>
            <strong>{{ currentDocumentLabel }}</strong>
            <p>{{ currentStepNote }}</p>
          </div>
        </div>
      </el-card>

      <div class="workorder-summary">
        <el-card class="summary-card handover-summary" shadow="never">
          <template #header>
            <div class="summary-header">
              <span>门店交底资料</span>
              <el-tag v-if="isProjectClosed" type="success" size="small">已归档</el-tag>
              <el-tag v-else-if="requiredMissingFields.length" type="danger" size="small">缺核心 {{ requiredMissingFields.length }} 项</el-tag>
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
              <span>门店交底备注</span>
              <strong>{{ project.handover_note || '未填写' }}</strong>
            </div>
          </div>
          <div v-if="!isProjectClosed && requiredMissingFields.length" class="missing-line danger">
            必须补齐：{{ requiredMissingFields.join('、') }}
          </div>
          <div v-if="!isProjectClosed && suggestedMissingFields.length" class="missing-line">
            建议完善：{{ suggestedMissingFields.join('、') }}
          </div>
        </el-card>

        <el-card class="summary-card execution-summary" shadow="never">
          <template #header>
            <div class="summary-header">
              <span>施工承接状态</span>
              <el-tag :type="project.status === 'archived' ? 'success' : 'primary'" size="small">{{ project.status_label }}</el-tag>
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
              <span>首勘人员</span>
              <strong>{{ displayUser(project.survey_real_name, project.survey_username) }}</strong>
            </div>
            <div>
              <span>二勘/复尺</span>
              <strong>{{ displayUser(project.recheck_real_name, project.recheck_username) }}</strong>
            </div>
            <div>
              <span>收尾验收</span>
              <strong>{{ displayUser(project.final_inspection_real_name, project.final_inspection_username) }}</strong>
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
              <div class="work-kicker">步骤补充资料</div>
              <h3>{{ currentTask.title }}</h3>
              <p>这里填写当前步骤需要同步到项目工单的结构化字段。</p>
              <div class="handoff-line">
                <span>当前处理：<b>{{ currentOwnerLabel }}</b></span>
                <span>完成后自动抄送：<b>{{ nextOwnerLabel }}</b></span>
              </div>
            </div>
            <el-tag :type="project.status === 'archived' ? 'success' : 'primary'">{{ project.status_label }}</el-tag>
          </div>
        </template>

        <el-form :model="editForm" label-position="top" class="work-form">
          <template v-if="project.status === 'handover_received'">
            <div class="stage-hint">
              <strong>先核对门店交底资料。</strong>
              <span>客户、电话、地址、施工空间、材料意向、注意事项和门店接单人补齐后，才能安排现场勘察。</span>
            </div>
            <el-form-item label="首勘人员" required>
              <el-select v-model="editForm.survey_user_id" clearable filterable style="width:100%" placeholder="选择负责首勘的监理">
                <el-option v-for="u in engineeringAssignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
              </el-select>
            </el-form-item>
          </template>

          <template v-else-if="project.status === 'survey_pending'">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="首勘人员" required>
                  <el-select v-model="editForm.survey_user_id" clearable filterable style="width:100%" placeholder="选择首勘人员">
                    <el-option v-for="u in engineeringAssignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8"><el-form-item label="工勘日期" required><el-input v-model="editForm.survey_date" placeholder="2026-01-01" /></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="工勘记录" required><el-input v-model="editForm.survey_report" placeholder="现场面积、基层情况、特殊工艺等" /></el-form-item></el-col>
            </el-row>
          </template>

          <template v-else-if="project.status === 'survey_done'">
            <div class="stage-hint">
              <strong>当前在复尺判断节点。</strong>
              <span>需要复尺时打开“二次勘察表”上传记录并确认；无需复尺时点击明亮按钮，填写原因后直接交给财务做项目结算收款单。</span>
            </div>
            <el-form-item label="二勘/复尺人员" required>
              <el-select v-model="editForm.recheck_user_id" clearable filterable style="width:100%" placeholder="选择负责二勘/复尺的监理">
                <el-option v-for="u in engineeringAssignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="复尺/开工条件复核" required><el-input v-model="editForm.condition_note" type="textarea" :rows="2" placeholder="复尺面积、现场是否具备进场条件、水电/保护/基层等情况" /></el-form-item>
          </template>

          <template v-else-if="project.status === 'recheck_done'">
            <div class="stage-hint">
              <strong>复尺已完成，等待财务处理项目结算收款单。</strong>
              <span>请打开“项目结算收款单”，由财务核对 90% 进场款，确认后才能进入班组交底。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'pre_entry_payment_pending'">
            <div class="stage-hint">
              <strong>等待财务制作并确认项目结算收款单。</strong>
              <span>财务根据工勘/复尺结果制作收款单，交总监打印签字，门店收取进场前 90% 款项后确认进入班组交底。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'payment_received'">
            <el-row :gutter="16">
              <el-col :span="8">
                <el-form-item label="班组长"><el-input v-model="editForm.team_leader" placeholder="班组长姓名" /></el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="施工负责人" required>
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
            <el-form-item label="班组交底日期" required><el-input v-model="editForm.briefing_date" placeholder="2026-01-01" /></el-form-item>
          </template>

          <template v-else-if="project.status === 'briefing_done'">
            <div class="stage-hint">
              <strong>班组交底已完成，等待仓库处理材料出库。</strong>
              <span>仓管在“材料出库单”里录入材料、辅材、工具和运输费，确认后工单自动进入已出库待进场。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'material_requested'">
            <div class="stage-hint">
              <strong>已申请出库，等待仓库确认。</strong>
              <span>仓库确认会扣减库存并把工单推进到已出库待进场；如取消申请，会回退到班组交底完成待出库。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'material_out'">
            <el-row :gutter="16">
              <el-col :span="8"><el-form-item label="实际进场/开工日期" required><el-input v-model="editForm.start_date" placeholder="2026-01-01" /></el-form-item></el-col>
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
              <el-col :span="8"><el-form-item label="预计完工" required><el-input v-model="editForm.expected_end_date" placeholder="2026-01-01" /></el-form-item></el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="8"><el-form-item label="班组长"><el-input v-model="editForm.team_leader" placeholder="班组长姓名" /></el-form-item></el-col>
              <el-col :span="8">
                <el-form-item label="施工负责人" required>
                  <el-select v-model="editForm.assignee_user_id" clearable filterable style="width:100%" placeholder="选择施工负责人">
                    <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="施工成员">
                  <el-select v-model="editForm.crew_member_user_ids" multiple clearable filterable style="width:100%" placeholder="选择施工人员">
                    <el-option v-for="u in assignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="开工备注"><el-input v-model="editForm.construction_note" type="textarea" :rows="2" placeholder="材料是否到位、保护是否完成、现场是否允许进场" /></el-form-item>
          </template>

          <template v-else-if="project.status === 'in_progress'">
            <el-alert class="stage-alert" type="info" :closable="false" show-icon title="施工过程记录 V1 先做轻量备注；照片打卡、水印相机和每日记录放到后续 V2。" />
            <el-row :gutter="16">
              <el-col :span="8"><el-form-item label="完工日期" required><el-input v-model="editForm.end_date" placeholder="2026-01-01" /></el-form-item></el-col>
              <el-col :span="8"><el-form-item label="验收日期" required><el-input v-model="editForm.acceptance_date" placeholder="2026-01-01" /></el-form-item></el-col>
              <el-col :span="8">
                <el-form-item label="验收结论" required>
                  <el-select v-model="inspectionResult" style="width:100%">
                    <el-option label="验收通过，允许进入回库" value="pass" />
                    <el-option label="需要整改，暂不回库" value="repair" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-form-item label="收尾验收人员" required>
              <el-select v-model="editForm.final_inspection_user_id" clearable filterable style="width:100%" placeholder="选择负责收尾验收的监理">
                <el-option v-for="u in engineeringAssignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="施工/验收记录" required><el-input v-model="editForm.construction_note" type="textarea" :rows="3" placeholder="施工进度、现场问题、整改说明、验收结论" /></el-form-item>
          </template>

          <template v-else-if="project.status === 'inspection_done'">
            <div class="stage-hint">
              <strong>验收已完成，等待仓库材料回库。</strong>
              <span>仓管在下方“材料回库单”里核对出库明细、实际用量、回库数量和差异，确认后进入工费结算。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'material_returned'">
            <div class="stage-hint">
              <strong>回库完成，等待工费结算。</strong>
              <span>请在下方资料链处理“施工班组工费结算单”，填写或导入人工费合计后确认推进。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'labor_settled'">
            <div class="stage-hint">
              <strong>工费结算已完成，等待成本核算。</strong>
              <span>请在下方资料链处理“完工成本核算表”，成本合计确认后自动转到财务结算。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'cost_checked'">
            <div class="stage-hint">
              <strong>成本核算已完成，等待财务结算。</strong>
              <span>请在下方资料链处理“财务结算/归档凭证”，收款状态确认为已收齐后才能推进。</span>
            </div>
          </template>

          <template v-else-if="project.status === 'finance_settled' || project.status === 'archived'">
            <div class="closed-state">
              <el-icon><Select /></el-icon>
              <div>
                <strong>{{ project.status === 'archived' ? '工单已归档' : '财务已结算，待归档' }}</strong>
                <span>如后续客户报修，可单独发起售后，不影响主工程归档。</span>
              </div>
            </div>
            <div class="warranty-line" :class="{ expired: warrantyInfo.expired }">
              {{ warrantyInfo.text }}
            </div>
          </template>

          <template v-else-if="project.status.startsWith('repair_')">
            <el-form-item label="售后处理备注"><el-input v-model="editForm.construction_note" type="textarea" :rows="2" placeholder="维修安排、现场处理结果" /></el-form-item>
          </template>
        </el-form>

        <div v-if="currentMissingFields.length" class="task-blocker">
          <strong>当前不能推进：</strong>
          <span>请先补齐 {{ currentMissingFields.join('、') }}。</span>
        </div>

        <div class="work-actions">
          <el-button
            v-if="currentTask.next && canRunCurrentTask"
            :type="currentMissingFields.length ? 'info' : 'primary'"
            :plain="currentMissingFields.length > 0"
            size="large"
            :loading="saving"
            :disabled="currentMissingFields.length > 0"
            @click="saveAndAdvance(currentTask.next)"
          >
            {{ currentMissingFields.length ? '补齐资料后可推进' : currentTask.action }}
          </el-button>
          <el-button v-if="project.status === 'archived' && canStartRepair && !warrantyInfo.expired" type="warning" plain @click="advanceStatus('repair_requested')">
            发起售后单
          </el-button>
          <el-button
            v-if="canSkipRecheck"
            type="warning"
            plain
            :loading="saving"
            @click="skipSurveyRecheck"
          >
            无需复尺，直接进入收款单
          </el-button>
          <el-button plain @click="showEdit = true" v-if="canEditProject">编辑完整资料</el-button>
        </div>
      </el-card>

      <ProjectDocumentSummary
        ref="documentSummaryRef"
        id="project-documents"
        :project="project"
        :refresh-key="documentRefreshKey"
        :current-step-key="currentDocumentKey"
        @chain-updated="handleDeliveryChainUpdated"
        @project-updated="handleAttachmentsUpdated"
      />
      <el-card class="trace-card" shadow="never">
        <template #header>
          <div class="summary-header">
            <span><el-icon><Edit /></el-icon> 流程回溯</span>
            <el-tag size="small" type="info">只读</el-tag>
          </div>
        </template>
        <div class="trace-list">
          <article v-for="step in traceSteps" :key="step.key" class="trace-item" :class="{ confirmed: step.status === '已确认' }">
            <div class="trace-main">
              <strong>{{ step.stage }} · {{ step.label }}</strong>
              <span>{{ step.status || '缺失' }}{{ step.document_version_count ? ` · ${step.document_version_count} 版` : '' }}</span>
            </div>
            <div class="trace-meta">
              <span v-if="step.document_versions?.length">
                最新：{{ step.document_versions[0].source_file_name || '系统表格' }} · {{ step.document_versions[0].uploader_name || '未知人员' }}
              </span>
              <span v-if="step.attachments?.length">附件：{{ step.attachments.map(file => file.original_name).slice(0, 2).join('、') }}</span>
              <span v-if="step.summary?.length">摘要：{{ step.summary.map(item => `${item[0]} ${item[1] || '未填'}`).slice(0, 2).join('；') }}</span>
            </div>
          </article>
        </div>
      </el-card>
      <ProjectDocumentImportPanel :project="project" :can-apply="canManageProject" @applied="fetchDetail" />

      <MaterialRequestPanel
        :project-id="project.id"
        mode="project"
        :title="project.status === 'inspection_done' ? '材料回库单' : '材料出库单'"
        :can-request="project.status === 'briefing_done'"
        :can-return="project.status === 'inspection_done'"
        :disabled-reason="materialRequestDisabledReason"
        @updated="fetchDetail"
      />

      <AttachmentPanel
        class="project-attachments"
        entity-type="project"
        :entity-id="project.id"
        title="工单附件"
        @updated="handleAttachmentsUpdated"
      />

      <!-- 阶段详情 -->
      <div class="phase-panels">
        <!-- 阶段1: 门店交底/勘察 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Document /></el-icon> 门店交底 / 勘察</span>
              <el-tag size="small" :type="project.phase >= 1 ? 'success' : 'info'">{{ project.phase >= 1 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="来源门店/渠道">{{ project.source || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="门店接单人">{{ project.order_taker || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="接单日期">{{ project.order_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="门店单号/合同号">{{ project.external_order_no || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="施工地址">{{ formattedAddress || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="门店交底备注" :span="2">{{ project.handover_note || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="工勘报告">{{ project.survey_report || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="工勘日期">{{ project.survey_date || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段2: 班组交底/出库 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Tools /></el-icon> 班组交底 / 出库</span>
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
            <el-descriptions-item label="班组交底日期">{{ project.briefing_date || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段3: 进场施工/验收 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><House /></el-icon> 进场施工 / 验收</span>
              <el-tag size="small" :type="project.phase >= 3 ? 'success' : 'info'">{{ project.phase >= 3 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="开工日期">{{ project.start_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="预计完工">{{ project.expected_end_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="人员状态">{{ crewStatusLabel(project.crew_status, project.status) }}</el-descriptions-item>
            <el-descriptions-item label="材料出库">{{ materialStatusLabel(project.material_out_status) }}</el-descriptions-item>
            <el-descriptions-item label="施工备注" :span="2">{{ project.construction_note || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段4: 回库工费/成本 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Select /></el-icon> 回库工费 / 成本</span>
              <el-tag size="small" :type="project.phase >= 4 ? 'success' : 'info'">{{ project.phase >= 4 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="完工日期">{{ project.end_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="验收日期">{{ project.acceptance_date || '未填写' }}</el-descriptions-item>
            <el-descriptions-item label="合同金额">{{ project.total_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="定金">{{ project.deposit_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="材料回库">{{ materialStatusLabel(project.material_return_status) }}</el-descriptions-item>
            <el-descriptions-item label="回库备注">{{ project.material_return_note || '未填写' }}</el-descriptions-item>
          </el-descriptions>
        </el-card>

        <!-- 阶段5: 财务归档 -->
        <el-card class="phase-card">
          <template #header>
            <div class="card-header">
              <span><el-icon><Edit /></el-icon> 财务结算 / 归档</span>
              <el-tag size="small" :type="project.phase >= 5 ? 'success' : 'info'">{{ project.phase >= 5 ? '已完成' : '待进行' }}</el-tag>
            </div>
          </template>
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="工费结算">{{ project.phase >= 4 ? '按流程待附件核对' : '未开始' }}</el-descriptions-item>
            <el-descriptions-item label="成本核算">{{ ['cost_checked', 'finance_settled', 'archived'].includes(project.status) ? '已完成' : '未完成' }}</el-descriptions-item>
            <el-descriptions-item label="结算金额">{{ project.settlement_amount?.toFixed(2) }} 元</el-descriptions-item>
            <el-descriptions-item label="归档状态">{{ project.status === 'archived' ? '已归档' : '未归档' }}</el-descriptions-item>
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
                <el-form-item label="联系方式"><el-input v-model="editForm.phone" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="来源门店/渠道">
                  <el-select v-model="editForm.source" filterable allow-create default-first-option placeholder="选择或输入来源" style="width:100%">
                    <el-option label="门店" value="门店" /><el-option label="微信交底" value="微信交底" />
                    <el-option label="电话交底" value="电话交底" /><el-option label="直接客户" value="直接客户" />
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
            <el-form-item label="门店交底备注"><el-input v-model="editForm.handover_note" type="textarea" :rows="2" /></el-form-item>
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
              <el-col :span="8">
                <el-form-item label="首勘人员">
                  <el-select v-model="editForm.survey_user_id" clearable filterable style="width:100%" placeholder="选择首勘人员">
                    <el-option v-for="u in engineeringAssignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="二勘/复尺人员">
                  <el-select v-model="editForm.recheck_user_id" clearable filterable style="width:100%" placeholder="选择二勘/复尺人员">
                    <el-option v-for="u in engineeringAssignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
              <el-col :span="8">
                <el-form-item label="收尾验收人员">
                  <el-select v-model="editForm.final_inspection_user_id" clearable filterable style="width:100%" placeholder="选择收尾验收人员">
                    <el-option v-for="u in engineeringAssignees" :key="u.id" :label="userOptionLabel(u)" :value="u.id" />
                  </el-select>
                </el-form-item>
              </el-col>
            </el-row>
            <el-row :gutter="16">
              <el-col :span="12">
                <el-form-item label="班组长"><el-input v-model="editForm.team_leader" /></el-form-item>
              </el-col>
              <el-col :span="12">
                <el-form-item label="班组交底日期"><el-input v-model="editForm.briefing_date" placeholder="2026-01-01" /></el-form-item>
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
import { getAuthToken } from '../../utils/authSession'
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, Tools, House, Select, Edit, Service } from '@element-plus/icons-vue'
import AttachmentPanel from '../../components/AttachmentPanel.vue'
import MaterialRequestPanel from '../../components/material/MaterialRequestPanel.vue'
import ProjectDocumentImportPanel from '../../components/projects/ProjectDocumentImportPanel.vue'
import ProjectDocumentSummary from '../../components/projects/ProjectDocumentSummary.vue'
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
const inspectionResult = ref('pass')
const assignees = ref([])
const documentSummaryRef = ref(null)
const documentRefreshKey = ref(0)
const deliveryChain = ref(null)

// 当前用户角色
const userRole = (() => {
  try {
    const t = getAuthToken()
    return JSON.parse(atob(t.split('.')[1])).role || ''
  } catch { return '' }
})()
const userId = (() => {
  try {
    const t = getAuthToken()
    return JSON.parse(atob(t.split('.')[1])).userId || 0
  } catch { return 0 }
})()
const canManageProject = computed(() => ['super_admin', 'admin', 'engineering'].includes(userRole))
const isAssignedEmployee = computed(() => {
  if (!project.value) return false
  return project.value.assignee_user_id === userId
    || project.value.survey_user_id === userId
    || project.value.recheck_user_id === userId
    || project.value.final_inspection_user_id === userId
    || parseCrewMemberIds(project.value.crew_member_user_ids).includes(userId)
})
const canEditProject = computed(() => canManageProject.value || (userRole === 'employee' && isAssignedEmployee.value))
const formattedAddress = computed(() => formatProjectAddress(project.value || {}))
const isProjectClosed = computed(() => ['finance_settled', 'archived', 'repair_done'].includes(project.value?.status))
const engineeringAssignees = computed(() => assignees.value.filter(user => ['super_admin', 'admin', 'engineering'].includes(user.role)))
const currentOwnerLabel = computed(() => project.value?.current_owner_label || currentTask.value.owner || '当前岗位')
const nextOwnerLabel = computed(() => project.value?.next_owner_label || currentTask.value.nextOwner || '下一岗位')
const requiredMissingFields = computed(() => {
  if (!project.value) return []
  const checks = [
    ['source', '来源门店/渠道'],
    ['order_taker', '门店接单人'],
    ['phone', '业主联系方式'],
    ['address_detail', '详细地址']
  ]
  return checks.filter(([field]) => !String(project.value[field] || '').trim()).map(([, label]) => label)
})
const suggestedMissingFields = computed(() => {
  if (!project.value || isProjectClosed.value) return []
  const checks = [
    ['order_date', '接单日期'],
    ['external_order_no', '门店单号'],
    ['handover_note', '门店交底备注']
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
  handover_received: {
    title: '门店交底资料核对',
    desc: '确认客户、电话、地址、施工空间、材料意向、注意事项和门店接单人，资料齐后安排现场勘察。',
    action: '门店交底核对完成，安排勘察',
    next: 'survey_pending',
    roles: ['super_admin', 'admin', 'engineering'],
    required: ['handover', 'survey_assignee']
  },
  survey_pending: {
    title: '现场勘察',
    desc: '上传现场图片、编辑说明并生成工勘 PPT；确认结论后系统会自动决定是否进入复尺。',
    action: '',
    next: '',
    roles: ['super_admin', 'admin', 'engineering'],
    required: ['survey'],
    owner: '工程部/监理',
    nextOwner: '总监/工程部',
    assignedOnly: true
  },
  survey_done: {
    title: '复尺和开工条件复核',
    desc: '需要复尺时打开二次勘察表确认；无需复尺时填写原因，直接交给财务制作项目结算收款单。',
    action: '',
    next: '',
    roles: ['super_admin', 'admin', 'engineering'],
    owner: '总监/工程部',
    nextOwner: '财务',
    assignedOnly: true
  },
  recheck_done: {
    title: '项目结算收款单',
    desc: '复尺已完成，等待财务制作收款单、总监打印签字，并确认进场前 90% 款项。',
    action: '',
    next: '',
    roles: [],
    owner: '财务',
    nextOwner: '总监签字/门店收款确认'
  },
  pre_entry_payment_pending: {
    title: '项目结算收款单',
    desc: '财务制作项目结算收款单，派发总监打印签字并确认门店已收进场前 90% 款项。',
    action: '',
    next: '',
    roles: [],
    owner: '财务',
    nextOwner: '总监签字/门店收款确认'
  },
  payment_received: {
    title: '安排施工组并完成班组交底',
    desc: '进场款已确认，安排班组长、施工负责人、施工成员和班组交底日期，完成后才能出库。',
    action: '班组交底完成，等待出库',
    next: 'briefing_done',
    roles: ['super_admin', 'admin', 'engineering'],
    required: ['assignee', 'briefing_date'],
    owner: '总监/工程部',
    nextOwner: '仓管'
  },
  briefing_done: {
    title: '发起材料出库',
    desc: '请在材料出库单中创建申请。仓库确认后系统自动进入已出库待进场。',
    action: '',
    next: '',
    roles: [],
    owner: '仓管',
    nextOwner: '仓管确认出库后转工程/监理'
  },
  material_requested: {
    title: '等待仓库确认出库',
    desc: '仓库确认会扣减库存并推进到已出库待进场；取消申请会回退到班组交底完成待出库。',
    action: '',
    next: '',
    roles: [],
    owner: '仓管',
    nextOwner: '工程/监理'
  },
  material_out: {
    title: '确认进场开工',
    desc: '确认材料到位、人员安排和实际进场时间，确认后进入施工中。',
    action: '确认进场，开始施工',
    next: 'in_progress',
    roles: ['super_admin', 'admin', 'engineering', 'employee'],
    assignedOnly: true,
    required: ['start_date', 'expected_end_date', 'onsite_team'],
    owner: '工程/监理/施工负责人',
    nextOwner: '工程/监理'
  },
  in_progress: {
    title: '完工验收/撤场确认',
    desc: '确认完工、验收和是否需要整改；通过后才派发给仓库处理材料回库。',
    action: '验收通过，进入材料回库',
    next: 'inspection_done',
    roles: ['super_admin', 'admin', 'engineering', 'employee'],
    assignedOnly: true,
    required: ['final_inspection_assignee', 'end_date', 'acceptance_date', 'construction_note', 'inspection_pass'],
    owner: '工程/监理/施工负责人',
    nextOwner: '仓管'
  },
  inspection_done: {
    title: '材料回库',
    desc: '仓库核对出库明细、实际用量、回库数量和差异，确认后进入工费结算。',
    action: '',
    next: '',
    roles: [],
    owner: '仓管',
    nextOwner: '财务'
  },
  material_returned: {
    title: '工费结算',
    desc: '本阶段等待接入施工班组工费结算单；未形成结算凭证前不能一键跳过。',
    action: '',
    next: '',
    roles: [],
    owner: '财务/工程',
    nextOwner: '财务'
  },
  labor_settled: {
    title: '成本核算',
    desc: '本阶段等待接入完工成本核算表；未形成成本凭证前不能一键跳过。',
    action: '',
    next: '',
    roles: [],
    owner: '财务',
    nextOwner: '财务'
  },
  cost_checked: {
    title: '财务结算',
    desc: '通过下方“财务结算/归档凭证”确认收款和尾款，不能用普通按钮空跳。',
    action: '',
    next: '',
    roles: [],
    owner: '财务',
    nextOwner: '财务/归档'
  },
  finance_settled: {
    title: '归档确认',
    desc: '财务结算完成后，确认资料和附件齐全即可归档。',
    action: '确认归档',
    next: 'archived',
    roles: ['super_admin', 'admin', 'finance'],
    owner: '财务/归档',
    nextOwner: '已完成'
  },
  archived: {
    title: '工单已归档',
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
const deliveryNodes = computed(() => deliveryChain.value?.nodes || [])
const traceSteps = computed(() => deliveryNodes.value)
const needRecheck = computed(() => {
  const recheckNode = deliveryNodes.value.find(node => node.key === 'survey_recheck')
  if (recheckNode?.status && recheckNode.status !== '按需') return true
  const condition = String(project.value?.condition_note || '')
  return /需要二次|需二次|需要复勘|需复勘|整改待复核|问题待复核/.test(condition)
})
const skipRecheck = computed(() => {
  const status = project.value?.status || ''
  const condition = String(project.value?.condition_note || '')
  return !needRecheck.value && ['recheck_done', 'pre_entry_payment_pending', 'payment_received', 'briefing_done', 'material_requested', 'material_out', 'in_progress', 'inspection_done', 'material_returned', 'labor_settled', 'cost_checked', 'finance_settled', 'archived'].includes(status)
    && /无需复尺|跳过复尺/.test(condition)
})
const currentDocumentKey = computed(() => {
  const status = project.value?.status || ''
  if (['survey_pending', 'survey_done'].includes(status)) return needRecheck.value && status === 'survey_done' ? 'survey_recheck' : 'survey_initial'
  if (['recheck_done', 'pre_entry_payment_pending'].includes(status)) return 'project_payment_request'
  if (status === 'payment_received') return 'briefing'
  if (['briefing_done', 'material_requested', 'material_out'].includes(status)) return 'material_io'
  if (status === 'in_progress') return 'completion_inspection'
  if (status === 'inspection_done') return 'material_io'
  if (status === 'material_returned') return 'labor_settlement'
  if (status === 'labor_settled') return 'cost_check'
  if (['cost_checked', 'finance_settled', 'archived'].includes(status)) return 'finance_settlement'
  return ''
})
const currentDocumentLabel = computed(() => {
  if (!currentDocumentKey.value) return '暂无关联单据'
  return deliveryNodes.value.find(node => node.key === currentDocumentKey.value)?.label || {
    survey_initial: '首次工勘表',
    survey_recheck: '二次勘察表',
    project_payment_request: '项目结算收款单',
    briefing: '班组交底单',
    material_io: '材料出库单',
    completion_inspection: '完工验收质检表',
    labor_settlement: '施工班组工费结算单',
    cost_check: '完工成本核算表',
    finance_settlement: '财务结算/归档'
  }[currentDocumentKey.value] || '当前单据'
})
const currentWorkflowStep = computed(() => workflowSteps.value.find(step => step.current) || workflowSteps.value[0] || { label: '当前步骤' })
const currentActionHint = computed(() => {
  if (currentMissingFields.value.length) return `还差 ${currentMissingFields.value.join('、')}，补齐后才能推进。`
  if (currentTask.value.action) return `资料齐后点击「${currentTask.value.action}」。`
  if (project.value?.status === 'archived') return '主流程已结束，可查看归档资料或发起独立售后。'
  if (currentDocumentKey.value) return `请处理「${currentDocumentLabel.value}」相关动作。`
  return '当前阶段暂无需要推进的动作。'
})
const currentStepNote = computed(() => {
  if (project.value?.status === 'survey_pending') return '先上传现场图片、补充说明，再生成 PPT 并确认工勘结果。'
  if (project.value?.status === 'survey_done') return needRecheck.value ? '该项目需要复尺，处理二次勘察后进入收款单。' : '如果确认无需复尺，点击按钮填写原因后进入财务收款单。'
  if (['recheck_done', 'pre_entry_payment_pending'].includes(project.value?.status)) return '财务处理项目结算收款单，确认进场前 90% 款项后才能进入班组交底。'
  if (project.value?.status === 'payment_received') return '核对班组交底单，确认班组、面积、工艺和进场注意事项。'
  if (project.value?.status === 'briefing_done') return '班组交底完成后由仓管填写材料出库单并确认出库。'
  if (project.value?.status === 'material_out') return '工程部确认进场时间、人员和班组安排。'
  if (project.value?.status === 'in_progress') return '施工中先做轻量记录；确认验收通过后交给仓库回库。'
  if (project.value?.status === 'inspection_done') return '验收完成后由仓管填写材料回库单。'
  if (project.value?.status === 'material_returned') return '回库后必须确认施工班组工费结算单，不能用普通按钮跳过。'
  if (project.value?.status === 'labor_settled') return '工费后必须确认完工成本核算表，成本合计不能为空。'
  if (project.value?.status === 'cost_checked') return '成本后必须确认财务结算/归档凭证，收款状态需为已收齐。'
  if (project.value?.status === 'finance_settled') return '归档前会检查关键单据链是否都已确认。'
  if (project.value?.status === 'archived') return '工单已归档，可查看财务归档、成本和收付款口径。'
  return '当前步骤相关资料会在下方资料链中高亮。'
})
const workflowSteps = computed(() => {
  if (!project.value) return []
  const status = project.value.status
  const order = [
    { key: 'handover', label: '门店交底', statuses: ['handover_received'] },
    { key: 'survey', label: '首次工勘', statuses: ['survey_pending'] },
    { key: 'recheck', label: '复尺复核', statuses: ['survey_done'], optional: true },
    { key: 'payment', label: '收款单', statuses: ['recheck_done', 'pre_entry_payment_pending'] },
    { key: 'briefing', label: '班组交底', statuses: ['payment_received'] },
    { key: 'material', label: '出库进场', statuses: ['briefing_done', 'material_requested', 'material_out'] },
    { key: 'build', label: '施工验收', statuses: ['in_progress', 'inspection_done'] },
    { key: 'settle', label: '回库核算', statuses: ['material_returned', 'labor_settled', 'cost_checked'] },
    { key: 'archive', label: '财务归档', statuses: ['finance_settled', 'archived'] }
  ]
  const filtered = order.filter(step => !step.optional || needRecheck.value || skipRecheck.value || status === 'survey_done')
  const currentIndex = Math.max(0, filtered.findIndex(step => step.statuses.includes(status)))
  return filtered.map((step, index) => ({
    ...step,
    current: step.statuses.includes(status),
    done: index < currentIndex || status === 'archived',
    skipped: step.optional && skipRecheck.value,
    target: step.key === 'handover' ? 'current-workbench' : step.key === 'survey' || step.key === 'recheck' || step.key === 'briefing' ? 'documents' : step.key
  }))
})
const canRunCurrentTask = computed(() => {
  const roles = currentTask.value.roles || []
  if (!currentTask.value.next || !roles.length) return false
  if (userRole === 'super_admin') return true
  if (!roles.includes(userRole)) return false
  if (currentTask.value.assignedOnly && ['employee', 'engineering'].includes(userRole)) return isAssignedEmployee.value
  return true
})
const canSkipRecheck = computed(() => {
  if (!project.value || project.value.status !== 'survey_done') return false
  if (!['super_admin', 'admin', 'engineering'].includes(userRole)) return false
  if (userRole === 'super_admin' || userRole === 'admin') return true
  return isAssignedEmployee.value
})
const currentMissingFields = computed(() => missingForTask(currentTask.value.required || []))
const materialRequestDisabledReason = computed(() => {
  if (!project.value) return ''
  if (project.value.status === 'briefing_done') return ''
  if (project.value.status === 'material_requested') return '已发起出库申请，等待仓库确认或取消后才能重新申请。'
  if (['material_out', 'in_progress', 'inspection_done', 'material_returned', 'labor_settled', 'cost_checked', 'finance_settled', 'archived'].includes(project.value.status)) {
    return '该工单已经过了出库申请阶段。'
  }
  return '需要先完成项目结算收款单、确认进场款和班组交底，才能发起材料出库。'
})
const canStartRepair = computed(() => ['super_admin', 'admin', 'engineering'].includes(userRole))
const warrantyInfo = computed(() => {
  const base = project.value?.acceptance_date || project.value?.end_date || ''
  if (!base) return { expired: false, text: '质保期：未填写验收/完工日期，暂无法自动计算。' }
  const start = new Date(`${base}T00:00:00`)
  if (Number.isNaN(start.getTime())) return { expired: false, text: '质保期：日期格式异常，需人工确认。' }
  const end = new Date(start)
  end.setDate(end.getDate() + 30)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const expired = today > end
  const dateText = end.toLocaleDateString('zh-CN')
  return {
    expired,
    text: expired
      ? `质保期已结束（截止 ${dateText}），主工单自动完结。`
      : `30 天质保期内，截止 ${dateText}。`
  }
})

function token() { return getAuthToken() }
function formatTime(t) { return t ? new Date(t).toLocaleString('zh-CN') : '' }
function displayUser(realName, username) { return realName || username || '未分配' }
function userOptionLabel(user) {
  const name = user.real_name || user.username
  const role = user.role_label || user.role
  return `${name}${role ? `（${role}）` : ''}`
}

function missingForTask(required) {
  if (!project.value) return []
  const merged = { ...project.value, ...editForm.value }
  const missing = []
  for (const key of required) {
    if (key === 'handover') missing.push(...requiredMissingFields.value)
    if (key === 'survey_assignee' && !merged.survey_user_id) missing.push('首勘人员')
    if (key === 'survey' && !merged.survey_date) missing.push('工勘日期')
    if (key === 'survey' && !hasMeaningfulText(merged.survey_report, 8)) missing.push('不少于 8 字的工勘记录')
    if (key === 'recheck_assignee' && !merged.recheck_user_id) missing.push('二勘/复尺人员')
    if (key === 'condition_note' && !hasMeaningfulText(merged.condition_note, 8)) missing.push('不少于 8 字的复尺/开工条件复核记录')
    if (key === 'assignee' && !merged.assignee_user_id && !merged.team_leader && !parseCrewMemberIds(merged.crew_member_user_ids).length) missing.push('施工负责人、班组长或施工成员')
    if (key === 'briefing_date' && !merged.briefing_date) missing.push('班组交底日期')
    if (key === 'start_date' && !merged.start_date) missing.push('开工日期')
    if (key === 'expected_end_date' && !merged.expected_end_date) missing.push('预计完工日期')
    if (key === 'onsite_team' && !merged.assignee_user_id && !merged.team_leader && !parseCrewMemberIds(merged.crew_member_user_ids).length) missing.push('施工负责人、班组长或施工成员')
    if (key === 'construction_note' && !hasMeaningfulText(merged.construction_note, 10)) missing.push('不少于 10 字的施工/验收记录')
    if (key === 'final_inspection_assignee' && !merged.final_inspection_user_id) missing.push('收尾验收人员')
    if (key === 'end_date' && !merged.end_date) missing.push('完工日期')
    if (key === 'acceptance_date' && !merged.acceptance_date) missing.push('验收日期')
    if (key === 'inspection_pass' && (inspectionResult.value !== 'pass' || !hasPassConclusion(merged.construction_note))) missing.push('明确的验收通过/允许回库结论')
    if (key === 'material_return' && merged.material_return_status !== 'done') missing.push('材料回库状态')
    if (key === 'settlement_amount' && !Number(merged.settlement_amount)) missing.push('结算金额')
  }
  return [...new Set(missing)]
}

function hasMeaningfulText(value, minLength = 1) {
  return String(value || '').trim().length >= minLength
}

function hasPassConclusion(value) {
  const text = String(value || '')
  if (/需要整改|不允许进入回库|整改未完成|验收不通过/.test(text)) return false
  return /验收通过|允许进入回库|客户确认|内部验收通过|合格/.test(text)
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

async function handleAttachmentsUpdated() {
  documentRefreshKey.value += 1
  await fetchDetail()
}

function handleDeliveryChainUpdated(chain) {
  deliveryChain.value = chain
}

function scrollToWorkflowSection(step = {}) {
  const target = step.target || 'current-workbench'
  const id = target === 'documents' ? 'project-documents' : target === 'current-workbench' ? 'current-workbench' : ''
  if (!id) return
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function openCurrentDocument() {
  if (!currentDocumentKey.value) return
  const opened = documentSummaryRef.value?.openDocument?.(currentDocumentKey.value)
  if (opened) return
  scrollToWorkflowSection({ target: 'documents' })
}

async function skipSurveyRecheck() {
  if (!canSkipRecheck.value) return
  try {
    const { value } = await ElMessageBox.prompt(
      '请填写跳过复尺的原因，例如“首次工勘确认基层和面积无争议，门店确认无需复尺”。',
      '无需复尺，直接进入收款单',
      {
        confirmButtonText: '确认跳过并交给财务',
        cancelButtonText: '取消',
        inputType: 'textarea',
        inputPlaceholder: '不少于 6 个字',
        inputPattern: /[\s\S]{6,}/,
        inputErrorMessage: '跳过原因不能少于 6 个字'
      }
    )
    saving.value = true
    const res = await fetch(`/api/projects/${route.params.id}/delivery-chain/survey-recheck/skip`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ reason: value })
    })
    const json = await readJson(res)
    if (!res.ok || !json.success) throw new Error(json.message || '跳过复尺失败')
    ElMessage.success('已记录跳过复尺，项目进入财务收款单')
    documentRefreshKey.value += 1
    await fetchDetail()
  } catch (err) {
    if (err !== 'cancel') ElMessage.error(err.message || '跳过复尺失败')
  } finally {
    saving.value = false
  }
}

async function fetchAssignees() {
  try {
    const res = await fetch('/api/projects/assignees', {
      headers: { Authorization: `Bearer ${token()}` }
    })
    const json = await res.json()
    if (json.success) assignees.value = json.data
  } catch (e) { console.warn('加载可分配人员失败', e) }
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
    prepareCurrentStepPayload(statusKey)
    await saveProjectFields()
    await advanceStatus(statusKey, true)
  } catch (err) {
    ElMessage.error(err.message || '操作失败，请稍后重试')
  } finally {
    saving.value = false
  }
}

function prepareCurrentStepPayload(statusKey) {
  if (project.value?.status === 'material_out' && statusKey === 'in_progress') {
    editForm.value.crew_status = 'working'
    if (!String(editForm.value.construction_note || '').trim()) {
      editForm.value.construction_note = '材料已出库，人员已安排，确认进场开工。'
    }
  }
  if (project.value?.status === 'in_progress' && statusKey === 'inspection_done') {
    if (inspectionResult.value !== 'pass') return
    editForm.value.crew_status = 'released'
    const note = String(editForm.value.construction_note || '').trim()
    if (!/验收通过/.test(note)) {
      editForm.value.construction_note = note ? `${note}\n验收通过，允许进入材料回库。` : '验收通过，允许进入材料回库。'
    }
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
    'manager_user_id', 'assignee_user_id', 'survey_user_id', 'recheck_user_id', 'final_inspection_user_id']
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
  body.survey_user_id = body.survey_user_id || 0
  body.recheck_user_id = body.recheck_user_id || 0
  body.final_inspection_user_id = body.final_inspection_user_id || 0
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

function crewStatusLabel(value, status = '') {
  if (['inspection_done', 'material_returned', 'labor_settled', 'cost_checked', 'finance_settled', 'archived'].includes(status)) {
    return '已完工/已撤场'
  }
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
  border: 0;
  background: transparent;
  cursor: pointer;
  min-width: 0;
}
.phase-step:not(:last-child)::after {
  content: ''; position: absolute; top: 16px; left: 60%; right: -40%;
  height: 2px; background: var(--border-light);
}
.phase-step.active:not(:last-child)::after { background: color-mix(in srgb, #22c55e 52%, var(--border-light)); }
.step-dot {
  width: 32px; height: 32px; line-height: 32px; border-radius: 50%;
  background: #f0f0f0; color: var(--text-tertiary); font-weight: bold; margin: 0 auto 8px;
  font-size: 13px;
}
.phase-step.active:not(.current) .step-dot { background: #22c55e; color: #fff; }
.phase-step.current .step-dot {
  background: var(--color-primary);
  color: #fff;
  box-shadow: 0 0 0 4px rgba(79,109,245,0.25);
}
.phase-step.skipped .step-dot {
  background: color-mix(in srgb, #64748b 18%, var(--bg-page));
  color: var(--text-tertiary);
}
.step-label { font-size: 13px; color: var(--text-tertiary); }
.phase-step.active:not(.current) .step-label { color: #16a34a; font-weight: 500; }
.phase-step.current .step-label { color: var(--color-primary); font-weight: 600; }
.phase-step small {
  display: block;
  margin-top: 2px;
  color: var(--text-placeholder);
  font-size: 11px;
}
.current-workbench {
  margin-bottom: 16px;
  border: 1px solid color-mix(in srgb, var(--color-primary) 34%, var(--border-light));
  box-shadow: 0 10px 26px color-mix(in srgb, var(--color-primary) 8%, transparent);
}
.current-workbench-head {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-start;
}
.current-workbench-head h3 {
  margin: 0 0 4px;
  color: var(--text-primary);
  font-size: 19px;
}
.current-workbench-head p {
  margin: 0;
  color: var(--text-tertiary);
  font-size: 13px;
}
.current-workbench-body {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  gap: 14px;
}
.next-action-card,
.step-context-card {
  min-width: 0;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  background: color-mix(in srgb, var(--bg-card) 88%, var(--bg-page));
}
.next-action-card strong,
.next-action-card span,
.step-context-card span,
.step-context-card strong,
.step-context-card p {
  display: block;
}
.next-action-card > strong {
  margin-bottom: 4px;
  color: var(--text-primary);
  font-size: 16px;
}
.next-action-card > span,
.step-context-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.5;
}
.step-context-card span {
  margin-bottom: 4px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
}
.step-context-card strong {
  margin-bottom: 7px;
  color: var(--text-primary);
  font-size: 15px;
}
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
.trace-card {
  margin-bottom: 20px;
  border: 1px solid var(--border-light);
}
.trace-list {
  display: grid;
  gap: 10px;
}
.trace-item {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 12px;
  padding: 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 92%, var(--bg-page));
}
.trace-item.confirmed {
  border-color: color-mix(in srgb, #22c55e 32%, var(--border-light));
  background: color-mix(in srgb, #22c55e 6%, var(--bg-card));
}
.trace-main strong,
.trace-main span,
.trace-meta span {
  display: block;
}
.trace-main strong {
  color: var(--text-primary);
}
.trace-main span,
.trace-meta span {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.55;
}
.trace-meta {
  min-width: 0;
  display: grid;
  gap: 4px;
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
.handoff-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
  color: var(--text-secondary);
  font-size: 13px;
}
.handoff-line span {
  padding: 5px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--color-primary) 8%, var(--bg-page));
}
.handoff-line b {
  color: var(--text-primary);
}
.work-form {
  max-width: 960px;
}
.stage-hint {
  display: grid;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--bg-card) 86%, var(--bg-page));
}
.stage-hint strong {
  color: var(--text-primary);
}
.stage-hint span {
  color: var(--text-secondary);
  font-size: 13px;
}
.work-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  padding-top: 6px;
}
.work-actions.compact {
  margin-top: 12px;
  padding-top: 0;
}
.task-blocker {
  margin: 4px 0 12px;
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #ef4444 10%, var(--bg-card));
  color: #b91c1c;
  font-size: 13px;
}
.task-blocker.inline {
  margin: 10px 0 0;
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
.warranty-line {
  margin-top: 12px;
  padding: 9px 10px;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, #10b981 10%, var(--bg-card));
  color: #047857;
  font-size: 13px;
}
.warranty-line.expired {
  background: color-mix(in srgb, #64748b 12%, var(--bg-card));
  color: var(--text-secondary);
}
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
  .current-workbench-body {
    grid-template-columns: 1fr;
  }
  .trace-item {
    grid-template-columns: 1fr;
  }
  .phase-steps {
    overflow-x: auto;
  }
  .phase-step {
    min-width: 92px;
  }
}
</style>
