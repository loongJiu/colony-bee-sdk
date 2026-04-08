/**
 * 轻量日志器
 *
 * 支持 child logger 和四级别日志输出
 */

const LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3
} as const

type LogLevel = keyof typeof LEVELS

interface LoggerOptions {
  level?: LogLevel
  output?: Pick<Console, 'log' | 'warn' | 'error'>
}

type LoggerBindings = Record<string, string>

export class Logger {
  readonly #level: LogLevel
  readonly #bindings: LoggerBindings
  readonly #output: Pick<Console, 'log' | 'warn' | 'error'>

  constructor(options: LoggerOptions = {}, bindings: LoggerBindings = {}) {
    this.#level = options.level ?? 'info'
    this.#bindings = bindings
    this.#output = options.output ?? console
  }

  child(bindings: LoggerBindings): Logger {
    return new Logger(
      { level: this.#level, output: this.#output },
      { ...this.#bindings, ...bindings }
    )
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.#log('debug', msg, data)
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.#log('info', msg, data)
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.#log('warn', msg, data)
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.#log('error', msg, data)
  }

  #log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVELS[level] < LEVELS[this.#level]) return
    const prefix = Object.keys(this.#bindings).length > 0
      ? `[${Object.values(this.#bindings).join(' ')}]`
      : ''
    const ts = new Date().toISOString()
    const line = data
      ? `${ts} ${level.toUpperCase()} ${prefix} ${msg} ${JSON.stringify(data)}`
      : `${ts} ${level.toUpperCase()} ${prefix} ${msg}`

    switch (level) {
      case 'debug':
      case 'info':
        this.#output.log(line)
        break
      case 'warn':
        this.#output.warn(line)
        break
      case 'error':
        this.#output.error(line)
        break
    }
  }
}
