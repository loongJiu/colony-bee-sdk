import resolve from '@rollup/plugin-node-resolve'
import commonjs from '@rollup/plugin-commonjs'
import { writeFileSync, mkdirSync } from 'node:fs'

const external = (id) =>
  id.startsWith('node:') ||
  id === 'js-yaml' || id.startsWith('js-yaml/') ||
  id === 'zod' || id.startsWith('zod/')

const commonPlugins = [resolve({ preferBuiltins: true }), commonjs()]

export default [
  {
    input: 'src/index.js',
    output: {
      dir: 'dist/esm',
      format: 'esm',
      sourcemap: false,
      preserveModules: true,
      preserveModulesRoot: 'src'
    },
    external,
    plugins: commonPlugins
  },
  {
    input: 'src/index.js',
    output: {
      dir: 'dist/cjs',
      format: 'cjs',
      sourcemap: false,
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
