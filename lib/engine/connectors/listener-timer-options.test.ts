import { expect, test } from "bun:test"
import { FunnelListenerRegistry } from "@/engine/connectors/listener-registry"

const channels = { listAllConnectors: () => [], createListener: () => null }

for (const field of ["healthCheckIntervalMs", "maxBackoffMs", "startTimeoutMs"] as const) {
  test(`invalid ${field} cannot become an immediate timer`, () => {
    for (const value of [-1, NaN, Infinity, 2_147_483_648, null, "10"]) {
      expect(
        () =>
          new FunnelListenerRegistry({
            channels,
            notify: async () => {},
            [field]: value as number,
          }),
      ).toThrow(field)
    }
  })
  test(`${field} keeps zero, finite fractional and maximum timer delays supported`, async () => {
    for (const value of [0, 0.5, 1, 2_147_483_647]) {
      const registry = new FunnelListenerRegistry({
        channels,
        notify: async () => {},
        [field]: value,
      })
      await registry.close()
    }
  })
}
