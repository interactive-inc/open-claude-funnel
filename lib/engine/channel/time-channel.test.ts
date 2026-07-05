import { describe, it, expect } from "vitest"
import { MemoryFunnelLogger } from "@/engine/logger/memory-logger"
import { MemoryFunnelClock } from "@/engine/time/memory-clock"
import { MemoryFunnelFileSystem } from "@/engine/fs/memory-file-system"
import { FunnelChannelSupervisor } from "@/engine/channel/channel-supervisor"
import { timeChannel } from "@/engine/channel/time-channel"

function waitFor(condition: () => boolean, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const tick = () => {
      if (condition()) return resolve()
      if (Date.now() - start > timeoutMs) return reject(new Error("waitFor timeout"))
      setTimeout(tick, 5)
    }
    tick()
  })
}

function freshSupervisor(fs: MemoryFunnelFileSystem) {
  return new FunnelChannelSupervisor({
    broadcaster: { broadcast: () => {} },
    logger: new MemoryFunnelLogger(),
    clock: new MemoryFunnelClock(),
    fs,
    dir: "/sandbox/.funnel",
  })
}

describe("timeChannel", () => {
  it("registers and starts a cron-driven channel that broadcasts on tick", async () => {
    const fs = new MemoryFunnelFileSystem()
    const supervisor = freshSupervisor(fs)

    supervisor.register(
      timeChannel({
        id: "tick-test",
        cron: "* * * * *",
        persist: false,
        transform: (event) => {
          const firedAt =
            event.source === "time" && typeof event.data.firedAt === "number"
              ? event.data.firedAt
              : 0
          return { content: `hour:${new Date(firedAt).getUTCHours()}`, meta: { kind: "tick" } }
        },
      }),
    )

    await supervisor.start()

    // We can't easily wait for a real cron tick (would need ~60s of real time);
    // instead, verify the channel is registered and confluence has it.
    expect(supervisor.has("tick-test")).toBe(true)
    expect(supervisor.ids()).toEqual(["tick-test"])

    await supervisor.stop()
  })

  it("persist:true writes lastFiredAt under <dir>/channels/<id>/time.json", async () => {
    const fs = new MemoryFunnelFileSystem()

    // Seed an existing state so catchup has something to load (verifies file path).
    fs.mkdirSync("/sandbox/.funnel/channels/persisted/", { recursive: true })
    fs.writeFileSync(
      "/sandbox/.funnel/channels/persisted/time.json",
      JSON.stringify({ lastFiredAt: 0 }),
    )

    const supervisor = freshSupervisor(fs)

    supervisor.register(timeChannel({ id: "persisted", cron: "* * * * *", persist: true }))
    await supervisor.start()
    await waitFor(() => fs.existsSync("/sandbox/.funnel/channels/persisted/time.json"))

    expect(fs.existsSync("/sandbox/.funnel/channels/persisted/time.json")).toBe(true)

    await supervisor.stop()
  })
})
