export function parseFinanceTransactionDraft(rawText, db) {
  const text = String(rawText || '').trim()
  // 去掉日期格式，避免日期里的数字被当成金额
  const cleanText = text
    .replace(/\b\d{1,4}\/\d{1,2}\/?\d{0,2}\b/g, '')
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, '')
    .trim()

  // 类型检测：优先看第一个出现的财务关键词
  const incomeKeywords = /收入|收到|收款|进账|回款|入账/
  const expenseKeywords = /支付|支出|付款|出账|付给|扣款|扣回/
  const firstIncome = text.search(incomeKeywords)
  const firstExpense = text.search(expenseKeywords)
  const type = (firstIncome >= 0 && (firstExpense < 0 || firstIncome < firstExpense)) ? 'income' : 'expense'

  // 金额提取：优先取关键词后面紧跟的数字
  let amount = 0
  const amountAfterKw = cleanText.match(new RegExp(
    `(${type === 'income' ? '收入|收到|收款|进账|回款' : '支付|支出|付款|出账|付'})\\s*([0-9]+(?:\\.[0-9]{1,2})?)`
  ))
  if (amountAfterKw) {
    amount = Number(amountAfterKw[2])
  }
  if (!amount) {
    // 回退：取第一个数字
    const fallback = cleanText.match(/(?:收入|收到|收|支付|支出|付|扣|退款|报销|付款)?\s*([0-9]+(?:\.[0-9]{1,2})?)/)
    if (fallback) amount = Number(fallback[1])
  }

  const accounts = db.prepare('SELECT id, name FROM accounts ORDER BY id').all()
  const accountAlias = loadFinanceAccountAliases(db)
  const { account: transferAccount, counterparty: transferParty } = resolveTransferAccounts(text, accounts, accountAlias, type)

  let account = transferAccount
  let party = transferParty

  if (!transferAccount) {
    // 非转账场景：原逻辑匹配
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
    party = inferCounterparty(text)
  }

  const category = inferFinanceCategory(text, type)
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

/**
 * 检测转账模式并提取正确的账户和对方。
 * 转账模式："A转进B""A转到B""A转B""A转入B""A汇给B""A转给B"
 * 对于支出：A=支出账户，B=对方。对于收入：B=收入账户，A=对方。
 */
function resolveTransferAccounts(text, accounts, accountAliases, type) {
  const transferPatterns = [
    /([一-鿿]{2,12})转(?:进|到|入|给?)([一-鿿]{2,12})/,
    /([一-鿿]{2,12})汇(?:到|给|入?)([一-鿿]{2,12})/
  ]

  for (const pattern of transferPatterns) {
    const match = text.match(pattern)
    if (!match) continue
    const sourceName = match[1]  // A
    const destName = match[2]    // B

    // 尝试匹配 source (A) 到账户
    const sourceAccount = findMatchingAccount(sourceName, accounts, accountAliases)
    const destAccount = findMatchingAccount(destName, accounts, accountAliases)

    if (type === 'expense') {
      // 支出：A=支出账户，B=对方
      if (sourceAccount) {
        return { account: sourceAccount, counterparty: destName }
      }
      // A没匹配到但B匹配到了，至少对方已知
      if (destAccount) {
        return { account: null, counterparty: destName }
      }
    } else {
      // 收入：B=收入账户，A=对方
      if (destAccount) {
        return { account: destAccount, counterparty: sourceName }
      }
      if (sourceAccount) {
        return { account: null, counterparty: sourceName }
      }
    }
  }
  return { account: null, counterparty: '' }
}

/** 根据名称文本在账户和别名中查找匹配 */
function findMatchingAccount(name, accounts, accountAliases) {
  // 精确匹配账户名（忽略特殊字符）
  const normalized = name.replace(/[·\s　]/g, '')
  const exact = accounts.find(a => a.name.replace(/[·\s　]/g, '') === normalized)
  if (exact) return exact

  // 别名匹配
  for (const { alias, account_name: standard } of accountAliases) {
    if (alias === name || alias.includes(name) || name.includes(alias)) {
      const found = findAccountByName(accounts, standard)
      if (found) return found
    }
  }

  // 模糊匹配：账户名包含关键字
  const fuzzy = accounts.find(a => {
    const clean = a.name.replace(/[·\s　]/g, '')
    return clean.includes(normalized) || normalized.includes(clean)
  })
  return fuzzy || null
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
