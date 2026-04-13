import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { ToolRegistry } from '../../src/task/tool-registry.js'

describe('ToolRegistry', () => {
  it('注册函数模式（向后兼容）', () => {
    const reg = new ToolRegistry()
    const fn = (input: unknown) => input
    reg.register('t1', fn)

    const tool = reg.get('t1')
    expect(tool?.handler).toBe(fn)
    expect(tool?.schema).toBeUndefined()
    expect(tool?.description).toBeUndefined()
    expect(tool?.inputSchema).toBeUndefined()
  })

  it('注册 schema 模式（向后兼容）', () => {
    const reg = new ToolRegistry()
    reg.register('t1', { type: 'object', properties: {} })

    const tool = reg.get('t1')
    expect(tool?.handler).toBeUndefined()
    expect(tool?.schema).toEqual({ type: 'object', properties: {} })
  })

  it('注册带 schema 的完整工具定义', () => {
    const reg = new ToolRegistry()
    const execute = async ({ query }: { query: string }) => ({ results: [query] })

    reg.register('search', {
      description: '搜索互联网',
      inputSchema: z.object({
        query: z.string().describe('搜索关键词'),
        maxResults: z.number().optional().default(5),
      }),
      outputSchema: z.object({
        results: z.array(z.object({
          title: z.string(),
          url: z.string(),
        })),
      }),
      execute,
    })

    const tool = reg.get('search')
    expect(tool?.handler).toBe(execute)
    expect(tool?.description).toBe('搜索互联网')
    expect(tool?.inputSchema).toBeDefined()
    expect(tool?.outputSchema).toBeDefined()
  })

  it('has / list', () => {
    const reg = new ToolRegistry()
    reg.register('a', () => {})
    reg.register('b', {
      description: 'tool b',
      execute: () => {},
    })

    expect(reg.has('a')).toBe(true)
    expect(reg.has('c')).toBe(false)
    expect(reg.list()).toEqual(['a', 'b'])
  })

  describe('getToolSchemas()', () => {
    it('返回空数组当没有工具', () => {
      const reg = new ToolRegistry()
      expect(reg.getToolSchemas()).toEqual([])
    })

    it('返回函数模式工具的 schema（无 parameters 详情）', () => {
      const reg = new ToolRegistry()
      reg.register('simple', () => {})

      const schemas = reg.getToolSchemas()
      expect(schemas).toHaveLength(1)
      expect(schemas[0]).toEqual({
        name: 'simple',
        description: undefined,
        parameters: {
          type: 'object',
          properties: {},
        },
      })
    })

    it('从 Zod schema 生成 JSON Schema', () => {
      const reg = new ToolRegistry()
      reg.register('search', {
        description: '搜索互联网获取最新信息',
        inputSchema: z.object({
          query: z.string().describe('搜索关键词'),
          maxResults: z.number().optional().default(5).describe('最大返回条数'),
        }),
        execute: async () => {},
      })

      const schemas = reg.getToolSchemas()
      expect(schemas).toHaveLength(1)

      const schema = schemas[0]!
      expect(schema.name).toBe('search')
      expect(schema.description).toBe('搜索互联网获取最新信息')
      expect(schema.parameters.type).toBe('object')
      expect(schema.parameters.properties.query).toBeDefined()
      expect(schema.parameters.properties.maxResults).toBeDefined()
      expect(schema.parameters.required).toContain('query')
    })

    it('混合注册模式返回所有工具的 schema', () => {
      const reg = new ToolRegistry()
      reg.register('simple', () => {})
      reg.register('advanced', {
        description: '高级工具',
        inputSchema: z.object({ input: z.string() }),
        execute: async () => {},
      })

      const schemas = reg.getToolSchemas()
      expect(schemas).toHaveLength(2)
      expect(schemas.map(s => s.name)).toEqual(['simple', 'advanced'])
    })
  })
})
