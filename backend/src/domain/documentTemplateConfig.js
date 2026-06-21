export const SYSTEM_DOCUMENT_TEMPLATES = [
  {
    document_type: 'project_payment_request',
    title: '项目结算收款单',
    template_version: 'v1',
    file_name: 'project_payment_request_v1.xlsx',
    mappings: [
      { field_key: 'project.name', field_label: '项目名称', cell_address: 'A1', value_type: 'text', required: 1 },
      { field_key: 'project.address', field_label: '项目地址', cell_address: 'A2', value_type: 'text', required: 1 },
      { field_key: 'payment_request.request_no', field_label: '结算单号', cell_address: 'A3', value_type: 'text', required: 0 },
      { field_key: 'project.source', field_label: '单源', cell_address: 'B5', value_type: 'text', required: 0 },
      { field_key: 'payment_request.designer', field_label: '设计师', cell_address: 'C5', value_type: 'text', required: 0 },
      { field_key: 'project.order_date', field_label: '接单时间', cell_address: 'E5', value_type: 'date', required: 0 },
      { field_key: 'project.order_taker', field_label: '销售顾问', cell_address: 'G5', value_type: 'text', required: 0 },
      { field_key: 'payment_request.sales_phone', field_label: '销售电话', cell_address: 'I5', value_type: 'text', required: 0 },
      { field_key: 'project.customer', field_label: '客户姓名', cell_address: 'C6', value_type: 'text', required: 1 },
      { field_key: 'project.phone', field_label: '客户电话', cell_address: 'E6', value_type: 'text', required: 0 },
      { field_key: 'project.address_detail', field_label: '详细地址', cell_address: 'G6', value_type: 'text', required: 1 },
      { field_key: 'payment_request.expected_start_date', field_label: '预计开工时间', cell_address: 'C7', value_type: 'date', required: 0 },
      { field_key: 'payment_request.expected_duration', field_label: '预计总工期', cell_address: 'E7', value_type: 'text', required: 0 },
      { field_key: 'payment_request.entry_method', field_label: '进入方式', cell_address: 'G7', value_type: 'text', required: 0 },
      { field_key: 'payment_request.total_area', field_label: '施工总面积', cell_address: 'C8', value_type: 'number', required: 0 },
      { field_key: 'payment_request.needs_recheck', field_label: '是否复尺', cell_address: 'E8', value_type: 'text', required: 0 },
      { field_key: 'payment_request.car_plate_report_required', field_label: '车牌是否需要报备', cell_address: 'H8', value_type: 'text', required: 0 },
      { field_key: 'summary.contract_amount', field_label: '合同金额', cell_address: 'I19', value_type: 'money', required: 1 },
      { field_key: 'summary.received_amount', field_label: '本次付款', cell_address: 'I20', value_type: 'money', required: 1 },
      { field_key: 'summary.tail_amount', field_label: '尾款', cell_address: 'I21', value_type: 'money', required: 0 },
      { field_key: 'payment_request.note', field_label: '其他事项说明', cell_address: 'B23', value_type: 'text', required: 0 }
    ]
  },
  {
    document_type: 'finance_ledger',
    title: '入账登记表',
    template_version: 'v1',
    file_name: 'finance_ledger_v1.xlsx',
    mappings: [
      { field_key: 'workbook.grid_cells', field_label: '表格单元格数据', cell_address: 'A1', value_type: 'grid', required: 1 }
    ]
  }
]
