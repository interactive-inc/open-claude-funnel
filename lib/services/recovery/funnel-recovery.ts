import type { ChannelConfig } from "@/engine/settings/settings-schema"

/** Narrow gateway control — start / stop / restart and a probe. */
export type RecoveryGatewayControl = {
  isRunning(): boolean
  start(options?: { caffeinate?: boolean }): Promise<boolean>
  restart(options?: {
    onlyIfRunning?: boolean
    caffeinate?: boolean
  }): Promise<{ ok: boolean; wasRunning: boolean; stopped: boolean; started: boolean }>
}

/** Narrow listeners client — restart per (channel, connector). */
export type RecoveryListenerControl = {
  list(): Promise<
    | {
        state: "ok"
        listeners: {
          channelName: string
          name: string
          alive: boolean
        }[]
      }
    | { state: "offline" }
    | { state: "error"; reason: string }
  >
  restart(
    channelName: string,
    connectorName: string,
  ): Promise<
    | { state: "ok" }
    | { state: "offline" }
    | { state: "not-found" }
    | { state: "error"; reason: string }
  >
}

/** Narrow channel registry. */
export type RecoveryChannelSource = {
  list(): ChannelConfig[]
}

type Props = {
  gateway: RecoveryGatewayControl
  listeners: RecoveryListenerControl
  channels: RecoveryChannelSource
}

export type RecoveryAction =
  | { kind: "gateway:started" }
  | { kind: "gateway:already-running" }
  | { kind: "gateway:restarted" }
  | { kind: "listener:restarted"; channel: string; connector: string }
  | { kind: "listener:skipped"; channel: string; connector: string; reason: string }

export type RecoveryResult = {
  ok: boolean
  actions: RecoveryAction[]
  message: string
}

/**
 * Programmable self-healing primitives. The CLI / MCP / SDK normally drive
 * these through FunnelDoctor (which decides which fixes to attempt and in
 * what order). Exposed as a building block for hosts that want fine-grained
 * control (custom policies, scripted maintenance).
 *
 * Every method returns a RecoveryResult so the caller can chain without
 * throwing.
 */
export class FunnelRecovery {
  constructor(private readonly props: Props) {
    Object.freeze(this)
  }

  /**
   * Make sure the gateway daemon is running. Returns immediately if already up.
   */
  async ensureGatewayRunning(): Promise<RecoveryResult> {
    if (this.props.gateway.isRunning()) {
      return {
        ok: true,
        actions: [{ kind: "gateway:already-running" }],
        message: "gateway is already running",
      }
    }

    const started = await this.props.gateway.start()

    if (!started) {
      return {
        ok: false,
        actions: [],
        message: "gateway failed to start — check `fnl gateway logs`",
      }
    }

    return {
      ok: true,
      actions: [{ kind: "gateway:started" }],
      message: "gateway started",
    }
  }

  async restartGateway(): Promise<RecoveryResult> {
    const result = await this.props.gateway.restart()

    if (!result.ok) {
      return {
        ok: false,
        actions: [],
        message: "gateway restart failed — check `fnl gateway logs`",
      }
    }

    return {
      ok: true,
      actions: [{ kind: "gateway:restarted" }],
      message: "gateway restarted",
    }
  }

  async restartListener(channelName: string, connectorName: string): Promise<RecoveryResult> {
    const op = await this.props.listeners.restart(channelName, connectorName)

    if (op.state === "offline") {
      return {
        ok: false,
        actions: [],
        message: "gateway is not running — call ensureGatewayRunning() first",
      }
    }

    if (op.state === "not-found") {
      return {
        ok: false,
        actions: [
          {
            kind: "listener:skipped",
            channel: channelName,
            connector: connectorName,
            reason: "not-found",
          },
        ],
        message: `listener not found: ${channelName}/${connectorName}`,
      }
    }

    if (op.state === "error") {
      return {
        ok: false,
        actions: [
          {
            kind: "listener:skipped",
            channel: channelName,
            connector: connectorName,
            reason: op.reason,
          },
        ],
        message: `listener restart failed: ${op.reason}`,
      }
    }

    return {
      ok: true,
      actions: [{ kind: "listener:restarted", channel: channelName, connector: connectorName }],
      message: `restarted ${channelName}/${connectorName}`,
    }
  }

  /**
   * Restart every dead listener across every channel. The gateway must already
   * be running — call ensureGatewayRunning() first if unsure.
   */
  async restartAllDeadListeners(): Promise<RecoveryResult> {
    const listed = await this.props.listeners.list()

    if (listed.state === "offline") {
      return {
        ok: false,
        actions: [],
        message: "gateway is not running — call ensureGatewayRunning() first",
      }
    }

    if (listed.state === "error") {
      return {
        ok: false,
        actions: [],
        message: `could not list listeners: ${listed.reason}`,
      }
    }

    const dead = listed.listeners.filter((l) => !l.alive)

    if (dead.length === 0) {
      return { ok: true, actions: [], message: "no dead listeners found" }
    }

    const actions: RecoveryAction[] = []

    for (const listener of dead) {
      const op = await this.props.listeners.restart(listener.channelName, listener.name)

      if (op.state === "ok") {
        actions.push({
          kind: "listener:restarted",
          channel: listener.channelName,
          connector: listener.name,
        })
      } else {
        const reason = op.state === "error" ? op.reason : op.state

        actions.push({
          kind: "listener:skipped",
          channel: listener.channelName,
          connector: listener.name,
          reason,
        })
      }
    }

    const restartedCount = actions.filter((a) => a.kind === "listener:restarted").length

    return {
      ok: restartedCount > 0,
      actions,
      message: `restarted ${restartedCount}/${dead.length} dead listener(s)`,
    }
  }
}
