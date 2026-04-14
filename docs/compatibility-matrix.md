# Queen x SDK Compatibility Matrix

| Queen Version | SDK Version | Contract Version | Status |
|---|---|---|---|
| `1.x` | `1.2.x` | `1.0.x` | supported |
| `1.x` | `1.1.x` | `1.0.x` | supported |
| `2.x` | `1.2.x` | `2.0.x` | not supported |

## Notes

- SDK 在运行时会校验 `contract_version`，若主版本不兼容会直接拒绝请求。
- 每次发布 SDK 时需要同步更新此矩阵与发布说明。
