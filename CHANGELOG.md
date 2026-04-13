# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-04-13

### Iteration 1: 工具系统增强

- **Added** `ToolRegistry.register()` 支持带 Zod schema 的完整工具定义（`description`, `inputSchema`, `outputSchema`, `execute`）
- **Added** `ToolRegistry.getToolSchemas()` 方法，将 Zod schema 转换为兼容 OpenAI/Anthropic 的 JSON Schema
- **Added** `BeeAgent.getToolSchemas()` 代理方法
- **Added** `ToolSchema`、`FullToolDefinition` 类型导出
- **Added** `zod-to-json-schema` 依赖
- **Changed** 旧的函数简写和纯 schema 对象注册方式保持向后兼容

### Iteration 2: `callModelWithTools` 完整实现

- **Added** `ModelResponse` 结构化响应类型（`content`, `toolCalls`, `usage`, `stopReason`, `raw`）
- **Added** `ToolCall` 类型（含 `id`, `name`, `input`, `result`, `error`）
- **Added** `StopReason` 类型
- **Changed** `callModelWithTools` 完整实现单轮工具调用：解析 tool schemas → 调用模型 → 解析响应 → 执行工具 → 附加结果
- **Changed** `callModelWithTools` 返回类型从 `Promise<unknown>` 变为 `Promise<ModelResponse>`

### Iteration 3: 流式输出支持

- **Added** `StreamingModelCaller` 类型
- **Added** `TaskContext.streamModel(prompt, onChunk, options?)` 流式模型调用方法
- **Added** `BeeAgent.setStreamingModelCaller(fn)` 方法
- **Changed** 未配置 `streamingModelCaller` 时自动回退到普通 `callModel` 一次性输出

### Iteration 4: 结构化任务结果

- **Added** `StructuredTaskResult<T>` 类型（`data` + `meta` + `summary`）
- **Added** `TokenUsage` 类型
- **Added** `TaskContext<TInput>` 泛型化，`input` 属性类型安全
- **Added** `TaskContext.getMetadata()` 自动收集元数据（`toolsInvoked`, `iterationsCount`, `tokenUsage`）
- **Changed** `onTask<TInput, TOutput>` 支持泛型，handler 可返回 `TOutput` 或 `StructuredTaskResult<TOutput>`
- **Changed** `TaskManager` 识别 `StructuredTaskResult` 格式并合并自动收集的元数据

### Iteration 5: 安全加固

- **Added** HTTP 端点认证，支持 `bearer` 和 `hmac` 两种方式，使用 timing-safe 比较防止时序攻击
- **Added** `bee.yaml` 支持 `${VAR}` 和 `${VAR:-default}` 环境变量插值语法
- **Added** `security.endpoint_auth` 配置节
- **Added** `EndpointAuthConfig` 类型导出
- **Changed** GET `/bee/health` 不受认证保护，POST 端点受保护

### Iteration 6: 可靠性增强

- **Added** 任务优先级队列，支持 `fifo`（默认）和 `priority` 调度策略
- **Added** `bee.yaml` 新增 `constraints.queue_strategy` 配置
- **Added** `ExternalLogger` 接口，支持注入自定义日志器（pino / winston 等）
- **Added** `BeeAgent.fromEnv()` 纯环境变量构建方式（适用于容器化部署）
- **Added** `bee.yaml` 新增 `runtime.health_check` 配置（独立端口健康检查服务）
- **Added** `QueueStrategy`、`TaskPriority` 类型导出
- **Changed** 并发超限时任务入队等待而非直接拒绝（队列满才拒绝）
- **Changed** `TaskManager.getStats()` 返回真实队列深度

### Iteration 7: DX 改善

- **Added** `devMode` 开发模式标志（`BeeAgent.fromSpec(path, { devMode: true })`）
  - 日志级别自动设为 debug
  - 打印每次任务的完整输入/输出
  - 打印工具调用详情
  - 禁用自动重连（失败立即暴露问题）
- **Changed** `onTask<TInput, TOutput>` 泛型提供完整类型推断

## [1.0.0] - 2026-04-08

### Added

- 核心 BeeAgent 类（spec 加载、HTTP 服务器、Queen 客户端、任务管理）
- 四步握手认证协议（SHA256 + HMAC-SHA256）
- 指数退避自动重连
- `bee.yaml` 声明式配置（Zod 校验）
- 任务并发控制与队列调度
- 工具注册表（ToolRegistry）
- 技能注册表（SkillRegistry）
- 模型调用注入（`setModelCaller`）
- 心跳保活机制
- 内嵌 HTTP 服务器（任务接收、健康检查）
- ESM + CJS 双格式输出
- EventEmitter 生命周期事件
- 完整错误层级（BeeError / TaskError / TimeoutError / ConnectionError / HandshakeError / UnauthorizedError）
