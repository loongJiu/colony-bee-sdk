# Integration Runbook

## 路径 A：SDK 独立运行（不依赖 harness）

适用场景：你希望直接用 `colony-bee-sdk` 实现 Worker/Scout，并自行注册任务处理逻辑。

1. 准备 `bee.yaml`（建议参考 `examples/bee.production.yaml`）
2. 运行独立示例：

```bash
QUEEN_URL=http://127.0.0.1:9009 COLONY_TOKEN=change-me node examples/simple-agent.mjs
```

3. 验证：
- 进程日志出现 `joined`
- health 端点返回 `healthy/degraded/unhealthy` + `readiness`
- `requestId/sessionId/taskId/agentId` 在日志可追踪

## 路径 B：harness 通过 adapter 接入 SDK

适用场景：已有 harness runtime，希望保留 harness 编排能力，仅把 Queen 连接层交给 SDK。

1. 在 harness 中实现 adapter，把 `agent.onTask(capability, handler)` 映射到现有 runtime
2. 可直接参考示例：

```bash
QUEEN_URL=http://127.0.0.1:9009 COLONY_TOKEN=change-me node examples/harness-adapter.mjs
```

3. 验证：
- Queen 下发任务后，adapter 把任务转发给 harness runtime
- SDK 负责心跳、重连、取消信号和结果回包
- harness 与 sdk 保持单向依赖（harness -> adapter -> sdk）
