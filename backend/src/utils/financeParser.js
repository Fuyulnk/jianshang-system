export function parseFinanceTransactionDraft(rawText, db) {
  const text = String(rawText || '').trim()
  const amountMatch = text.match(/(?:收入|收到|收|支付|支出|付|扣|退款|报销)?\s*([0-9]+(?:\.[0-9]{1,2})?)/)
  const amount = amountMatch ? Number(amountMatch[1]) : 0
  const type = /收入|收到|收款|进账|回款/.test(text) && !/支付|支出|付|扣/.test(text) ? 'income' : 'expense'
  const accounts = db.prepare('SELECT id, name FROM accounts ORDER BY id').all()
  const accountAlias = loadFinanceAccountAliases(db)
  let account = null

  for (const item of accounts) {
    if (text.includes(item.name)) {
      account = item
      break
    }
  }
  if (!account) {
    for (const { alias, account_name: standard } of accountAlias) {
      if (!text.includes(alias)) continue
      account = findAccountByName(accounts, standard)
      if (account) break
    }
  }

  const category = inferFinanceCategory(text, type)
  const party = inferCounterparty(text)
  return {
    raw_text: text,
    type,
    type_label: type === 'income' ? '收入' : '支出',
    amount,
    account_id: account?.id || 0,
    account_name: account?.name || '',
    category,
    party,
    description: cleanFinanceDescription(text),
    confidence: amount > 0 && account ? 'high' : amount > 0 ? 'medium' : 'low',
    warnings: [
      ...(!text ? ['请先输入财务消息'] : []),
      ...(!amount ? ['未识别到金额'] : []),
      ...(!account ? ['未匹配到账户，请在表单里选择'] : [])
    ]
  }
}

function loadFinanceAccountAliases(db) {
  try {
    return db.prepare(`
      SELECT alias, account_name
      FROM finance_account_aliases
      WHERE enabled = 1
      ORDER BY length(alias) DESC, id ASC
    `).all()
  } catch {
    return []
  }
}

function findAccountByName(accounts, targetName) {
  const target = normalizeAccountName(targetName)
  return accounts.find(item => {
    const current = normalizeAccountName(item.name)
    return item.name === targetName || current === target || current.includes(target) || target.includes(current)
  }) || null
}

function normalizeAccountName(value) {
  return String(value || '').replace(/[·\s　]/g, '')
}

function inferFinanceCategory(text, type) {
  if (/退款|退货退款/.test(text)) return '退款'
  if (/工资|结算工资/.test(text)) return type === 'income' ? '工资款' : '工人工资'
  if (/预支|借支/.test(text)) return /差旅|出差/.test(text) ? '差旅' : '借支'
  if (/报销/.test(text)) return '报销'
  if (/货拉拉|打车|加油|停车|高速/.test(text)) return '交通费'
  if (/手续费|代发/.test(text)) return '手续费'
  if (/个税|社保|税费/.test(text)) return '税费'
  if (/茶叶|招待|应酬/.test(text)) return '应酬费'
  if (/货款|材料|涂料|底漆|面漆|结算单/.test(text)) return type === 'income' ? '货款' : '材料采购'
  if (/返点|渠道返款/.test(text)) return '返点支出'
  if (/装修|电线|工地/.test(text)) return type === 'income' ? '项目收入' : '装修费'
  if (/生活费/.test(text)) return '生活费'
  return type === 'income' ? '项目收入' : '其他'
}

function inferCounterparty(text) {
  const patterns = [
    /(?:给|付给|支付给|收到|收)([^，,。；;\s]{2,12})/,
    /对方[:：]\s*([^，,。；;\s]{2,12})/
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) return match[1].replace(/[0-9.]/g, '').trim()
  }
  return ''
}

function cleanFinanceDescription(text) {
  return text
    .replace(/[0-9]+(?:\.[0-9]{1,2})?/g, '')
    .replace(/收入|收到|收款|支付|支出|付款|扣款/g, '')
    .trim()
    .slice(0, 120)
}
