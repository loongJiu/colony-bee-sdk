import { describe, it, expect, vi } from 'vitest'
import { TaskContext } from '../../src/task/task-context.js'
import { ToolRegistry } from '../../src/task/tool-registry.js'
import { SkillRegistry } from '../../src/skill-registry.js'
import { Logger } from '../../src/logger.js'

function createContext(opts: Partial<ConstructorParameters<typeof TaskContext>[0]> = {}) {
  return new TaskContext({
    taskId: opts.taskId ?? 't1',
    capability: opts.capability ?? 'test',
    input: opts.input ?? 'input',
    signal: opts.signal ?? new AbortController().signal,
    toolRegistry: opts.toolRegistry ?? new ToolRegistry(),
    skillRegistry: opts.skillRegistry ?? new SkillRegistry(),
    modelCaller: opts.modelCaller ?? null,
    logger: opts.logger ?? new Logger({ level: 'debug', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })
  })
}

describe('TaskContext', () => {
  it('属性可访问', () => {
    const ctx = createContext({ taskId: 't1', capability: 'cap1', input: { data: 1 } })
    expect(ctx.taskId).toBe('t1')
    expect(ctx.capability).toBe('cap1')
    expect(ctx.input).toEqual({ data: 1 })
    expect(ctx.signal).toBeInstanceOf(AbortSignal)
    expect(ctx.state).toBeDefined()
    expect(ctx.logger).toBeDefined()
  })

  it('tools Proxy 代理调用', async () => {
    const tools = new ToolRegistry()
    tools.register('add', (input: unknown) => (input as { a: number; b: number }).a + (input as { a: number; b: number }).b)
    const ctx = createContext({ toolRegistry: tools })

    const result = ctx.tools['add']!({ a: 1, b: 2 })
    expect(result).toBe(3)
  })

  it('tools 访问不存在的工具返回 undefined', () => {
    const ctx = createContext()
    expect(ctx.tools['nonexistent']).toBeUndefined()
  })

  it('callModel 无 modelCaller 时抛错', async () => {
    const ctx = createContext({ modelCaller: null })
    await expect(ctx.callModel('hi')).rejects.toThrow('Model caller not configured')
  })

  it('callModel 正常调用', async () => {
    const caller = vi.fn().mockResolvedValue('response')
    const ctx = createContext({ modelCaller: caller })
    const result = await ctx.callModel('prompt', { key: 'val' })

    expect(caller).toHaveBeenCalledWith('prompt', { key: 'val' })
    expect(result).toBe('response')
  })

  it('callModelWithTools 传递 tools 参数', async () => {
    const caller = vi.fn().mockResolvedValue('ok')
    const ctx = createContext({ modelCaller: caller })
    await ctx.callModelWithTools('prompt', ['tool1'], { extra: true })

    expect(caller).toHaveBeenCalledWith('prompt', { extra: true, tools: ['tool1'] })
  })

  it('progress 输出日志', () => {
    const log = vi.fn()
    const ctx = createContext({
      logger: new Logger({ level: 'debug', output: { log, warn: vi.fn(), error: vi.fn() } })
    })
    ctx.progress(50, 'halfway')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('50%'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('halfway'))
  })

  it('activateSkill 委托给 SkillRegistry', async () => {
    const skills = new SkillRegistry()
    skills.define('s1', { handler: async () => 'skill-result' })
    const ctx = createContext({ skillRegistry: skills })

    const result = await ctx.activateSkill('s1')
    expect(result).toBe('skill-result')
  })
})
