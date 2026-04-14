import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import typescript from '@rollup/plugin-typescript'
import { writeFileSync, mkdirSync } from 'node:fs'

const external = (id) =>
  id.startsWith('node:') ||
  id === 'js-yaml' || id.startsWith('js-yaml/') ||
  id === 'zod' || id.startsWith('zod/') ||
  id === 'zod-to-json-schema' || id.startsWith('zod-to-json-schema/')

const commonPlugins = [
  resolve({ preferBuiltins: true }),
  commonjs(),
  typescript({
    tsconfig: './tsconfig.json',
    declaration: false,
    declarationMap: false,
    outDir: undefined
  })
]

export default [
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/esm',
      format: 'esm',
      sourcemap: true,
      preserveModules: true,
      preserveModulesRoot: 'src'
    },
    external,
    plugins: commonPlugins
  },
  {
    input: 'src/index.ts',
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      sourcemap: true,
      preserveModules: true,
      preserveModulesRoot: 'src',
      exports: 'named',
      entryFileNames: '[name].cjs'
    },
    external,
    plugins: [
      ...commonPlugins,
      {
        name: 'write-cjs-package-json',
        writeBundle() {
          mkdirSync('dist/cjs', { recursive: true })
          writeFileSync('dist/cjs/package.json', JSON.stringify({ type: 'commonjs' }, null, 2))
        }
      }
    ]
  }
]
