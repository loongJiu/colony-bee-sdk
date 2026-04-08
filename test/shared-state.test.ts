import { describe, it, expect } from 'vitest'
import { SharedState } from '../src/shared-state.js'

describe('SharedState', () => {
  it('get / set 基础操作', () => {
    const state = new SharedState()
    expect(state.get('foo')).toBeUndefined()
    state.set('foo', 'bar')
    expect(state.get('foo')).toBe('bar')
  })

  it('delete 删除键', () => {
    const state = new SharedState()
    state.set('x', 1)
    expect(state.delete('x')).toBe(true)
    expect(state.get('x')).toBeUndefined()
  })

  it('构造时接受 initialData', () => {
    const state = new SharedState({ a: 1, b: 'two' })
    expect(state.get('a')).toBe(1)
    expect(state.get('b')).toBe('two')
  })

  it('toJSON() 序列化', () => {
    const state = new SharedState({ x: 10 })
    state.set('y', 20)
    expect(state.toJSON()).toEqual({ x: 10, y: 20 })
  })

  it('空状态 toJSON 返回空对象', () => {
    expect(new SharedState().toJSON()).toEqual({})
  })
})
