import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import { TaskContext } from '../../src/task/task-context.js'
import { ToolRegistry } from '../../src/task/tool-registry.js'
import { SkillRegistry } from '../../src/skill-registry.js'
import { Logger } from '../../src/logger.js'
import type { ModelResponse } from '../../src/types.js'

function createContext(opts: Partial<ConstructorParameters<typeof TaskContext>[0]> = {}) {
  return new TaskContext({
    taskId: opts.taskId ?? 't1',
    capability: opts.capability ?? 'test',
    input: opts.input ?? 'input',
    signal: opts.signal ?? new AbortController().signal,
    toolRegistry: opts.toolRegistry ?? new ToolRegistry(),
    skillRegistry: opts.skillRegistry ?? new SkillRegistry(),
    modelCaller: opts.modelCaller ?? null,
    streamingModelCaller: opts.streamingModelCaller ?? null,
    logger: opts.logger ?? new Logger({ level: 'debug', output: { log: vi.fn(), warn: vi.fn(), error: vi.fn() } })
  })
}

function mockModelResponse(overrides: Partial<ModelResponse> = {}): ModelResponse {
  return {
    content: 'hello',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    stopReason: 'end_turn',
    ...overrides,
  }
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

  it('callModelWithTools 无 modelCaller 时抛错', async () => {
    const ctx = createContext({ modelCaller: null })
    await expect(ctx.callModelWithTools('hi')).rejects.toThrow('Model caller not configured')
  })

  it('callModelWithTools 解析 modelCaller 返回的结构化响应', async () => {
    const caller = vi.fn().mockResolvedValue(mockModelResponse({ content: 'answer' }))
    const ctx = createContext({ modelCaller: caller })

    const result = await ctx.callModelWithTools('prompt')
    expect(result.content).toBe('answer')
    expect(result.stopReason).toBe('end_turn')
    expect(result.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 })
  })

  it('callModelWithTools 将原始返回值转为 ModelResponse', async () => {
    const caller = vi.fn().mockResolvedValue('raw string')
    const ctx = createContext({ modelCaller: caller })

    const result = await ctx.callModelWithTools('prompt')
    expect(result.content).toBe('raw string')
    expect(result.stopReason).toBe('end_turn')
  })

  it('callModelWithTools 透传 tool schemas 给 modelCaller', async () => {
    const tools = new ToolRegistry()
    tools.register('search', {
      description: '搜索',
      inputSchema: z.object({ query: z.string() }),
      execute: async () => {},
    })

    const caller = vi.fn().mockResolvedValue(mockModelResponse())
    const ctx = createContext({ modelCaller: caller, toolRegistry: tools })

    await ctx.callModelWithTools('prompt', ['search'])
    const callArgs = caller.mock.calls[0]!
    const toolsArg = (callArgs as unknown[])[1] as Record<string, unknown>
    expect(toolsArg.tools).toHaveLength(1)
    expect((toolsArg.tools as Array<{ name: string }>)[0].name).toBe('search')
  })

  it('callModelWithTools 执行工具调用并附加结果', async () => {
    const tools = new ToolRegistry()
    tools.register('calc', {
      description: '计算',
      inputSchema: z.object({ expr: z.string() }),
      execute: async (input: unknown) => {
        const { expr } = input as { expr: string }
        return { result: expr.length }
      },
    })

    const caller = vi.fn().mockResolvedValue(mockModelResponse({
      content: '',
      stopReason: 'tool_use',
      toolCalls: [
        { id: 'call_1', name: 'calc', input: { expr: 'hello' } },
      ],
    }))
    const ctx = createContext({ modelCaller: caller, toolRegistry: tools })

    const result = await ctx.callModelWithTools('prompt')
    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls![0]!.result).toEqual({ result: 5 })
    expect(result.toolCalls![0]!.error).toBeUndefined()
  })

  it('callModelWithTools 处理工具不存在的情况', async () => {
    const caller = vi.fn().mockResolvedValue(mockModelResponse({
      content: '',
      stopReason: 'tool_use',
      toolCalls: [
        { id: 'call_1', name: 'nonexistent', input: {} },
      ],
    }))
    const ctx = createContext({ modelCaller: caller })

    const result = await ctx.callModelWithTools('prompt')
    expect(result.toolCalls![0]!.error).toBe('Tool not found: nonexistent')
  })

  it('callModelWithTools 处理工具执行错误', async () => {
    const tools = new ToolRegistry()
    tools.register('fail', {
      description: '失败工具',
      execute: async () => { throw new Error('boom') },
    })

    const caller = vi.fn().mockResolvedValue(mockModelResponse({
      content: '',
      stopReason: 'tool_use',
      toolCalls: [
        { id: 'call_1', name: 'fail', input: {} },
      ],
    }))
    const ctx = createContext({ modelCaller: caller, toolRegistry: tools })

    const result = await ctx.callModelWithTools('prompt')
    expect(result.toolCalls![0]!.error).toBe('boom')
  })

  it('callModelWithTools 不指定 tools 时使用所有已注册工具', async () => {
    const tools = new ToolRegistry()
    tools.register('a', { description: 'a', execute: async () => {} })
    tools.register('b', { description: 'b', execute: async () => {} })

    const caller = vi.fn().mockResolvedValue(mockModelResponse())
    const ctx = createContext({ modelCaller: caller, toolRegistry: tools })

    await ctx.callModelWithTools('prompt')
    const callArgs = caller.mock.calls[0]!
    const toolsArg = (callArgs as unknown[])[1] as Record<string, unknown>
    expect((toolsArg.tools as unknown[])).toHaveLength(2)
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

  describe('streamModel', () => {
    it('使用 streamingModelCaller 进行流式调用', async () => {
      const chunks: string[] = []
      const streamingCaller = vi.fn().mockImplementation(
        async (_prompt: string, _opts: unknown, onChunk: (c: string) => void) => {
          onChunk('hello ')
          onChunk('world')
          return mockModelResponse({ content: 'hello world' })
        }
      )
      const ctx = createContext({ streamingModelCaller: streamingCaller })

      const result = await ctx.streamModel('prompt', (chunk) => chunks.push(chunk))
      expect(chunks).toEqual(['hello ', 'world'])
      expect(result.content).toBe('hello world')
    })

    it('无 streamingModelCaller 时回退到普通 modelCaller', async () => {
      const chunks: string[] = []
      const caller = vi.fn().mockResolvedValue(mockModelResponse({ content: 'full response' }))
      const ctx = createContext({ modelCaller: caller })

      const result = await ctx.streamModel('prompt', (chunk) => chunks.push(chunk))
      expect(chunks).toEqual(['full response'])
      expect(result.content).toBe('full response')
    })

    it('无任何 modelCaller 时抛错', async () => {
      const ctx = createContext({ modelCaller: null, streamingModelCaller: null })
      await expect(ctx.streamModel('prompt', () => {})).rejects.toThrow('Model caller not configured')
    })
  })
})
