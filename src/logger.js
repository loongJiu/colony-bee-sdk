/**
 * 轻量日志器
 *
 * 支持 child logger 和四级别日志输出
 */

const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 }

export class Logger {
  /** @type {string} */
  #level
  /** @type {Object} */
  #bindings
  /** @type {Console} */
  #output

  /**
   * @param {{ level?: string, output?: Console }} [options]
   * @param {Object} [bindings]
   */
  constructor(options = {}, bindings = {}) {
    this.#level = options.level ?? 'info'
    this.#bindings = bindings
    this.#output = options.output ?? console
  }

  /**
   * 创建子日志器
   *
   * @param {Object} bindings
   * @returns {Logger}
   */
  child(bindings) {
    return new Logger(
      { level: this.#level, output: this.#output },
      { ...this.#bindings, ...bindings }
    )
  }

  /**
   * @param {string} msg
   * @param {Object} [data]
   */
  debug(msg, data) {
    this.#log('debug', msg, data)
  }

  /**
   * @param {string} msg
   * @param {Object} [data]
   */
  info(msg, data) {
    this.#log('info', msg, data)
  }

  /**
   * @param {string} msg
   * @param {Object} [data]
   */
  warn(msg, data) {
    this.#log('warn', msg, data)
  }

  /**
   * @param {string} msg
   * @param {Object} [data]
   */
  error(msg, data) {
    this.#log('error', msg, data)
  }

  /**
   * @param {string} level
   * @param {string} msg
   * @param {Object} [data]
   */
  #log(level, msg, data) {
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
