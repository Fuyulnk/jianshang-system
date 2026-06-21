export const DATABASE_TABLE_CATALOG = [
  { table: 'users', domain: 'identity', owner: '账号', purpose: '登录账号、角色、注册状态、AI 偏好和员工档案绑定' },
  { table: 'employees', domain: 'identity', owner: '员工档案', purpose: '员工姓名、部门、岗位、手机号和在职状态' },
  { table: 'roles', domain: 'identity', owner: '权限', purpose: '角色定义' },
  { table: 'role_permissions', domain: 'identity', owner: '权限', purpose: '模块权限和数据范围' },
  { table: 'products', domain: 'inventory', owner: '仓库', purpose: '材料 SKU、规格、单位、价格、库存和测试材料标记' },
  { table: 'inventory_movements', domain: 'inventory', owner: '仓库', purpose: '库存流水，记录入库、出库、回库和手动调整' },
  { table: 'material_losses', domain: 'inventory', owner: '仓库/工程', purpose: '项目损耗记录' },
  { table: 'projects', domain: 'projects', owner: '工程/总监/财务', purpose: '项目主数据、流程状态、负责人和金额概要' },
  { table: 'project_logs', domain: 'projects', owner: '项目流程', purpose: '项目状态、单据和交接日志' },
  { table: 'project_documents', domain: 'project_documents', owner: '项目单据链', purpose: '交底、工勘、收款、出库、回库、工费、成本、财务归档等单据版本' },
  { table: 'project_import_batches', domain: 'project_documents', owner: '门店交底导入', purpose: '批量导入批次' },
  { table: 'project_import_items', domain: 'project_documents', owner: '门店交底导入', purpose: '批量导入行项目草稿' },
  { table: 'material_requests', domain: 'project_documents', owner: '材料出入库单', purpose: '材料出库申请和回库确认主单' },
  { table: 'material_request_items', domain: 'project_documents', owner: '材料出入库单', purpose: '材料明细、出库、回库、实际用量和金额' },
  { table: 'accounts', domain: 'finance', owner: '财务', purpose: '收付款账户' },
  { table: 'transactions', domain: 'finance', owner: '财务', purpose: '财务交易流水' },
  { table: 'finance_ledger_workbooks', domain: 'finance', owner: '财务入账登记表', purpose: '入账登记表工作簿' },
  { table: 'finance_ledger_sheets', domain: 'finance', owner: '财务入账登记表', purpose: '入账登记表工作表' },
  { table: 'finance_ledger_cells', domain: 'finance', owner: '财务入账登记表', purpose: '入账登记表单元格值' },
  { table: 'finance_ledger_comments', domain: 'finance', owner: '财务入账登记表', purpose: '入账登记表单元格备注' },
  { table: 'document_templates', domain: 'project_documents', owner: '固定表格模板', purpose: '系统内置模板版本和受控文件路径' },
  { table: 'document_template_mappings', domain: 'project_documents', owner: '固定表格模板', purpose: '系统字段到 Excel 单元格映射' },
  { table: 'document_exports', domain: 'project_documents', owner: '固定表格模板', purpose: '原格式导出记录' },
  { table: 'attachments', domain: 'files', owner: '文件附件', purpose: '业务附件元数据和归属' },
  { table: 'chat_files', domain: 'files', owner: '聊天文件', purpose: '聊天附件元数据' },
  { table: 'private_workspaces', domain: 'files', owner: '私有工作区', purpose: '总监/私有资料空间' },
  { table: 'resource_access_grants', domain: 'files', owner: '私有授权', purpose: '私有资源授权' },
  { table: 'access_audit_logs', domain: 'files', owner: '访问审计', purpose: '附件、私有资源和敏感访问审计' },
  { table: 'ai_agents', domain: 'ai', owner: 'AI 分身', purpose: 'AI 分身配置' },
  { table: 'ai_tool_registry', domain: 'ai', owner: 'AI 工具', purpose: 'AI 工具注册表' },
  { table: 'ai_audit_logs', domain: 'ai', owner: 'AI 审计', purpose: 'AI 聊天和工具调用审计' }
]

