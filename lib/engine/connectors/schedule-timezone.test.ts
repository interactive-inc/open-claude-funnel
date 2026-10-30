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
const cron = (createdAt: string): Extract<ScheduleEntry, { kind: "cron" }> => ({
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

test("a checkpoint containing seconds before a repeated hour resumes on actual minute boundaries", async () => {
  const end = "2026-11-01T06:01:00.000Z"
  expect(
    await run({
      zone: "America/New_York",
      now: "2026-11-01T06:01:45.123Z",
      entry: cron("2026-11-01T05:00:00.000Z"),
      checkpoint: "2026-11-01T05:59:30.123Z",
    }),
  ).toEqual({
    offset: 300,
    delivered: [fire("2026-11-01T06:00:00.000Z", true), fire(end)],
    checkpoints: [["entry", end]],
  })
})

test("checkpoint rounding preserves historical local minute boundaries with second offsets", async () => {
  const at = "1899-12-31T23:59:50.000Z"
  expect(
    await run({
      zone: "Asia/Kolkata",
      now: "1900-01-01T00:00:45.123Z",
      entry: cron("1899-12-31T23:58:50.000Z"),
      checkpoint: "1899-12-31T23:58:59.123Z",
    }),
  ).toEqual({ offset: -321, delivered: [fire(at)], checkpoints: [["entry", at]] })
})

for (const policy of ["all", "latest", "skip"] as const) {
  test(`${policy} rounds to a real minute during an offset transition containing seconds`, async () => {
    const at = "1905-12-31T18:37:50.000Z"
    expect(
      await run({
        zone: "Asia/Kolkata",
        now: "1905-12-31T18:38:55.123Z",
        entry: { ...cron("1905-12-31T18:36:50.000Z"), catchupPolicy: policy },
        checkpoint: "1905-12-31T18:36:50.000Z",
      }),
    ).toEqual({ offset: -330, delivered: [fire(at)], checkpoints: [["entry", at]] })
  })
}

test("all catch-up realigns after a timezone offset changes seconds", async () => {
  const end = "1905-12-31T18:41:00.000Z"
  expect(
    await run({
      zone: "Asia/Kolkata",
      now: "1905-12-31T18:41:30.123Z",
      entry: cron("1905-12-31T18:36:50.000Z"),
      checkpoint: "1905-12-31T18:37:50.000Z",
    }),
  ).toEqual({
    offset: -330,
    delivered: [
      fire("1905-12-31T18:39:00.000Z", true),
      fire("1905-12-31T18:40:00.000Z", true),
      fire(end),
    ],
    checkpoints: [["entry", end]],
  })
})

for (const policy of ["all", "latest"] as const) {
  test(`${policy} finds a match before a timezone offset changed seconds`, async () => {
    const at = "1905-12-31T18:37:50.000Z"
    expect(
      await run({
        zone: "Asia/Kolkata",
        now: "1905-12-31T18:41:30.123Z",
        entry: { ...cron("1905-12-31T18:36:50.000Z"), cron: "59 23 * * *", catchupPolicy: policy },
        checkpoint: "1905-12-31T18:36:50.000Z",
      }),
    ).toEqual({ offset: -330, delivered: [fire(at, true)], checkpoints: [["entry", at]] })
  })
}

test("all catch-up preserves real minutes across a backward second-offset transition", async () => {
  const end = "1911-03-10T23:52:00.000Z"
  expect(
    await run({
      zone: "Europe/Paris",
      now: "1911-03-10T23:52:30.123Z",
      entry: cron("1911-03-10T23:48:39.000Z"),
      checkpoint: "1911-03-10T23:48:39.000Z",
    }),
  ).toEqual({
    offset: 0,
    delivered: [
      fire("1911-03-10T23:49:39.000Z", true),
      fire("1911-03-10T23:51:00.000Z", true),
      fire(end),
    ],
    checkpoints: [["entry", end]],
  })
})

test("latest catch-up finds the old minute phase before a backward offset transition", async () => {
  const at = "1911-03-10T23:49:39.000Z"
  expect(
    await run({
      zone: "Europe/Paris",
      now: "1911-03-10T23:52:30.123Z",
      entry: { ...cron("1911-03-10T23:48:39.000Z"), cron: "59 23 * * *", catchupPolicy: "latest" },
      checkpoint: "1911-03-10T23:48:39.000Z",
    }),
  ).toEqual({ offset: 0, delivered: [fire(at, true)], checkpoints: [["entry", at]] })
})
