import { expect, test } from "bun:test"
import { MemoryFunnelSettingsStore } from "@/engine/settings/memory-settings-store"
import type { Settings } from "@/engine/settings/settings-schema"
import { Funnel } from "@/funnel"

const initial = (): Settings => ({
  channels: [
    {
      id: "channel",
      name: "ops",
      delivery: "fanout",
      connectors: [
        {
          id: "connector",
          type: "custom",
          name: "source",
          options: { names: ["original"] },
        },
      ],
    },
  ],
})
const options = (settings: Settings) =>
  settings.channels[0]!.connectors[0]!.options as { names: string[] }

test("memory settings detach initial values, reads, and replacement writes", () => {
  const input = initial()
  const store = new MemoryFunnelSettingsStore(input)
  options(input).names.push("caller")
  const read = store.read()
  read.channels[0]!.name = "changed"
  options(read).names.push("reader")
  expect(store.read()).toEqual(initial())
  const replacement = initial()
  store.write(replacement)
  replacement.channels.length = 0
  options(store.read()).names.push("later reader")
  expect(store.read()).toEqual(initial())
})

test("a failed memory settings update rolls back nested changes", () => {
  const store = new MemoryFunnelSettingsStore(initial())
  const failure = new Error("Rejected update")
  expect(() =>
    store.update((draft) => {
      draft.channels[0]!.name = "changed"
      options(draft).names.push("partial")
      throw failure
    }),
  ).toThrow(failure)
  expect(store.read()).toEqual(initial())
})

test("successful updates detach retained drafts and returned values", () => {
  const store = new MemoryFunnelSettingsStore(initial())
  let retained: Settings | undefined
  const result = store.update((draft) => {
    retained = draft
    draft.channels[0]!.name = "updated"
    return options(draft)
  })
  result.names.push("returned")
  retained!.channels.length = 0
  expect(store.read().channels[0]!.name).toBe("updated")
  expect(options(store.read()).names).toEqual(["original"])
})

test("nested writers cannot overwrite an active transaction", () => {
  const store = new MemoryFunnelSettingsStore(initial())
  expect(() =>
    store.update((draft) => {
      draft.channels[0]!.name = "partial"
      store.write({ channels: [] })
    }),
  ).toThrow("settings update is already in progress")
  expect(store.read()).toEqual(initial())
  expect(() => store.update(() => store.update(() => {}))).toThrow(
    "settings update is already in progress",
  )
  store.update((draft) => {
    draft.channels[0]!.name = "recovered"
  })
  expect(store.read().channels[0]!.name).toBe("recovered")
})

test("channel API return values cannot silently change default stored routing", () => {
  const funnel = new Funnel()
  const created = funnel.channels.add({ name: "ops" })
  created.name = "renamed outside update"
  funnel.channels.list().length = 0
  expect(funnel.channels.get("ops")?.delivery).toBe("fanout")
  funnel.channels.setDelivery("ops", "exclusive")
  expect(funnel.channels.get("ops")?.delivery).toBe("exclusive")
})

test("opaque custom resources retain identity while their containing data is copied", () => {
  class Resource {
    value = "host owned"
  }
  const resource = new Resource()
  const callback = () => "host callback"
  const cycle: Record<string, unknown> = { resource, callback }
  cycle.self = cycle
  Object.defineProperty(cycle, "__proto__", { value: "literal", enumerable: true })
  const input = initial()
  input.channels[0]!.connectors[0]!.options = cycle
  const store = new MemoryFunnelSettingsStore(input)
  const copy = store.read().channels[0]!.connectors[0]!.options as typeof cycle
  expect(copy).not.toBe(cycle)
  expect(copy.self).toBe(copy)
  expect(copy.resource).toBe(resource)
  expect(copy.callback).toBe(callback)
  expect(Object.hasOwn(copy, "__proto__")).toBe(true)
  expect(copy.__proto__).toBe("literal")
})

test("invalid settings and failed snapshot getters cannot replace committed state", () => {
  const store = new MemoryFunnelSettingsStore(initial())
  expect(() =>
    store.write({ channels: [{ ...initial().channels[0]!, delivery: "invalid" as never }] }),
  ).toThrow()
  expect(() =>
    store.update((draft) => {
      draft.channels[0]!.name = "partial"
      Object.defineProperty(options(draft), "failure", {
        enumerable: true,
        get() {
          throw new Error("Snapshot failed")
        },
      })
    }),
  ).toThrow("Snapshot failed")
  expect(store.read()).toEqual(initial())
  store.update((draft) => {
    draft.channels[0]!.name = "pending"
    expect(store.read()).toEqual(initial())
  })
  expect(store.read().channels[0]!.name).toBe("pending")
})

test("async mutations are rejected and their later failure is observed", async () => {
  const store = new MemoryFunnelSettingsStore(initial())
  expect(() =>
    store.update(async (draft) => {
      draft.channels[0]!.name = "partial"
      await Promise.resolve()
      options(draft).names.push("late")
      throw new Error("Late mutation failure")
    }),
  ).toThrow("settings updates must be synchronous")
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(store.read()).toEqual(initial())
})
