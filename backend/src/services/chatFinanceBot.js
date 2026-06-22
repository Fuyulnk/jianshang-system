/**
 * Finance group chat auto-entry bot.
 *
 * When someone sends a financial message in the 财务群 group chat
 * (e.g. "收入5000 王晓 墙漆尾款"), this bot auto-detects it,
 * parses via financeParser, creates a pending transaction draft, and replies.
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

/**
 * Handle a message in the finance group.
 * Returns true if the message was processed (pending transaction created), false otherwise.
 */
export async function handleFinanceGroupMessage({ content, conversationId, conversationName, senderId, db, io }) {
  // [1] Quick pre-check before expensive parsing
  if (!looksLikeFinance(content)) return false

  // [2] Only process 财务群
  if (conversationName !== '财务群') return false

  // [3] Parse financial data
  const draft = parseFinanceTransactionDraft(content, db)
  if (draft.confidence !== 'high') return false
  if (draft.amount <= 0) return false
  if (!draft.account_id) return false

  // [4] Create a pending transaction. It becomes effective only after finance confirms it.
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

  // [5] Build reply
  const typeLabel = draft.type === 'income' ? '收入' : '支出'
  const amountStr = Number(draft.amount).toLocaleString('zh-CN')
  const replyText = `已生成待确认流水：${typeLabel}${amountStr}元${draft.party ? ' ' + draft.party : ''}${draft.description ? ' ' + draft.description : ''}。请在交易流水页面确认后生效。`

  // [6] Find bot user
  const botUser = db.prepare("SELECT id FROM users WHERE username = 'ai'").get()
  if (!botUser) return false

  // [7] Save and emit reply
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
