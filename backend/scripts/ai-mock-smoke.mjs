import Database from 'better-sqlite3'
import { resolve } from 'path'
import { executeTool } from '../src/routes/ai.js'

const dbPath = resolve(process.argv[2] || 'data/safe-ai-test.db')
const db = new Database(dbPath, { readonly: true })
const warehouseUser = { userId: 202, role: 'warehouse', assignment_status: 'assigned' }
const employeeUser = { userId: 104, role: 'employee', assignment_status: 'assigned' }

const products = JSON.parse(executeTool('get_products', { query: '霞光沙', order_by: 'warehouse' }, db, warehouseUser))
assert(products.success, 'warehouse get_products should succeed')
assert(products.data.length >= 2, '霞光沙 should return multiple specs')
assert(products.data.some(item => item.location_display || item.warehouse_code), 'products should expose warehouse location')

const projects = JSON.parse(executeTool('get_projects', { query: '测试项目A' }, db, employeeUser))
assert(projects.success, 'employee get_projects should succeed')
assert(projects.data.length === 1, 'employee should only see linked sanitized project')

db.close()
console.log('AI mock smoke passed')

function assert(ok, message) {
  if (!ok) {
    console.error(message)
    process.exit(1)
  }
}
