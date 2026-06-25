import { z } from "zod"
import { factory } from "@/cli/factory"
import { booleanFlag } from "@/cli/router/boolean-flag"
import { helpGuard } from "@/cli/router/help-guard"
import { zValidator } from "@/cli/router/validator"
import { renderYaml } from "@/engine/yaml/yaml-render"

const debugHelp = `funnel debug / per-channel inspection (events, drops, connection lifecycle, logs, replay)

usage / funnel debug [subcommand] [--channel <name>] [--connector <name>] [--all] [--limit <N>]

subcommands:
  (none) / full diagnosis for one channel (or --all for every channel)
  events / last N processed events with outcome
  dropped / events filtered out (skip:*) with payload
  errors / listener auth-failed and error rows
  connection / full connection lifecycle (started / connected / disconnected / stopped + errors)
  raw / raw inbound events before any processing (pre-processor drops)
  logs / tail of the gateway daemon log (FunnelLogger + flume internal logs)
  replay / re-send a past event into a channel

options:
  --channel <name> / channel to inspect (auto-selected when only one exists)
  --connector <name> / restrict events/dropped/errors/connection/raw to one connector
  --all / diagnose every channel
  --limit <N> / number of rows (default 5 for diagnosis, 20 for subcommands, 200 for logs)

For the common case, prefer fnl doctor — it runs a full diagnosis and can apply
safe fixes in one shot. fnl debug is the lower-level view.

output / valid YAML

programmable / funnel.diagnostics.diagnose() / .diagnoseAll() / .recentEvents() / .droppedEvents() / .rawEvents() / .connectionErrors() / .connectionTimeline() / .recentLogs() / .replay()

examples:
  funnel debug
  funnel debug --all
  funnel debug --channel ops
  funnel debug events --channel ops --limit 50
  funnel debug dropped --channel ops
  funnel debug connection --channel ops --connector slack-prod
  funnel debug logs --grep slack`

const debugEventsHelp = `funnel debug events / last N processed events

usage / funnel debug events [--channel <name>] [--limit <N>]

programmable / funnel.diagnostics.recentEvents(channel, limit)`

const debugDroppedHelp = `funnel debug dropped / events filtered out (skip:*)

usage / funnel debug dropped [--channel <name>] [--limit <N>]

shows skip reasons: skip:type / skip:subtype / skip:dedup / skip:self-user /
skip:self-bot / skip:preprocess

programmable / funnel.diagnostics.droppedEvents(channel, limit)`

const debugErrorsHelp = `funnel debug errors / listener auth-failed and error events

usage / funnel debug errors [--channel <name>] [--limit <N>]

programmable / funnel.diagnostics.connectionErrors(channel, limit)`

const debugReplayHelp = `funnel debug replay / re-publish a past event into a channel

usage / funnel debug replay --channel <name> [--seq <N>]

programmable / funnel.diagnostics.replay(channel, seq?)`

const debugRawHelp = `funnel debug raw / raw inbound events before any processing

usage / funnel debug raw [--channel <name>] [--connector <name>] [--limit <N>]

shows every event the listener received, including those dropped pre-processor
(envelope shape changes, pre-READY, malformed payloads).

programmable / funnel.diagnostics.rawEvents(channel, { connector, limit })`

const debugConnectionHelp = `funnel debug connection / full lifecycle (started / connected / disconnected / stopped + auth-failed / error)

usage / funnel debug connection [--channel <name>] [--connector <name>] [--limit <N>]

programmable / funnel.diagnostics.connectionTimeline(channel, { connector, limit })`

const debugLogsHelp = `funnel debug logs / tail of the gateway daemon log

usage / funnel debug logs [--grep <substr>] [--limit <N>]

shows funnel.log entries — structured FunnelLogger output and forwarded flume
logs. Use --grep to filter (case-insensitive substring).

programmable / funnel.diagnostics.recentLogs({ grep, limit })`

const channelLimitQuery = z.object({
  channel: z.string().optional(),
  connector: z.string().optional(),
  limit: z.string().optional(),
})

const resolveTargetChannel = (
  c: { env: { funnel: { channels: { list(): { name: string }[] } } } },
  channelArg: string | undefined,
): { kind: "ok"; name: string | null } | { kind: "error"; payload: unknown } => {
  const channels = c.env.funnel.channels.list()

  if (channelArg) {
    const match = channels.find((ch) => ch.name === channelArg)

    if (!match) {
      return {
        kind: "error",
        payload: {
          error: `channel not found: ${channelArg}`,
          availableChannels: channels.map((ch) => ch.name),
        },
      }
    }

    return { kind: "ok", name: match.name }
  }

  if (channels.length === 0) return { kind: "ok", name: null }
  if (channels.length === 1) return { kind: "ok", name: channels[0]?.name ?? null }

  return {
    kind: "error",
    payload: {
      error: "multiple channels — specify one with --channel",
      channels: channels.map((ch) => ch.name),
    },
  }
}

