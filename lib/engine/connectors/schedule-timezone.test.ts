import { expect, test } from "bun:test"
import type { ScheduleEntry } from "@/engine/connectors/schedule-connector-schema"

const once = (runAt: string): ScheduleEntry => ({
  id: "entry",
  kind: "once",
  runAt,
  prompt: "entry",
  enabled: true,
  catchupPolicy: "latest",
})
const cron = (createdAt: string): ScheduleEntry => ({
  id: "entry",
  kind: "cron",
  cron: "* * * * *",
  prompt: "entry",
  enabled: true,
  catchupPolicy: "all",
  createdAt,
})

const run = async (props: {
  zone: string
  now: string
  entry: ScheduleEntry
  checkpoint?: string
}): Promise<unknown> => {
  const source = `
import { FunnelScheduleListener } from ${JSON.stringify(new URL("./schedule-listener.ts", import.meta.url).href)}
import { FunnelScheduleStateStore } from ${JSON.stringify(new URL("./schedule-state-store.ts", import.meta.url).href)}
const props = ${JSON.stringify(props)}
const now = new Date(props.now)
const state = new FunnelScheduleStateStore()
if (props.checkpoint) state.save(new Map([["entry", new Date(props.checkpoint)]]))
const listener = new FunnelScheduleListener({
  config: { id: "source", name: "source", type: "schedule", entries: [props.entry] },
  lastFiredStore: state, now: () => now,
})
const delivered = []
await listener.tick(async (_content, meta) => { delivered.push({ firedAt: meta?.fired_at, catchup: meta?.catchup ?? null }) })
await listener.stop()
console.log(JSON.stringify({ offset: now.getTimezoneOffset(), delivered, checkpoints: [...state.load()].map(([id, date]) => [id, date.toISOString()]) }))
`
  const child = Bun.spawn([process.execPath, "-e", source], {
    env: { ...process.env, TZ: props.zone },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [output, errors, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  expect({ exit, errors }).toEqual({ exit: 0, errors: "" })
  return JSON.parse(output)
}

const fire = (firedAt: string, catchup = false) => ({ firedAt, catchup: catchup ? "true" : null })

test("minute rounding cannot move a one-shot fire back to the first occurrence of a repeated hour", async () => {
  const at = "2026-11-01T06:30:00.000Z"
  expect(
    await run({ zone: "America/New_York", now: "2026-11-01T06:30:45.123Z", entry: once(at) }),
  ).toEqual({ offset: 300, delivered: [fire(at)], checkpoints: [["entry", at]] })
})

test("catch-up cannot deliver instants before an entry created during the repeated hour", async () => {
  const end = "2026-11-01T06:17:00.000Z"
  expect(
    await run({
      zone: "America/New_York",
      now: "2026-11-01T06:17:45.123Z",
      entry: cron("2026-11-01T06:15:00.000Z"),
    }),
  ).toEqual({
    offset: 300,
    delivered: [
      fire("2026-11-01T06:15:00.000Z", true),
      fire("2026-11-01T06:16:00.000Z", true),
      fire(end),
    ],
    checkpoints: [["entry", end]],
  })
})

test("a checkpoint before the repeated hour advances in actual time", async () => {
  const end = "2026-11-01T06:01:00.000Z"
  expect(
    await run({
      zone: "America/New_York",
      now: "2026-11-01T06:01:45.123Z",
      entry: cron("2026-11-01T05:00:00.000Z"),
      checkpoint: "2026-11-01T05:59:00.000Z",
    }),
  ).toEqual({
    offset: 300,
    delivered: [fire("2026-11-01T06:00:00.000Z", true), fire(end)],
    checkpoints: [["entry", end]],
  })
})

test("spring-forward rounding preserves the first existing minute after the clock jump", async () => {
  const at = "2026-03-08T07:00:00.000Z"
  expect(
    await run({ zone: "America/New_York", now: "2026-03-08T07:00:45.123Z", entry: once(at) }),
  ).toEqual({ offset: 240, delivered: [fire(at)], checkpoints: [["entry", at]] })
})

test("historical offsets with seconds keep local minute boundaries", async () => {
  const at = "1899-12-31T23:59:50.000Z"
  expect(
    await run({ zone: "Asia/Kolkata", now: "1900-01-01T00:00:45.123Z", entry: once(at) }),
  ).toEqual({ offset: -321, delivered: [fire(at)], checkpoints: [["entry", at]] })
})
