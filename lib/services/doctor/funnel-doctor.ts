import type {
  ChannelDiagnosis,
  DiagnoseAllReport,
  FunnelDiagnostics,
} from "@/services/diagnostics/funnel-diagnostics"
import type { FunnelRecovery, RecoveryAction } from "@/services/recovery/funnel-recovery"

type Props = {
  diagnostics: FunnelDiagnostics
  recovery: FunnelRecovery
}

export type DoctorFixMode =
  /** No mutations. Run diagnoseAll and report what would be fixed. */
  | "off"
  /** Apply only idempotent, low-risk fixes — start the gateway, restart dead listeners. */
  | "safe"
  /** Add high-impact fixes — full gateway restart when partial fixes are insufficient. */
  | "aggressive"

export type DoctorReport = {
  /** "ok" if every channel is healthy after the run; "warn" if anything is still off; "error" if a fix step itself failed. */
  status: "ok" | "warn" | "error"
  /** Human-readable summary suitable for stdout. */
  message: string
  /** Aggregated diagnosis after any fix pass. */
  after: DiagnoseAllReport
  /** Diagnosis before fixing, only included when fix mode is not "off". */
  before: DiagnoseAllReport | null
  /** Each recovery action that ran during the fix pass. */
  appliedActions: RecoveryAction[]
  /** Channels still unhealthy after the fix pass (or all unhealthy channels when fix is off). */
  remainingIssues: Array<{
    channel: string
    diagnosis: ChannelDiagnosis["diagnosis"]
  }>
}

/**
 * One-shot diagnose-and-fix entry point. The CLI exposes this as `fnl doctor`,
 * the MCP server exposes it as `fnl_doctor`. Both surfaces should prefer this
 * over chaining FunnelDiagnostics and FunnelRecovery by hand — the orchestration
 * logic (which fixes to attempt, in what order, when to escalate) lives here.
 */
export class FunnelDoctor {
  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  async run(mode: DoctorFixMode = "off"): Promise<DoctorReport> {
    if (mode === "off") {
      const after = await this.props.diagnostics.diagnoseAll()
      return this.buildReport({ before: null, after, appliedActions: [], fixFailed: false })
    }

    const before = await this.props.diagnostics.diagnoseAll()
    const applied: RecoveryAction[] = []
    let fixFailed = false

    const needsGatewayStart = before.channels.some(
      (ch) => ch.diagnosis.status === "error" && !ch.gateway.running,
    )

    if (needsGatewayStart) {
      const result = await this.props.recovery.ensureGatewayRunning()
      applied.push(...result.actions)
      if (!result.ok) fixFailed = true
    }

    const hasDeadListeners = before.channels.some((ch) => ch.listeners.some((l) => !l.alive))

    if (hasDeadListeners) {
      const result = await this.props.recovery.restartAllDeadListeners()
      applied.push(...result.actions)
      if (!result.ok && result.actions.length === 0) fixFailed = true
    }

    if (mode === "aggressive") {
      const stillBroken =
        applied.length === 0 || before.channels.some((ch) => ch.diagnosis.status === "error")

      if (stillBroken) {
        const result = await this.props.recovery.restartGateway()
        applied.push(...result.actions)
        if (!result.ok) fixFailed = true
      }
    }

    const after = await this.props.diagnostics.diagnoseAll()
    return this.buildReport({ before, after, appliedActions: applied, fixFailed })
  }

  private buildReport(input: {
    before: DiagnoseAllReport | null
    after: DiagnoseAllReport
    appliedActions: RecoveryAction[]
    fixFailed: boolean
  }): DoctorReport {
    const remaining = input.after.channels
      .filter((ch) => ch.diagnosis.status !== "ok")
      .map((ch) => ({ channel: ch.channel, diagnosis: ch.diagnosis }))

    const status: DoctorReport["status"] = input.fixFailed
      ? "error"
      : remaining.length === 0
        ? "ok"
        : "warn"

    const message = buildMessage({
      mode: input.before === null ? "off" : "fix",
      status,
      appliedCount: input.appliedActions.length,
      remainingCount: remaining.length,
    })

    return {
      status,
      message,
      before: input.before,
      after: input.after,
      appliedActions: input.appliedActions,
      remainingIssues: remaining,
    }
  }
}

const buildMessage = (input: {
  mode: "off" | "fix"
  status: DoctorReport["status"]
  appliedCount: number
  remainingCount: number
}): string => {
  if (input.mode === "off") {
    if (input.remainingCount === 0) return "all channels healthy"
    return `${input.remainingCount} channel(s) need attention — run \`fnl doctor --fix\` to apply suggested fixes`
  }

  if (input.status === "error") return "one or more fix steps failed — check fnl gateway logs"
  if (input.status === "ok") return `applied ${input.appliedCount} fix(es), all channels healthy`

  return `applied ${input.appliedCount} fix(es), ${input.remainingCount} channel(s) still need attention`
}
