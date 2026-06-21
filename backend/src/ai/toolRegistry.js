export const AI_TOOL_REGISTRY = [
  {
    name: 'get_accounts',
    label: '查看账户',
    desc: '查询账户名称、类型和余额',
    tier: 'L1',
    risk_level: 'low',
    action_type: 'tool_read',
    schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_transactions',
    label: '查看流水',
    desc: '按时间和收支类型查询交易记录',
    tier: 'L1',
    risk_level: 'medium',
    action_type: 'tool_read',
    schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: '近N天的交易，默认30' },
        type: { type: 'string', enum: ['income', 'expense'], description: '交易类型' },
        query: { type: 'string', description: '按账户、分类、摘要或对方关键词搜索' },
        limit: { type: 'number', description: '返回数量，默认100，最多300' }
      },
      required: []
    }
  },
  {
    name: 'get_today_summary',
    label: '今日收支汇总',
    desc: '查询今日收入、支出和交易笔数',
    tier: 'L1',
    risk_level: 'low',
    action_type: 'tool_read',
    schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'get_products',
    label: '查看库存产品',
    desc: '查询产品名称、规格、分类、单位、库存、测试材料标记和低库存状态',
    tier: 'L1',
    risk_level: 'low',
    action_type: 'tool_read',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '材料名称、规格、分类或单位关键词，如 霞光沙 5L' },
        limit: { type: 'number', description: '返回数量，默认100，最多300' }
      },
      required: []
    }
  },
  {
    name: 'get_employees',
    label: '查看员工',
    desc: '查询员工姓名、部门、岗位和状态',
    tier: 'L1',
    risk_level: 'medium',
    action_type: 'tool_read',
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '员工姓名、手机号、部门、岗位或账号关键词' },
        status: { type: 'string', description: '员工状态，如 active' },
        limit: { type: 'number', description: '返回数量，默认100，最多300' }
      },
      required: []
    }
  },
  {
    name: 'get_projects',
    label: '查看项目工单',
    desc: '按阶段或状态查询当前用户可见的项目工单',
    tier: 'L1',
    risk_level: 'medium',
    action_type: 'tool_read',
    schema: {
      type: 'object',
      properties: {
        phase: { type: 'number', description: '阶段编号 1=门店交底/勘察 2=复尺/收款/班组交底 3=施工验收 4=回库核算 5=财务归档 6=售后处理' },
        status: { type: 'string', description: '工单状态，如 handover_received、survey_pending、cost_checked、archived' },
        query: { type: 'string', description: '项目名、客户、电话或地址关键词' },
        limit: { type: 'number', description: '返回数量，默认100，最多300' }
      },
      required: []
    }
  },
  {
    name: 'get_project_documents',
    label: '查看项目资料链',
    desc: '查询当前用户可见项目的单据缺失、已有、多版本和上传确认情况',
    tier: 'L1',
    risk_level: 'medium',
    action_type: 'tool_read',
    schema: {
      type: 'object',
      properties: {
        project_id: { type: 'number', description: '项目 ID' }
      },
      required: ['project_id']
    }
  },
  {
    name: 'get_project_profit_summary',
    label: '查看项目利润粗算',
    desc: '查询财务可见的项目收入、成本、毛利、尾款和异常提醒',
    tier: 'L1',
    risk_level: 'medium',
    action_type: 'tool_read',
    schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '返回项目数量，默认20，最多50' }
      },
      required: []
    }
  },
  {
    name: 'get_system_stats',
    label: '系统概况',
    desc: '查询账户、今日流水、产品和员工数量',
    tier: 'L1',
    risk_level: 'low',
    action_type: 'tool_read',
    schema: { type: 'object', properties: {}, required: [] }
  },
  {
    name: 'parse_finance_transaction',
    label: '解析财务消息草稿',
    desc: '把财务群收支消息拆成待确认草稿，不直接写入流水',
    tier: 'L2',
    risk_level: 'medium',
    action_type: 'tool_draft',
    schema: {
      type: 'object',
      properties: {
        raw_text: { type: 'string', description: '财务群原始消息，如 支付材料款2000 简尚建设' }
      },
      required: ['raw_text']
    }
  },
  {
    name: 'create_transaction',
    label: '确认写入流水',
    desc: '用户明确确认后新增一笔交易流水',
    tier: 'L3',
    risk_level: 'high',
    action_type: 'tool_write',
    requires_confirmation: true,
    schema: {
      type: 'object',
      properties: {
        confirmed: { type: 'boolean', description: '用户是否已明确确认写入' },
        account_id: { type: 'number', description: '账户ID，先调用 get_accounts 获取' },
        type: { type: 'string', enum: ['income', 'expense'], description: '收入/支出' },
        amount: { type: 'number', description: '金额，正数' },
        category: { type: 'string', description: '分类，如材料费、工资、收入等' },
        description: { type: 'string', description: '备注说明' },
        party: { type: 'string', description: '交易对方' }
      },
      required: ['confirmed', 'account_id', 'type', 'amount', 'category']
    }
  },
  {
    name: 'create_account',
    label: '确认创建账户',
    desc: '用户明确确认后新增一个账户',
    tier: 'L3',
    risk_level: 'high',
    action_type: 'tool_write',
    requires_confirmation: true,
    schema: {
      type: 'object',
      properties: {
        confirmed: { type: 'boolean', description: '用户是否已明确确认创建' },
        name: { type: 'string', description: '账户名称' },
        type: { type: 'string', enum: ['company', 'personal'], description: '账户类型' }
      },
      required: ['confirmed', 'name', 'type']
    }
  },
  {
    name: 'parse_project_handover',
    label: '解析项目交底草稿',
    desc: '把门店/渠道交底文字拆分成一个或多个项目工单草稿',
    tier: 'L2',
    risk_level: 'medium',
    action_type: 'tool_draft',
    schema: {
      type: 'object',
      properties: {
        raw_text: { type: 'string', description: '微信、电话记录或交底单文字' }
      },
      required: ['raw_text']
    }
  },
  {
    name: 'create_project_workorder',
    label: '确认创建项目工单',
    desc: '用户明确确认后创建项目工单',
    tier: 'L3',
    risk_level: 'high',
    action_type: 'tool_write',
    requires_confirmation: true,
    schema: {
      type: 'object',
      properties: {
        confirmed: { type: 'boolean', description: '用户是否已明确确认创建' },
        name: { type: 'string', description: '工单名称' },
        customer: { type: 'string', description: '业主/客户' },
        phone: { type: 'string', description: '业主联系方式' },
        source: { type: 'string', description: '来源门店/渠道' },
        order_taker: { type: 'string', description: '门店接单人' },
        order_date: { type: 'string', description: '接单日期 YYYY-MM-DD' },
        external_order_no: { type: 'string', description: '门店单号/合同号' },
        address_province: { type: 'string', description: '省份' },
        address_city: { type: 'string', description: '城市' },
        address_detail: { type: 'string', description: '详细地址' },
        handover_note: { type: 'string', description: '门店交底备注' },
        total_amount: { type: 'number', description: '合同金额' }
      },
      required: ['confirmed', 'name', 'customer']
    }
  }
]

