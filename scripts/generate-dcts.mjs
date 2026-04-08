/**
 * 将 ESM .d.ts 文件复制为 CJS .d.cts 文件
 */

import { readdirSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'

function walk(dir) {
  const results = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...walk(full))
    } else if (entry.name.endsWith('.d.ts') && !entry.name.endsWith('.d.cts')) {
      results.push(full)
    }
  }
  return results
}

const esmDir = 'dist/esm'
const cjsDir = 'dist/cjs'

for (const dtsFile of walk(esmDir)) {
  const relative = dtsFile.slice(esmDir.length + 1)
  const cjsFile = join(cjsDir, relative.replace(/\.d\.ts$/, '.d.cts'))
  mkdirSync(dirname(cjsFile), { recursive: true })
  copyFileSync(dtsFile, cjsFile)
}
