/**
 * Finance group chat auto-entry bot.
 *
 * When someone sends a financial message in the 财务群 group chat
 * (e.g. "收入5000 王晓 墙漆尾款"), this bot auto-detects it,
 * parses via financeParser (rule-based), falls back to DeepSeek AI,
 * creates a pending transaction draft, and replies.
 *
 * Messages with @AI / @小助手 are skipped (handled by existing AI agent).
 * Non-financial messages are ignored.
 * The bot never triggers on its own replies (sender check).
 */

import { parseFinanceTransactionDraft } from '../utils/financeParser.js'
import { createTransaction } from './financeCommands.js'

/** Quick pre-check: must contain a digit AND a finance keyword */
function looksLikeFinance(text) {
  const hasNumber = /[0-9]+/.test(text)
  const hasKeyword = /(收入|支出|收到|支付|收款|付款|转账|进账|回款|报销|退款|预支|借支)/.test(text)
  return hasNumber && hasKeyword
}

/** 获取所有账户名列表（给 AI 做映射） */
function getAccountNames(db) {
  return db.prepare("SELECT name FROM accounts ORDER BY id").all().map(r => r.name)
}

/** 调 DeepSeek API 解析财务消息 */
async function parseWithAI(text, db) {
  const apiKey = process.env.AI_API_KEY
  if (!apiKey) return null
  const accounts = getAccountNames(db)
  const accountList = accounts.map((n, i) => `${i + 1}. ${n}`).join('\n')

  const systemPrompt = `你是简尚财务机器人的消息解析引擎。把用户发送的财务群消息拆解成结构化 JSON 字段。

只返回 JSON，不要任何解释。

{
  "type": "income 或 expense",
  "amount": 金额纯数字,
  "account": "从下方列表选最匹配的账户名，如果都不匹配就返回空字符串",
  "category": "从以下选一个：材料采购,工程款收入,工人工资,报销,借款,还款,日常开支,其他,维修费,备用金,项目收入,装修费,返点支出,项目经费,交通费,借支,材料款,工资,转账手续费,税费,材料费,销售收入,投资款,往来款,身股分红,代付款,退款,工资款,货款,手续费,生活费,工程款支出,贷款还款,应酬费,租金,工程款,差旅",
  "party": "交易对方",
  "description": "交易事由"
}

可用账户：
${accountList}

注意：日期中的数字不要当作金额。金额通常在收入/支出等关键词后面。`

  try {
    const res = await fetch(process.env.AI_ENDPOINT || 'https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text }
        ],
        max_tokens: 300,
        temperature: 0.1
      }),
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const json = await res.json()
    const content = json?.choices?.[0]?.message?.content || ''
    if (!content) return null
    // 提取 JSON
    const jsonMatch = content.match(/\{[\s\S]*\}/)
    if (!jsonMatch) return null
    const parsed = JSON.parse(jsonMatch[0])
    if (!parsed.type || !parsed.amount) return null
    return {
      type: parsed.type === '支出' ? 'expense' : 'income',
      amount: Number(parsed.amount) || 0,
      account_name: parsed.account || '',
      category: parsed.category || '',
      party: parsed.party || '',
      description: parsed.description || ''
    }
  } catch {
    return null
  }
}

/** 根据账户名查找 account_id */
function resolveAccount(db, name) {
  if (!name) return null
  const exact = db.prepare('SELECT id, name FROM accounts WHERE name = ?').get(name)
  if (exact) return exact
  // 模糊匹配
  return db.prepare("SELECT id, name FROM accounts WHERE name LIKE ? ORDER BY id LIMIT 1").get(`%${name}%`) || null
}

/**
 * Handle a message in the finance group.
 * Returns true if the message was processed (pending transaction created), false otherwise.
 */
export async function handleFinanceGroupMessage({ content, conversationId, conversationName, senderId, db, io }) {
  // [1] Quick pre-check before expensive parsing
  if (!looksLikeFinance(content)) return false

  // [2] Only process 财务群
  if (conversationName !== '财务群') return false

  // [3] Try rule-based parsing first
  let draft = parseFinanceTransactionDraft(content, db)
  let usedAI = false

  // [4] If rule-based confidence is low, try AI
  if (draft.confidence !== 'high' || !draft.account_id) {
    const aiResult = await parseWithAI(content, db)
    if (aiResult && aiResult.amount > 0) {
      const account = resolveAccount(db, aiResult.account_name)
      draft = {
        ...draft,
        type: aiResult.type,
        amount: aiResult.amount,
        account_id: account?.id || 0,
        account_name: account?.name || aiResult.account_name || '',
        category: aiResult.category || draft.category,
        party: aiResult.party || draft.party,
        description: aiResult.description || draft.description,
        confidence: account?.id ? 'high' : 'medium'
      }
      usedAI = true
    }
  }

  if (draft.confidence !== 'high') return false
  if (draft.amount <= 0) return false
  if (!draft.account_id) return false

  // [5] Create a pending transaction
  const result = createTransaction(db, {
    account_id: draft.account_id,
    type: draft.type,
    amount: draft.amount,
    category: draft.category || null,
    description: draft.description || null,
    party: draft.party || null,
    proxy: null,
    status: 'pending'
  })

  if (!result?.id) return false

  // [6] Build reply
  const typeLabel = draft.type === 'income' ? '收入' : '支出'
  const amountStr = Number(draft.amount).toLocaleString('zh-CN')
  const aiTag = usedAI ? ' 🤖' : ''
  const replyText = `已生成待确认流水${aiTag}：${typeLabel}${amountStr}元${draft.account_name ? ' ' + draft.account_name : ''}${draft.party ? ' ' + draft.party : ''}${draft.description ? ' ' + draft.description : ''}。请在交易流水页面确认后生效。`

  // [7] Find bot user
  const botUser = db.prepare("SELECT id FROM users WHERE username = 'ai'").get()
  if (!botUser) return false

  // [8] Save and emit reply
  const msgResult = db.prepare(
    'INSERT INTO messages (conversation_id, user_id, content) VALUES (?, ?, ?)'
  ).run(conversationId, botUser.id, replyText)

  const replyMsg = db.prepare(`
    SELECT m.*, u.username, u.avatar_url FROM messages m
    JOIN users u ON m.user_id = u.id WHERE m.id = ?
  `).get(msgResult.lastInsertRowid)

  io.to(`conv:${conversationId}`).emit('message:new', replyMsg)

  return true
}
