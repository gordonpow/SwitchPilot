// 假的 `claude auth login`：依 CLAUDE_CONFIG_DIR 寫出憑證檔。
// 用法：fake-login.cjs [ok|fail|nocreds|sleep]
const fs = require('node:fs')
const path = require('node:path')

const mode = process.argv[2] || 'ok'
const d = process.env.CLAUDE_CONFIG_DIR
console.log("If the browser didn't open, visit: https://example.test/fallback?x=1")
if (mode === 'sleep') {
  setTimeout(() => process.exit(0), 60000)
} else if (mode === 'fail') {
  console.log('login failed')
  process.exit(1)
} else {
  if (mode === 'nocreds') {
    fs.writeFileSync(path.join(d, 'other.txt'), 'x')
  } else {
    fs.writeFileSync(
      path.join(d, '.credentials.json'),
      JSON.stringify({ claudeAiOauth: { accessToken: 'fa', refreshToken: 'fr' } })
    )
    fs.writeFileSync(
      path.join(d, '.claude.json'),
      JSON.stringify({ oauthAccount: { accountUuid: 'fu', emailAddress: 'fake@x' } })
    )
  }
  process.exit(0)
}
