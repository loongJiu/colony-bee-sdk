import { describe, it, expect } from 'vitest'
import { ToolRegistry } from '../../src/task/tool-registry.js'

describe('ToolRegistry', () => {
  it('注册函数模式', () => {
    const reg = new ToolRegistry()
    const fn = (input: unknown) => input
    reg.register('t1', fn)

    const tool = reg.get('t1')
    expect(tool?.handler).toBe(fn)
    expect(tool?.schema).toBeUndefined()
  })

  it('注册 schema 模式', () => {
    const reg = new ToolRegistry()
    reg.register('t1', { type: 'object', properties: {} })

    const tool = reg.get('t1')
    expect(tool?.handler).toBeUndefined()
    expect(tool?.schema).toEqual({ type: 'object', properties: {} })
  })

  it('has / list', () => {
    const reg = new ToolRegistry()
    reg.register('a', () => {})
    reg.register('b', {})

    expect(reg.has('a')).toBe(true)
    expect(reg.has('c')).toBe(false)
    expect(reg.list()).toEqual(['a', 'b'])
  })
})
