/**
 * 共享状态 KV 存储
 *
 * 基于 Map，用于任务间共享状态
 */

export class SharedState {
  readonly #data: Map<string, unknown>

  constructor(initialData?: Record<string, unknown>) {
    this.#data = new Map()
    if (initialData && typeof initialData === 'object') {
      for (const [key, value] of Object.entries(initialData)) {
        this.#data.set(key, value)
      }
    }
  }

  get(key: string): unknown {
    return this.#data.get(key)
  }

  set(key: string, value: unknown): void {
    this.#data.set(key, value)
  }

  delete(key: string): boolean {
    return this.#data.delete(key)
  }

  toJSON(): Record<string, unknown> {
    return Object.fromEntries(this.#data)
  }
}
