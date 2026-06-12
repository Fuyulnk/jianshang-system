export function generateEmployeeCode(db) {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

  function createCode() {
    let prefix = ''
    for (let i = 0; i < 2; i++) {
      prefix += letters[Math.floor(Math.random() * letters.length)]
    }
    const number = String(Math.floor(Math.random() * 1000000)).padStart(6, '0')
    return `JS-${prefix}${number}`
  }

  let code = createCode()
  while (db.prepare('SELECT 1 FROM employees WHERE employee_code = ?').get(code)) {
    code = createCode()
  }
  return code
}
