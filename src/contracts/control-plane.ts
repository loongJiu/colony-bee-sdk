/**
 * 控制面契约定义与兼容策略
 */

export const CONTROL_PLANE_CONTRACT_VERSION = '1.0.0'
export const CONTROL_PLANE_MIN_COMPATIBLE_VERSION = '1.0.0'
export const CONTROL_PLANE_DEPRECATION_WINDOW_DAYS = 90

export interface ControlPlaneContractDescriptor {
  version: string
  min_compatible_version: string
  deprecation_window_days: number
}

export const CONTROL_PLANE_CONTRACT: ControlPlaneContractDescriptor = {
  version: CONTROL_PLANE_CONTRACT_VERSION,
  min_compatible_version: CONTROL_PLANE_MIN_COMPATIBLE_VERSION,
  deprecation_window_days: CONTROL_PLANE_DEPRECATION_WINDOW_DAYS,
}

export interface EnvelopeTraceFields {
  contract_version?: string
  request_id?: string
  session_id?: string
  agent_id?: string
}

export interface TaskEnvelope extends EnvelopeTraceFields {
  task?: {
    task_id?: string
    name?: string
    description?: string
    input?: unknown
    constraints?: { timeout?: number }
  }
  context?: {
    conversation_id?: string
    shared_state?: Record<string, unknown>
    priority?: 'high' | 'normal' | 'low'
  }
}

export interface TaskResultEnvelope extends EnvelopeTraceFields {
  task_id?: string
  status: 'success' | 'failure'
  output?: unknown
  summary?: string
  usage?: {
    latency_ms: number
    tokenUsage?: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
    toolsInvoked?: string[]
    iterationsCount?: number
  }
  error?: {
    code: string
    message: string
    retryable: boolean
  }
}

export interface CancelSignal extends EnvelopeTraceFields {
  task_id?: string
}

export type HealthStatus = 'ok' | 'healthy' | 'degraded' | 'unhealthy'

export interface HealthPayload extends EnvelopeTraceFields {
  status: HealthStatus
  readiness?: 'ready' | 'not_ready'
  active_tasks?: number
  load?: number
  queue_depth?: number
  timestamp?: string
}

function parseSemver(version: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compareSemver(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  if (a[1] !== b[1]) return a[1] - b[1]
  return a[2] - b[2]
}

export function resolveControlPlaneContractVersion(version?: string | null): string {
  if (!version || version.trim().length === 0) {
    return CONTROL_PLANE_CONTRACT_VERSION
  }
  return version
}

export function isControlPlaneContractCompatible(version?: string | null): boolean {
  const incomingVersion = resolveControlPlaneContractVersion(version)
  const incoming = parseSemver(incomingVersion)
  const current = parseSemver(CONTROL_PLANE_CONTRACT_VERSION)
  const minimum = parseSemver(CONTROL_PLANE_MIN_COMPATIBLE_VERSION)

  if (!incoming || !current || !minimum) {
    return false
  }
  if (incoming[0] !== current[0]) {
    return false
  }
  return compareSemver(incoming, minimum) >= 0
}
