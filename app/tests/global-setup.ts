// 測試前先把 src/scripts/*.ts 打包成 resources/scripts/*.cjs
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'

export default function setup(): void {
  const root = path.resolve(__dirname, '..')
  execFileSync(process.execPath, [path.join(root, 'scripts', 'build-scripts.mjs')], {
    cwd: root,
    stdio: 'ignore'
  })
}
