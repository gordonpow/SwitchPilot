// 測試用假 claude：記錄 argv，睡一會兒後結束。
const fs = require('node:fs')

const log = process.env.FAKE_CLAUDE_LOG
if (log) fs.appendFileSync(log, process.argv.slice(2).join(' ') + '\n', 'utf-8')
const jlog = process.env.FAKE_CLAUDE_JSON_LOG
if (jlog) fs.appendFileSync(jlog, JSON.stringify(process.argv.slice(2)) + '\n', 'utf-8')
const sleepMs = Number(process.env.FAKE_CLAUDE_SLEEP || 0) * 1000
setTimeout(() => process.exit(0), sleepMs)
