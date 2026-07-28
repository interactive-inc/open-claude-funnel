import { describe, expect, test } from "bun:test"
import { FunnelDoctor } from "@/services/doctor/funnel-doctor"
import type {
  ChannelDiagnosis,
  DiagnoseAllReport,
  FunnelDiagnostics,
} from "@/services/diagnostics/funnel-diagnostics"
import type { FunnelRecovery, RecoveryResult } from "@/services/recovery/funnel-recovery"

const baseChannel = (
  status: "ok" | "warn" | "error",
  overrides: Partial<ChannelDiagnosis> = {},
): ChannelDiagnosis => ({
  channel: "ops",
  channelId: "ch-1",
  gateway: { running: true, pid: 1, port: 9742, uptimeMs: 1000, statusError: null },
  configuredConnectors: 1,
  listeners: [
    { name: "slack", type: "slack", alive: true, events: 0, errors: 0, lastEventAt: null },
  ],
  claudeClients: 1,
  recentEvents: [],
  connectionErrors: [],
  diagnosis: {
    status,
    message: status === "ok" ? "ok" : `${status} reason`,
    nextActions: [],
    rootCause: null,
  },
  ...overrides,
})

const report = (channels: ChannelDiagnosis[]): DiagnoseAllReport => ({
  summary: {
    total: channels.length,
    ok: channels.filter((c) => c.diagnosis.status === "ok").length,
    warn: channels.filter((c) => c.diagnosis.status === "warn").length,
    error: channels.filter((c) => c.diagnosis.status === "error").length,
    criticalChannels: channels.filter((c) => c.diagnosis.status === "error").map((c) => c.channel),
    warnChannels: channels.filter((c) => c.diagnosis.status === "warn").map((c) => c.channel),
    suggestedActions: [],
  },
  channels,
})

const buildDiagnostics = (reports: DiagnoseAllReport[]): FunnelDiagnostics => {
  let i = 0
  return {
    diagnoseAll: async () => reports[Math.min(i++, reports.length - 1)]!,
  } as unknown as FunnelDiagnostics
}

const okResult: RecoveryResult = {
  ok: true,
  actions: [{ kind: "listener:restarted", channel: "ops", connector: "slack" }],
  message: "",
}

describe("FunnelDoctor", () => {
  test("aggressive mode skips gateway restart when the safe pass already fixed everything", async () => {
    const recovery = {
      ensureGatewayRunning: async () => okResult,
      restartGateway: async (): Promise<RecoveryResult> => {
        throw new Error("gateway should not be restarted when safe fixes succeeded")
      },
      restartAllDeadListeners: async (): Promise<RecoveryResult> => okResult,
    } as unknown as FunnelRecovery

    const doctor = new FunnelDoctor({
      diagnostics: buildDiagnostics([
        // before: one error
        report([
          baseChannel("error", {
            listeners: [
              {
                name: "slack",
                type: "slack",
                alive: false,
                events: 0,
                errors: 1,
                lastEventAt: null,
              },
            ],
          }),
        ]),
        // mid (between safe and aggressive): all fixed
        report([baseChannel("ok")]),
        // after
        report([baseChannel("ok")]),
      ]),
      recovery,
    })

    const result = await doctor.run("aggressive")

    expect(result.status).toBe("ok")
    expect(result.appliedActions.some((a) => a.kind === "gateway:restarted")).toBe(false)
  })

  test("aggressive mode restarts gateway when safe pass leaves errors", async () => {
    let gatewayRestarted = false
    const recovery = {
      ensureGatewayRunning: async () => okResult,
      restartGateway: async (): Promise<RecoveryResult> => {
        gatewayRestarted = true
        return { ok: true, actions: [{ kind: "gateway:restarted" }], message: "" }
      },
      restartAllDeadListeners: async (): Promise<RecoveryResult> => ({
        ok: false,
        actions: [],
        message: "listener restart failed",
      }),
    } as unknown as FunnelRecovery

    const doctor = new FunnelDoctor({
      diagnostics: buildDiagnostics([
        report([
          baseChannel("error", {
            listeners: [
              {
                name: "slack",
                type: "slack",
                alive: false,
                events: 0,
                errors: 5,
                lastEventAt: null,
              },
            ],
          }),
        ]),
        report([
          baseChannel("error", {
            listeners: [
              {
                name: "slack",
                type: "slack",
                alive: false,
                events: 0,
                errors: 5,
                lastEventAt: null,
              },
            ],
          }),
        ]),
        report([baseChannel("ok")]),
      ]),
      recovery,
    })

    const result = await doctor.run("aggressive")

    expect(gatewayRestarted).toBe(true)
    expect(result.appliedActions.some((a) => a.kind === "gateway:restarted")).toBe(true)
  })
})
