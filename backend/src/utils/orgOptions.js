import { ORG_DEPARTMENT_POSITIONS } from '../domain/businessDictionaries.js'

export const DEPARTMENT_POSITION_OPTIONS = ORG_DEPARTMENT_POSITIONS
  .filter(item => item.registration_allowed)
  .map(item => ({
    department: item.department,
    positions: [...item.positions]
  }))

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
