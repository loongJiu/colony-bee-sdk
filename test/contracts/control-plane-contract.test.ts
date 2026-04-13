import { describe, it, expect } from 'vitest'
import {
  CONTROL_PLANE_CONTRACT,
  CONTROL_PLANE_CONTRACT_VERSION,
  CONTROL_PLANE_DEPRECATION_WINDOW_DAYS,
  CONTROL_PLANE_MIN_COMPATIBLE_VERSION,
  isControlPlaneContractCompatible,
  resolveControlPlaneContractVersion,
} from '../../src/contracts/control-plane.js'

describe('control-plane contract', () => {
  it('导出固定的契约描述', () => {
    expect(CONTROL_PLANE_CONTRACT.version).toBe(CONTROL_PLANE_CONTRACT_VERSION)
    expect(CONTROL_PLANE_CONTRACT.min_compatible_version).toBe(CONTROL_PLANE_MIN_COMPATIBLE_VERSION)
    expect(CONTROL_PLANE_CONTRACT.deprecation_window_days).toBe(CONTROL_PLANE_DEPRECATION_WINDOW_DAYS)
  })

  it('缺省版本回退到当前契约版本', () => {
    expect(resolveControlPlaneContractVersion(undefined)).toBe(CONTROL_PLANE_CONTRACT_VERSION)
    expect(resolveControlPlaneContractVersion('')).toBe(CONTROL_PLANE_CONTRACT_VERSION)
  })

  it('同 major 且不低于最小兼容版本时通过', () => {
    expect(isControlPlaneContractCompatible('1.0.0')).toBe(true)
    expect(isControlPlaneContractCompatible('1.2.3')).toBe(true)
  })

  it('major 变更或非法版本时不兼容', () => {
    expect(isControlPlaneContractCompatible('2.0.0')).toBe(false)
    expect(isControlPlaneContractCompatible('invalid')).toBe(false)
  })
})
