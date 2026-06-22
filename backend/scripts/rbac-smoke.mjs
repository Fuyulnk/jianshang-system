import Database from 'better-sqlite3'
import { resolve } from 'path'
import { canAccessModule, canAccessProjectRecord, getDataScope } from '../src/utils/permissions.js'

const dbPath = resolve(process.argv[2] || 'data/safe-ai-test.db')
const db = new Database(dbPath, { readonly: true })

const users = {
  finance: { userId: 201, role: 'finance', assignment_status: 'assigned' },
  warehouse: { userId: 202, role: 'warehouse', assignment_status: 'assigned' },
  employee: { userId: 104, role: 'employee', assignment_status: 'assigned' },
  pending: { userId: 205, role: 'employee', assignment_status: 'pending' }
}
const project = db.prepare('SELECT * FROM projects WHERE name = ?').get('测试项目A')
const results = []

check('finance can view finance', canAccessModule(db, users.finance, 'finance', 'can_view'))
check('finance can create projects', canAccessModule(db, users.finance, 'projects', 'can_create'))
check('finance cannot view products in test role policy', !canAccessModule(db, users.finance, 'products', 'can_view'))
check('warehouse can edit products', canAccessModule(db, users.warehouse, 'products', 'can_edit'))
check('warehouse cannot view finance', !canAccessModule(db, users.warehouse, 'finance', 'can_view'))
check('employee can view linked project', canAccessProjectRecord(db, users.employee, project))
check('employee project scope is project_related', getDataScope(db, users.employee, 'projects') === 'project_related')
check('pending cannot view projects', !canAccessModule(db, users.pending, 'projects', 'can_view'))
check('pending cannot view linked project', !canAccessProjectRecord(db, users.pending, project))

db.close()
const failed = results.filter(item => !item.ok)
console.table(results)
if (failed.length) {
  console.error(`RBAC smoke failed: ${failed.map(item => item.name).join(', ')}`)
  process.exit(1)
}
console.log('RBAC smoke passed')

function check(name, ok) {
  results.push({ name, ok: Boolean(ok) })
}