export const API_INTERFACE_CATALOG = [
  { path: '/api/products', domain: 'inventory', reads: ['products'], writes: ['products', 'inventory_movements'], query: ['query', 'limit'] },
  { path: '/api/inventory-movements', domain: 'inventory', reads: ['inventory_movements', 'products', 'projects', 'users'], writes: [], query: ['limit'] },
  { path: '/api/projects', domain: 'projects', reads: ['projects', 'users'], writes: ['projects', 'project_logs'], query: ['query', 'keyword', 'status', 'phase', 'limit'] },
  { path: '/api/projects/:id/delivery-chain', domain: 'project_documents', reads: ['project_documents', 'attachments'], writes: [], query: [] },
  { path: '/api/projects/:id/delivery-chain/:type/*', domain: 'project_documents', reads: ['projects', 'project_documents', 'attachments'], writes: ['project_documents', 'project_logs', 'attachments'], query: [] },
  { path: '/api/finance/*', domain: 'finance', reads: ['accounts', 'transactions', 'finance_ledger_*', 'project_documents'], writes: ['finance_ledger_*', 'document_exports'], query: ['query', 'limit'] },
  { path: '/api/transactions', domain: 'finance', reads: ['transactions', 'accounts'], writes: ['transactions', 'accounts'], query: ['query', 'keyword', 'type', 'category', 'start_date', 'end_date'] },
  { path: '/api/employees', domain: 'identity', reads: ['employees', 'users'], writes: ['employees', 'users'], query: ['query', 'status', 'limit'] },
  { path: '/api/users', domain: 'identity', reads: ['users', 'roles', 'employees'], writes: ['users'], query: [] },
  { path: '/api/files', domain: 'files', reads: ['attachments'], writes: ['attachments', 'access_audit_logs'], query: ['entity_type', 'entity_id', 'keyword', 'limit'] },
  { path: '/api/ai/chat', domain: 'ai', reads: ['ai_agents', 'ai_*', 'chat_history'], writes: ['chat_history', 'ai_audit_logs'], query: [] }
]

export const FIELD_OWNERSHIP_CATALOG = [
  { field_group: '材料 SKU', owner_table: 'products', owner_domain: 'inventory', examples: ['name', 'spec', 'unit', 'stock', 'min_stock', 'is_test'] },
  { field_group: '库存流水', owner_table: 'inventory_movements', owner_domain: 'inventory', examples: ['product_id', 'project_id', 'movement_type', 'quantity_delta', 'quantity_after'] },
  { field_group: '项目主状态', owner_table: 'projects', owner_domain: 'projects', examples: ['status', 'manager_user_id', 'survey_user_id', 'recheck_user_id', 'final_inspection_user_id'] },
  { field_group: '门店交底基础资料', owner_table: 'projects + project_documents', owner_domain: 'projects/project_documents', examples: ['customer', 'phone', 'address_detail', 'source', 'order_taker', 'handover_note'] },
  { field_group: '项目单据结构化内容', owner_table: 'project_documents', owner_domain: 'project_documents', examples: ['document_type', 'confirmed_data', 'warnings', 'status', 'source_attachment_id'] },
  { field_group: '材料出入库单', owner_table: 'material_requests + material_request_items', owner_domain: 'project_documents/inventory', examples: ['out_quantity', 'return_quantity', 'usage_quantity', 'amount'] },
  { field_group: '财务交易流水', owner_table: 'transactions', owner_domain: 'finance', examples: ['account_id', 'type', 'amount', 'category', 'description', 'party'] },
  { field_group: '入账登记表', owner_table: 'finance_ledger_*', owner_domain: 'finance', examples: ['workbook_id', 'sheet_id', 'row_index', 'col_index', 'value', 'comment_text'] },
  { field_group: '固定模板映射', owner_table: 'document_templates + document_template_mappings', owner_domain: 'project_documents', examples: ['document_type', 'template_version', 'source_file_path', 'field_key', 'cell_address'] },
  { field_group: '附件归属', owner_table: 'attachments', owner_domain: 'files', examples: ['entity_type', 'entity_id', 'stored_name', 'uploaded_by', 'deleted_at'] }
]

export const BUSINESS_DICTIONARY_CATALOG = [
  { key: 'data_domains', file: 'businessDictionaries.js', purpose: '6 个核心数据域和对应接口/事实服务口径' },
  { key: 'org_department_positions', file: 'businessDictionaries.js', purpose: '员工自注册和管理员建档可用的部门-职位组合' },
  { key: 'project_statuses', file: 'businessDictionaries.js', purpose: '项目状态、阶段、旧状态别名、下一步说明' },
  { key: 'project_document_types', file: 'businessDictionaries.js', purpose: '项目资料链和固定表格模板共用的单据类型' },
  { key: 'material_units', file: 'businessDictionaries.js', purpose: '仓库材料单位基础字典' },
  { key: 'finance_categories', file: 'businessDictionaries.js', purpose: '财务流水分类基础字典' },
  { key: 'ai_tool_types', file: 'businessDictionaries.js + ai/toolRegistry.js', purpose: 'AI 工具分级、风险等级、动作类型和具体工具注册表' }
]
