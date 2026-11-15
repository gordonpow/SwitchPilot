/** 讀取 SWITCHPILOT_<name>，沒有時讀舊名 CLAUDE_SWITCHER_<name>。空字串視為未設定。 */
export function envVar(name: string): string | undefined {
  if (typeof process === 'undefined' || !process.env) return undefined
  return process.env['SWITCHPILOT_' + name] || process.env['CLAUDE_SWITCHER_' + name] || undefined
}
