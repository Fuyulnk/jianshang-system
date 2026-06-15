export const DEFAULT_DEPARTMENT_POSITION_OPTIONS = [
  { department: '工程部', positions: ['监理'] },
  { department: '财务部', positions: ['财务'] },
  { department: '仓库', positions: ['仓管'] },
  { department: '样板开发', positions: ['样板开发'] }
]

export function toDepartmentCascaderOptions(data = DEFAULT_DEPARTMENT_POSITION_OPTIONS) {
  const source = Array.isArray(data) && data.length ? data : DEFAULT_DEPARTMENT_POSITION_OPTIONS
  return source.map(item => ({
    value: item.department,
    label: item.department,
    children: (item.positions || []).map(position => ({
      value: position,
      label: position
    }))
  }))
}