export const DEFAULT_AI_AGENTS = [
  {
    key: 'general',
    name: '简尚总助手',
    purpose: '查项目、查库存、解释流程和系统功能',
    scenario_type: 'general',
    is_default: 1,
    memory_enabled: 0,
    memory_retention_days: 7,
    allowed_roles: ['super_admin', 'admin', 'finance', 'warehouse', 'engineering', 'employee'],
    tools: ['get_projects', 'get_project_documents', 'get_products', 'get_system_stats', 'get_project_profit_summary', 'parse_project_handover', 'create_project_workorder'],
    base_prompt: '你是简尚总助手。优先查询系统事实，再用简洁中文解释流程和下一步。写入动作必须先让用户确认。'
  },
  {
    key: 'finance',
    name: '财务助手',
    purpose: '解析财务消息、查询账户流水、生成收支录入草稿',
    scenario_type: 'finance',
    memory_enabled: 0,
    memory_retention_days: 7,
    allowed_roles: ['super_admin', 'admin', 'finance'],
    tools: ['get_accounts', 'get_transactions', 'get_today_summary', 'get_system_stats', 'get_project_profit_summary', 'parse_finance_transaction', 'create_transaction'],
    base_prompt: '你是简尚财务助手。财务消息先解析成草稿，用户明确确认后才能写入流水。不要猜账户余额和金额，必须查系统数据。'
  },
  {
    key: 'warehouse',
    name: '仓库助手',
    purpose: '查询库存、识别产品信息、提示低库存',
    scenario_type: 'warehouse',
    memory_enabled: 0,
    memory_retention_days: 7,
    allowed_roles: ['super_admin', 'admin', 'warehouse', 'engineering'],
    tools: ['get_products', 'get_projects', 'get_project_documents', 'get_system_stats'],
    base_prompt: '你是简尚仓库助手。回答产品、分类、规格、单位和库存时必须以系统查询结果为准。'
  },
  {
    key: 'project',
    name: '项目助手',
    purpose: '查询项目状态、缺资料、下一步和负责人',
    scenario_type: 'project',
    memory_enabled: 0,
    memory_retention_days: 7,
    allowed_roles: ['super_admin', 'admin', 'finance', 'warehouse', 'engineering', 'employee'],
    tools: ['get_projects', 'get_project_documents', 'get_products', 'get_project_profit_summary', 'parse_project_handover', 'create_project_workorder'],
    base_prompt: '你是简尚项目助手。重点回答项目在哪一步、缺什么、下一步谁处理。AI 只能检查和生成草稿，不能绕过人工确认。'
  }
]

export function buildToolSchemas() {
  return AI_TOOL_REGISTRY.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.desc,
      parameters: tool.schema
    }
  }))
}

export function toolMeta(name) {
  return AI_TOOL_REGISTRY.find(tool => tool.name === name) || {
    name,
    label: name,
    desc: '',
    tier: 'L1',
    risk_level: 'medium',
    action_type: 'tool_read'
  }
}
