import { join } from "node:path"
import { z } from "zod"
import type { ConnectorDescriptor } from "@/engine/connectors/connector-descriptor"
import {
  scheduleConnectorSchema,
  scheduleEntrySchema,
  scheduleEntryInputSchema,
} from "@/engine/connectors/schedule-connector-schema"
import { FunnelScheduleListener, type ScheduleOnFired } from "@/engine/connectors/schedule-listener"
import { FunnelScheduleStateStore } from "@/engine/connectors/schedule-state-store"

export type ScheduleConnectorOptions = {
  /** Invoked after a schedule entry fires successfully — e.g. to drop one-shot entries. */
  onFired?: ScheduleOnFired
}

const removeEntryArgsSchema = z.object({ id: z.string() })

/**
 * Schedule connector descriptor. Pass `scheduleConnector()` to
 * `new Funnel({ connectors: [...] })` to enable the type. Schedule has no
 * outbound adapter; its per-entry CRUD is exposed via `operations`
 * (listEntries / addEntry / removeEntry) and reached through
 * `funnel.channels.connectorOp(...)`.
 */
export const scheduleConnector = (options: ScheduleConnectorOptions = {}): ConnectorDescriptor => ({
  type: "schedule",
  toolExposed: false,
  createListener(config, deps) {
    const parsed = scheduleConnectorSchema.parse(config)

    return new FunnelScheduleListener({
      config: parsed,
      lastFiredStore: new FunnelScheduleStateStore({
        path: join(deps.connectorDir(deps.channelId, parsed.id), "state.json"),
        fs: deps.fs,
      }),
      channelId: deps.channelId,
      logger: deps.logger,
      diagnosticLog: deps.diagnosticLog,
      onFired: options.onFired,
      // Funnel-injected clock so a memory clock controls tick selection in
      // tests; setTimeout still resolves against the real event loop because
      // the funnel has no scheduler boundary to inject.
      now: () => deps.clock.now(),
    })
  },
  createAdapter: null,
  secretTokens() {
    return []
  },
  buildConfig(input, context) {
    return scheduleConnectorSchema.parse({
      id: context.id,
      type: "schedule",
      name: input.name,
      entries: Array.isArray(input.entries) ? input.entries : [],
      createdAt: context.now,
      updatedAt: context.now,
    })
  },
  applyUpdate(config, _fields, context) {
    const current = scheduleConnectorSchema.parse(config)

    return scheduleConnectorSchema.parse({ ...current, updatedAt: context.now })
  },
  operations: {
    listEntries(props) {
      const parsed = scheduleConnectorSchema.parse(props.config)

      return { config: props.config, result: parsed.entries }
    },
    addEntry(props) {
      const parsed = scheduleConnectorSchema.parse(props.config)
      const args = scheduleEntryInputSchema.parse(props.args)
      const id = args.id ?? props.context.generateId()

      if (parsed.entries.some((entry) => entry.id === id)) {
        throw new Error(`schedule entry "${id}" already exists`)
      }

      const entry = scheduleEntrySchema.parse({
        id,
        ...("cron" in args
          ? { kind: "cron", cron: args.cron }
          : { kind: "once", runAt: args.runAt }),
        prompt: args.prompt,
        createdAt: props.context.now,
        ...(args.enabled !== undefined ? { enabled: args.enabled } : {}),
        ...(args.catchupPolicy !== undefined ? { catchupPolicy: args.catchupPolicy } : {}),
      })

      return {
        config: scheduleConnectorSchema.parse({
          ...parsed,
          entries: [...parsed.entries, entry],
          updatedAt: props.context.now,
        }),
        result: entry,
      }
    },
    removeEntry(props) {
      const parsed = scheduleConnectorSchema.parse(props.config)
      const args = removeEntryArgsSchema.parse(props.args)

      if (!parsed.entries.some((entry) => entry.id === args.id)) {
        throw new Error(`schedule entry "${args.id}" not found`)
      }

      return {
        config: scheduleConnectorSchema.parse({
          ...parsed,
          entries: parsed.entries.filter((entry) => entry.id !== args.id),
          updatedAt: props.context.now,
        }),
        result: null,
      }
    },
  },
})
