// 假的 agy：依 FAKE_AGY_SEQ（逗號分隔，依呼叫次數取用；用完重複最後一個）或 FAKE_AGY_MODE 決定行為。
// 模式：ok、quota_stderr（結構化額度錯誤 + exit 1）、quota_log（log 含 RESOURCE_EXHAUSTED + exit 1）、
//       quota_text_ok（正常輸出含 quota 429 字樣、exit 0）、noout（輸出 no output produced）、fail（exit 3）、sleep。
// 每次呼叫把 argv 與當時的 agy 登入 email 追加到 FAKE_AGY_LOG（JSON 一行）。
const fs = require('node:fs')
const argv = process.argv.slice(2)

function email() {
  try {
    const f = process.env.CLAUDE_SWITCHER_FAKE_AGYCRED
    const blob = JSON.parse(fs.readFileSync(f, 'utf-8')).blob
    return JSON.parse(blob).id_token_email
  } catch {
    return null
  }
}

let n = 0
const counter = process.env.FAKE_AGY_COUNTER
if (counter) {
  try {
    n = Number(fs.readFileSync(counter, 'utf-8')) || 0
  } catch {}
  fs.writeFileSync(counter, String(n + 1))
}
const seq = (process.env.FAKE_AGY_SEQ || process.env.FAKE_AGY_MODE || 'ok').split(',')
const mode = seq[Math.min(n, seq.length - 1)]

if (process.env.FAKE_AGY_LOG)
  fs.appendFileSync(process.env.FAKE_AGY_LOG, JSON.stringify({ argv, email: email(), mode }) + '\n')

const li = argv.indexOf('--log-file')
const logFile = li >= 0 ? argv[li + 1] : null
const writeLog = (t) => logFile && fs.writeFileSync(logFile, t)

switch (mode) {
  case 'ok':
    writeLog('fine\n')
    process.stdout.write('done: 實作完成\n')
    break
  case 'quota_stderr':
    process.stderr.write('Error: RESOURCE_EXHAUSTED: quota exceeded for model\n')
    process.exitCode = 1
    break
  case 'quota_log':
    writeLog('code: 429 RESOURCE_EXHAUSTED\n')
    process.exitCode = 1
    break
  case 'quota_text_ok':
    writeLog('fine\n')
    process.stdout.write('已完成。文件中提到 quota 429 與 RESOURCE_EXHAUSTED 的處理方式。\n')
    break
  case 'noout':
    writeLog('soft-denying tool confirmation\n')
    process.stdout.write('no output produced\n')
    break
  case 'fail':
    process.stderr.write('unexpected failure\n')
    process.exitCode = 3
    break
  case 'sleep': {
    const ms = Number(process.env.FAKE_AGY_SLEEP_MS) || 30000
    writeLog('fine\n')
    setTimeout(() => process.stdout.write('done: 實作完成\n'), ms)
    break
  }
}
