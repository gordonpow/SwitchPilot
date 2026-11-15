import { build } from 'esbuild'
import { readdirSync, mkdirSync, copyFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = join(root, 'src', 'scripts')
const outDir = join(root, 'resources', 'scripts')
mkdirSync(outDir, { recursive: true })

const entries = readdirSync(srcDir).filter((f) => f.endsWith('.ts'))
for (const f of entries) {
  const name = basename(f, '.ts')
  await build({
    entryPoints: [join(srcDir, f)],
    outfile: join(outDir, `${name}.cjs`),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22'
  })
  console.log(`built resources/scripts/${name}.cjs`)
}

// PowerShell 腳本不打包，原樣複製
for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.ps1'))) {
  copyFileSync(join(srcDir, f), join(outDir, f))
  console.log(`copied resources/scripts/${f}`)
}
