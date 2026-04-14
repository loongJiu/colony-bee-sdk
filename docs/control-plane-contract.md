# Control Plane Contract

`colony-bee-sdk` 将控制面契约版本固定为 `1.0.0`，并在所有关键链路中显式传递版本：

- `join`
- `heartbeat`
- `task`（入站）
- `cancel`（入站）
- `reconnect`（复用 `join/verify`）

## 关键 Envelope

- `TaskEnvelope`：任务下发结构（含 `task/context` 与 trace 字段）
- `TaskResultEnvelope`：任务结果结构（含 `status/output/error/usage`）
- `CancelSignal`：取消信号结构
- `HealthPayload`：健康探针结构

## 兼容规则

- 只允许同 `major` 版本互通（例如 `1.x` 与 `1.x`）。
- 字段新增必须向后兼容（新增可选字段，不删除已有字段）。
- 破坏性变更必须提升 `major` 版本。
- deprecated 字段默认保留窗口为 `90` 天。

## 回归门禁

发布前必须通过：

```bash
npm run test:contracts
```

该脚本会执行 `join/task/cancel/heartbeat/reconnect` 的契约回归测试；任意失败即阻断发布流程。
