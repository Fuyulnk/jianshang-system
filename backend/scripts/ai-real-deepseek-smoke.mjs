import Database from 'better-sqlite3'
import { resolve } from 'path'
import dotenv from 'dotenv'
import { inventoryFacts, projectFacts } from '../src/services/businessFacts.js'

dotenv.config({ path: resolve('.env') })

if (process.env.AI_REAL_EGRESS_ENABLED !== '1' || process.env.AI_TEST_DATASET !== '1') {
  console.error('真实模型测试被保护：需要同时设置 AI_REAL_EGRESS_ENABLED=1 和 AI_TEST_DATASET=1')
  process.exit(1)
}
if (!process.env.AI_API_KEY) {
  console.error('缺少 AI_API_KEY')
  process.exit(1)
}

const dbPath = resolve(process.argv[2] || 'data/safe-ai-test.db')
if (!/safe-ai-test\.db$/.test(dbPath)) {
  console.error('只允许使用脱敏测试库 safe-ai-test.db')
  process.exit(1)
}

const db = new Database(dbPath, { readonly: true })
const user = { userId: 202, role: 'warehouse', assignment_status: 'assigned' }
const facts = {
  inventory: inventoryFacts(db, user, { query: '霞光沙', order_by: 'warehouse', limit: 10 }),
  projects: projectFacts(db, user, { query: '测试项目A', limit: 3 })
}
db.close()

const prompt = [
  '你是简尚仓库助手。只能根据下面脱敏测试数据回答。',
  '请用中文说明霞光沙有哪些规格、库存单位、数量、低库存线和库位。',
  JSON.stringify(facts)
].join('\n')

const res = await fetch(process.env.AI_ENDPOINT || 'https://api.deepseek.com/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.AI_API_KEY}`
  },
  body: JSON.stringify({
    model: process.env.AI_MODEL || 'deepseek-chat',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0,
    max_tokens: 600
  }),
  signal: AbortSignal.timeout(20000)
})

const text = await res.text()
if (!res.ok) {
  console.error(`DeepSeek HTTP ${res.status}: ${text.slice(0, 500)}`)
  process.exit(1)
}
const json = JSON.parse(text)
const reply = json?.choices?.[0]?.message?.content || ''
console.log(reply)
if (!/霞光沙/.test(reply) || !/(5|五).*升|1.*升|一.*升/.test(reply)) {
  console.error('真实模型回复没有正确使用脱敏库存规格')
  process.exit(1)
}
console.log('AI real DeepSeek smoke passed')
