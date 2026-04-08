import { describe, it, expect } from 'vitest'
import { Logger } from '../src/logger.js'

function createOutput() {
  const logs: string[] = []
  const warns: string[] = []
  const errors: string[] = []
  return {
    log: (msg: string) => logs.push(msg),
    warn: (msg: string) => warns.push(msg),
    error: (msg: string) => errors.push(msg),
    logs,
    warns,
    errors
  }
}

describe('Logger', () => {
  it('默认级别 info，debug 不输出', () => {
    const out = createOutput()
    const logger = new Logger({ output: out })
    logger.debug('hidden')
    logger.info('visible')
    expect(out.logs).toHaveLength(1)
    expect(out.logs[0]).toContain('visible')
  })

  it('debug 级别全部输出', () => {
    const out = createOutput()
    const logger = new Logger({ level: 'debug', output: out })
    logger.debug('d')
    logger.info('i')
    expect(out.logs).toHaveLength(2)
  })

  it('warn 级别输出到 warn', () => {
    const out = createOutput()
    const logger = new Logger({ level: 'warn', output: out })
    logger.warn('w')
    expect(out.warns).toHaveLength(1)
    expect(out.warns[0]).toContain('w')
  })

  it('error 级别输出到 error', () => {
    const out = createOutput()
    const logger = new Logger({ level: 'error', output: out })
    logger.error('e')
    expect(out.errors).toHaveLength(1)
  })

  it('child 继承 bindings 和级别', () => {
    const out = createOutput()
    const logger = new Logger({ level: 'info', output: out })
    const child = logger.child({ component: 'test' })
    child.info('hello')
    expect(out.logs).toHaveLength(1)
    expect(out.logs[0]).toContain('[test]')
    expect(out.logs[0]).toContain('hello')
  })

  it('带 data 参数序列化为 JSON', () => {
    const out = createOutput()
    const logger = new Logger({ output: out })
    logger.info('msg', { key: 'val' })
    expect(out.logs[0]).toContain('"key":"val"')
  })
})
