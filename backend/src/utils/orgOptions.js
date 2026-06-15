export const DEPARTMENT_POSITION_OPTIONS = [
  { department: '工程部', positions: ['监理'] },
  { department: '财务部', positions: ['财务'] },
  { department: '仓库', positions: ['仓管'] },
  { department: '样板开发', positions: ['样板开发'] }
]

export function isValidDepartmentPosition(department, position) {
  const dept = DEPARTMENT_POSITION_OPTIONS.find(item => item.department === department)
  return !!dept && dept.positions.includes(position)
}

export function departmentPositionPayload() {
  return DEPARTMENT_POSITION_OPTIONS.map(item => ({
    department: item.department,
    positions: [...item.positions]
  }))
}