export const debugHandler = factory.createHandlers(
  helpGuard(debugHelp),
  zValidator(
    "query",
    z.object({
      channel: z.string().optional(),
      all: booleanFlag,
      limit: z.string().optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const isAll = query.all === true

    if (isAll) {
      const report = await funnel.diagnostics.diagnoseAll()

      return c.text(renderYaml(report))
    }

    const allChannels = funnel.channels.list()

    if (allChannels.length === 0) {
      return c.text(
        renderYaml({ error: "no channels configured", nextAction: "fnl channels add <name>" }),
      )
    }

    let targetName: string | null = null

    if (query.channel) {
      const match = allChannels.find((ch) => ch.name === query.channel)

      if (!match) {
        return c.text(
          renderYaml({
            error: `channel not found: ${query.channel}`,
            availableChannels: allChannels.map((ch) => ch.name),
          }),
        )
      }

      targetName = match.name
    } else if (allChannels.length === 1) {
      targetName = allChannels[0]?.name ?? null
    } else {
      return c.text(
        renderYaml({
          error: "multiple channels — specify one with --channel or use --all",
          channels: allChannels.map((ch) => ch.name),
          hint: "use --all for all channels at once",
        }),
      )
    }

    const report = await funnel.diagnostics.diagnose(targetName ?? undefined)

    if (!report) return c.text(renderYaml({ error: "channel not resolvable" }))

    return c.text(renderYaml(report))
  },
)

export const debugEventsHandler = factory.createHandlers(
  helpGuard(debugEventsHelp),
  zValidator("query", channelLimitQuery),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20
    const resolved = resolveTargetChannel(c, query.channel)

    if (resolved.kind === "error") return c.text(renderYaml(resolved.payload))

    const events = await funnel.diagnostics.recentEvents(resolved.name, {
      connector: query.connector,
      limit,
    })

    return c.text(renderYaml({ events }))
  },
)

export const debugDroppedHandler = factory.createHandlers(
  helpGuard(debugDroppedHelp),
  zValidator("query", channelLimitQuery),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20
    const resolved = resolveTargetChannel(c, query.channel)

    if (resolved.kind === "error") return c.text(renderYaml(resolved.payload))

    const events = await funnel.diagnostics.droppedEvents(resolved.name, {
      connector: query.connector,
      limit,
    })

    return c.text(renderYaml({ dropped: events }))
  },
)

export const debugErrorsHandler = factory.createHandlers(
  helpGuard(debugErrorsHelp),
  zValidator("query", channelLimitQuery),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20
    const resolved = resolveTargetChannel(c, query.channel)

    if (resolved.kind === "error") return c.text(renderYaml(resolved.payload))

    const errors = await funnel.diagnostics.connectionErrors(resolved.name, {
      connector: query.connector,
      limit,
    })

    return c.text(renderYaml({ errors }))
  },
)

export const debugReplayHandler = factory.createHandlers(
  helpGuard(debugReplayHelp),
  zValidator(
    "query",
    z.object({
      channel: z.string().optional(),
      seq: z.string().optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const resolved = resolveTargetChannel(c, query.channel)

    if (resolved.kind === "error") return c.text(renderYaml(resolved.payload))

    if (!resolved.name) return c.text(renderYaml({ error: "no channels configured" }))

    const seq = query.seq ? Number(query.seq) : undefined
    const result = await funnel.diagnostics.replay(resolved.name, seq)

    return c.text(renderYaml(result))
  },
)

export const debugRawHandler = factory.createHandlers(
  helpGuard(debugRawHelp),
  zValidator("query", channelLimitQuery),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20
    const resolved = resolveTargetChannel(c, query.channel)

    if (resolved.kind === "error") return c.text(renderYaml(resolved.payload))

    const events = await funnel.diagnostics.rawEvents(resolved.name, {
      connector: query.connector,
      limit,
    })

    return c.text(renderYaml({ raw: events }))
  },
)

export const debugConnectionHandler = factory.createHandlers(
  helpGuard(debugConnectionHelp),
  zValidator("query", channelLimitQuery),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 20
    const resolved = resolveTargetChannel(c, query.channel)

    if (resolved.kind === "error") return c.text(renderYaml(resolved.payload))

    const timeline = await funnel.diagnostics.connectionTimeline(resolved.name, {
      connector: query.connector,
      limit,
    })

    return c.text(renderYaml({ connection: timeline }))
  },
)

export const debugLogsHandler = factory.createHandlers(
  helpGuard(debugLogsHelp),
  zValidator(
    "query",
    z.object({
      grep: z.string().optional(),
      limit: z.string().optional(),
    }),
  ),
  async (c) => {
    const query = c.req.valid("query")
    const funnel = c.env.funnel
    const limit = query.limit ? Math.max(1, Number(query.limit)) : 200
    const result = await funnel.diagnostics.recentLogs({ grep: query.grep, limit })

    return c.text(renderYaml(result))
  },
)
