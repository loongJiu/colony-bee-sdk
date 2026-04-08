import { describe, it, expect } from 'vitest'
import { SkillRegistry } from '../src/skill-registry.js'

describe('SkillRegistry', () => {
  it('define / get / list', () => {
    const reg = new SkillRegistry()
    reg.define('s1', { handler: async () => 'result' })
    reg.define('s2', { prompt: 'do something' })

    expect(reg.get('s1')).toBeDefined()
    expect(reg.get('s2')?.prompt).toBe('do something')
    expect(reg.get('unknown')).toBeUndefined()
    expect(reg.list()).toEqual(['s1', 's2'])
  })

  it('activate 执行 handler', async () => {
    const reg = new SkillRegistry()
    reg.define('s1', { handler: async (input) => `handled: ${input}` })

    const result = await reg.activate('s1', 'test')
    expect(result).toBe('handled: test')
  })

  it('activate 无 handler 时返回 prompt', async () => {
    const reg = new SkillRegistry()
    reg.define('s1', { prompt: 'do X' })

    const result = await reg.activate('s1')
    expect(result).toBe('do X')
  })

  it('activate 无 handler 且无 prompt 时返回 description', async () => {
    const reg = new SkillRegistry()
    reg.define('s1', { description: 'fallback desc' })

    const result = await reg.activate('s1')
    expect(result).toBe('fallback desc')
  })

  it('activate 不存在时抛错', async () => {
    const reg = new SkillRegistry()
    await expect(reg.activate('nope')).rejects.toThrow('Skill not found: nope')
  })
})
